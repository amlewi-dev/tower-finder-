//! OpenCelliD CSV + OpenStreetMap masts -> towers.json
//!
//! The OpenCelliD country CSV has NO header row. Column order:
//! radio,mcc,net,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal
//!
//! Pipeline
//! 1. Parse cells for Kenyan operators, drop junk (bad coords, absurd range).
//! 2. LTE sectors sharing an eNodeB id (cell >> 8) are the same physical site:
//!    merge them first (sample-weighted). Sector estimates scatter around the mast,
//!    so their centroid is a better tower estimate than any single sector.
//! 3. Greedy centroid clustering per operator (heaviest units first, radius CLUSTER_M).
//!    Unlike grid snapping this never splits a site across a grid line and never
//!    chains a whole city into one blob.
//! 4. Snap each operator's closest cluster to a mapped OSM mast within OSM_MATCH_M:
//!    OSM masts are surveyed structures, so their coordinates replace the estimate.
//! 5. OSM masts that matched nothing are emitted as their own towers.
//! 6. Keep first-seen / last-seen dates so the app can tell new, active and old sites.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::{env, error::Error, fs::File, io::BufWriter};

const MCC: u32 = 639; // Kenya
const CLUSTER_M: f64 = 250.0; // units of one operator closer than this are one site
const OSM_MATCH_M: f64 = 300.0; // cluster within this distance of an OSM mast snaps to it
const MAX_RANGE_M: u32 = 10_000; // cells with a larger coverage estimate are unreliable
const M_PER_DEG: f64 = 111_320.0;
const KENYA_LAT: std::ops::RangeInclusive<f64> = -4.9..=5.2;
const KENYA_LON: std::ops::RangeInclusive<f64> = 33.8..=42.0;

fn operator_name(mnc: u32) -> Option<&'static str> {
    match mnc {
        2 => Some("Safaricom"),
        3 => Some("Airtel"),
        7 => Some("Telkom"),
        _ => None,
    }
}

fn normalize_osm_operator(raw: &str) -> &'static str {
    let s = raw.to_ascii_lowercase();
    if s.contains("safaricom") {
        "Safaricom"
    } else if s.contains("airtel") || s.contains("aitel") || s.contains("zain") || s.contains("celtel") {
        "Airtel"
    } else if s.contains("telkom") || s.contains("orange") {
        "Telkom"
    } else {
        "Unknown"
    }
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * 6_371_000.0 * a.sqrt().asin()
}

fn round5(v: f64) -> f64 {
    (v * 1e5).round() / 1e5
}

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// A merge-able group of cells (one cell, or all sectors of one LTE eNodeB).
struct Unit {
    op: &'static str,
    lat: f64,
    lon: f64,
    w: f64,
    radios: BTreeSet<String>,
    cells: u32,
    samples: u32,
    first: i64,
    last: i64,
}

impl Unit {
    fn absorb(&mut self, o: &Unit) {
        let w = self.w + o.w;
        self.lat = (self.lat * self.w + o.lat * o.w) / w;
        self.lon = (self.lon * self.w + o.lon * o.w) / w;
        self.w = w;
        self.radios.extend(o.radios.iter().cloned());
        self.cells += o.cells;
        self.samples += o.samples;
        self.first = self.first.min(o.first);
        self.last = self.last.max(o.last);
    }
}

struct Cluster {
    unit: Unit,
    members: Vec<(f64, f64, f64)>, // lat, lon, weight of every merged unit (for spread)
}

impl Cluster {
    /// Rough 1-sigma position uncertainty in metres.
    fn uncertainty_m(&self) -> u32 {
        let u = &self.unit;
        let est = if self.members.len() >= 2 {
            let coslat = u.lat.to_radians().cos();
            let var: f64 = self
                .members
                .iter()
                .map(|&(la, lo, w)| {
                    let dy = (la - u.lat) * M_PER_DEG;
                    let dx = (lo - u.lon) * M_PER_DEG * coslat;
                    w * (dx * dx + dy * dy)
                })
                .sum::<f64>()
                / u.w;
            var.sqrt().max(120.0)
        } else if u.samples >= 20 {
            250.0
        } else if u.samples >= 5 {
            400.0
        } else {
            700.0
        };
        est.clamp(100.0, 1500.0).round() as u32
    }
}

#[derive(Serialize)]
struct Tower {
    id: String,
    lat: f64,
    lon: f64,
    op: &'static str,
    radios: Vec<String>,
    cells: u32,
    samples: u32,
    /// estimated position uncertainty (m)
    acc_m: u32,
    /// unix seconds, first / last time any cell of this site was observed (0 = unknown)
    first: i64,
    last: i64,
    /// position comes from a mapped OSM mast
    osm: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    osm_m: Option<u32>,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct Overpass {
    elements: Vec<Element>,
}
#[derive(Deserialize)]
struct Element {
    #[serde(rename = "type")]
    kind: String,
    id: i64,
    lat: Option<f64>,
    lon: Option<f64>,
    center: Option<Center>,
    #[serde(default)]
    tags: HashMap<String, String>,
}
#[derive(Deserialize)]
struct Center {
    lat: f64,
    lon: f64,
}

struct Mast {
    id: String,
    lat: f64,
    lon: f64,
    op: &'static str,
    name: Option<String>,
}

/// Spatial hash, bucket size = search radius, so a 3x3 lookup covers every candidate.
struct Grid {
    deg: f64,
    buckets: HashMap<(&'static str, i64, i64), Vec<usize>>,
}
impl Grid {
    fn new(radius_m: f64) -> Self {
        Self { deg: radius_m / M_PER_DEG, buckets: HashMap::new() }
    }
    fn key(&self, op: &'static str, lat: f64, lon: f64) -> (&'static str, i64, i64) {
        (op, (lat / self.deg).floor() as i64, (lon / self.deg).floor() as i64)
    }
    fn insert(&mut self, op: &'static str, lat: f64, lon: f64, idx: usize) {
        let k = self.key(op, lat, lon);
        self.buckets.entry(k).or_default().push(idx);
    }
    fn near(&self, op: &'static str, lat: f64, lon: f64) -> Vec<usize> {
        let (_, i, j) = self.key(op, lat, lon);
        let mut out = Vec::new();
        for di in -1..=1 {
            for dj in -1..=1 {
                if let Some(v) = self.buckets.get(&(op, i + di, j + dj)) {
                    out.extend_from_slice(v);
                }
            }
        }
        out
    }
}

fn load_osm(path: &str) -> Result<Vec<Mast>, Box<dyn Error>> {
    let Ok(f) = File::open(path) else {
        eprintln!("no {path}, skipping OSM (run scripts/fetch_osm.sh first)");
        return Ok(vec![]);
    };
    let data: Overpass = serde_json::from_reader(f)?;
    Ok(data
        .elements
        .into_iter()
        .filter(|e| e.tags.get("communication:mobile_phone").map(String::as_str) != Some("no"))
        .filter(|e| !matches!(e.tags.get("operational_status").map(String::as_str), Some("dismantled" | "removed")))
        .filter_map(|e| {
            let (lat, lon) = match (e.lat, e.lon, &e.center) {
                (Some(la), Some(lo), _) => (la, lo),
                (_, _, Some(c)) => (c.lat, c.lon),
                _ => return None,
            };
            Some(Mast {
                id: format!("osm_{}{}", e.kind.chars().next().unwrap_or('n'), e.id),
                lat,
                lon,
                op: e.tags.get("operator").map(|s| normalize_osm_operator(s)).unwrap_or("Unknown"),
                name: e.tags.get("name").cloned(),
            })
        })
        .collect())
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    let csv_path = args.get(1).map(String::as_str).unwrap_or("../data/639.csv");
    let osm_path = args.get(2).map(String::as_str).unwrap_or("../data/osm.json");
    let out_path = args.get(3).map(String::as_str).unwrap_or("../data/towers.json");

    // 1. parse
    let mut rdr = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_path(csv_path)?;
    let mut singles: Vec<Unit> = Vec::new();
    let mut enodeb: HashMap<(&'static str, u64), Unit> = HashMap::new();
    let (mut read, mut kept) = (0u64, 0u64);
    for rec in rdr.records() {
        let Ok(r) = rec else { continue };
        read += 1;
        if r.len() < 13 {
            continue;
        }
        let radio = r[0].trim().to_string();
        let (Ok(mcc), Ok(mnc), Ok(cell)) = (r[1].parse::<u32>(), r[2].parse::<u32>(), r[4].parse::<u64>()) else { continue };
        let (Ok(lon), Ok(lat)) = (r[6].parse::<f64>(), r[7].parse::<f64>()) else { continue };
        let (Ok(range), Ok(samples)) = (r[8].parse::<u32>(), r[9].parse::<u32>()) else { continue };
        let created = r[11].parse::<i64>().unwrap_or(0);
        let updated = r[12].parse::<i64>().unwrap_or(created);
        let Some(op) = operator_name(mnc) else { continue };
        if mcc != MCC || range > MAX_RANGE_M || !KENYA_LAT.contains(&lat) || !KENYA_LON.contains(&lon) {
            continue;
        }
        kept += 1;
        let u = Unit {
            op,
            lat,
            lon,
            w: samples.max(1) as f64,
            radios: BTreeSet::from([radio.clone()]),
            cells: 1,
            samples,
            first: created,
            last: updated.max(created),
        };
        if radio == "LTE" {
            match enodeb.get_mut(&(op, cell >> 8)) {
                Some(site) => site.absorb(&u),
                None => {
                    enodeb.insert((op, cell >> 8), u);
                }
            }
        } else {
            singles.push(u);
        }
    }
    let n_enb = enodeb.len();
    let mut units: Vec<Unit> = singles.into_iter().chain(enodeb.into_values()).collect();
    eprintln!("read {read} rows, kept {kept} cells ({n_enb} LTE eNodeBs) -> {} units", units.len());

    // 2. greedy centroid clustering, heaviest (most observed) units seed clusters
    units.sort_by(|a, b| cmp_f64(b.w, a.w).then(cmp_f64(a.lat, b.lat)).then(cmp_f64(a.lon, b.lon)));
    let mut clusters: Vec<Cluster> = Vec::new();
    let mut grid = Grid::new(CLUSTER_M);
    for u in units {
        let best = grid
            .near(u.op, u.lat, u.lon)
            .into_iter()
            .map(|k| (k, haversine_m(u.lat, u.lon, clusters[k].unit.lat, clusters[k].unit.lon)))
            .filter(|&(_, d)| d <= CLUSTER_M)
            .min_by(|a, b| cmp_f64(a.1, b.1));
        match best {
            Some((k, _)) => {
                clusters[k].members.push((u.lat, u.lon, u.w));
                clusters[k].unit.absorb(&u);
            }
            None => {
                grid.insert(u.op, u.lat, u.lon, clusters.len());
                clusters.push(Cluster { members: vec![(u.lat, u.lon, u.w)], unit: u });
            }
        }
    }
    eprintln!("{} clustered sites", clusters.len());

    // 3. OSM snapping: each (mast, operator) pair snaps only its closest cluster
    let masts = load_osm(osm_path)?;
    eprintln!("{} OSM masts loaded", masts.len());
    let mut mast_grid = Grid::new(OSM_MATCH_M);
    for (i, m) in masts.iter().enumerate() {
        mast_grid.insert("osm", m.lat, m.lon, i);
    }
    let mut best_for: HashMap<(usize, &'static str), (usize, f64)> = HashMap::new();
    for (ci, c) in clusters.iter().enumerate() {
        let nearest = mast_grid
            .near("osm", c.unit.lat, c.unit.lon)
            .into_iter()
            .map(|mi| (mi, haversine_m(c.unit.lat, c.unit.lon, masts[mi].lat, masts[mi].lon)))
            .filter(|&(_, d)| d <= OSM_MATCH_M)
            .min_by(|a, b| cmp_f64(a.1, b.1));
        if let Some((mi, d)) = nearest {
            let e = best_for.entry((mi, c.unit.op)).or_insert((ci, d));
            if d < e.1 {
                *e = (ci, d);
            }
        }
    }
    let mut snapped: HashMap<usize, (usize, f64)> = HashMap::new();
    let mut used_masts = vec![false; masts.len()];
    for ((mi, _), (ci, d)) in best_for {
        snapped.insert(ci, (mi, d));
        used_masts[mi] = true;
    }

    // 4. emit
    let mut towers: Vec<Tower> = clusters
        .iter()
        .enumerate()
        .map(|(ci, c)| {
            let u = &c.unit;
            let (lat, lon, acc_m, osm, osm_m, name) = match snapped.get(&ci) {
                Some(&(mi, d)) => (masts[mi].lat, masts[mi].lon, 15, true, Some(d.round() as u32), masts[mi].name.clone()),
                None => (u.lat, u.lon, c.uncertainty_m(), false, None, None),
            };
            Tower {
                id: format!("oc_{}_{}_{}", u.op.to_ascii_lowercase(), (u.lat * 1e4).round() as i64, (u.lon * 1e4).round() as i64),
                lat: round5(lat),
                lon: round5(lon),
                op: u.op,
                radios: u.radios.iter().cloned().collect(),
                cells: u.cells,
                samples: u.samples,
                acc_m,
                first: u.first,
                last: u.last,
                osm,
                osm_m,
                source: "opencellid",
                name,
            }
        })
        .collect();
    let mut osm_only = 0;
    for (m, used) in masts.iter().zip(&used_masts) {
        if *used {
            continue;
        }
        osm_only += 1;
        towers.push(Tower {
            id: m.id.clone(),
            lat: round5(m.lat),
            lon: round5(m.lon),
            op: m.op,
            radios: vec![],
            cells: 0,
            samples: 0,
            acc_m: 15,
            first: 0,
            last: 0,
            osm: true,
            osm_m: None,
            source: "osm",
            name: m.name.clone(),
        });
    }

    // ids must be unique even if two sites round to the same 1e-4 grid point
    towers.sort_by(|a, b| a.id.cmp(&b.id));
    let mut seen: HashMap<String, u32> = HashMap::new();
    for t in towers.iter_mut() {
        let n = seen.entry(t.id.clone()).or_insert(0);
        if *n > 0 {
            t.id = format!("{}_{}", t.id, n);
        }
        *n += 1;
    }

    serde_json::to_writer(BufWriter::new(File::create(out_path)?), &towers)?;
    for op in ["Safaricom", "Airtel", "Telkom", "Unknown"] {
        eprintln!("{op}: {} towers", towers.iter().filter(|t| t.op == op).count());
    }
    eprintln!(
        "{} towers total: {} snapped to OSM masts, {osm_only} OSM-only masts -> {out_path}",
        towers.len(),
        snapped.len()
    );
    Ok(())
}
