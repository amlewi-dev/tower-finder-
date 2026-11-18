import AsyncStorage from "@react-native-async-storage/async-storage";
import { ACTIVE_WITHIN_S, API_URL, NEW_WITHIN_S, OLD_AFTER_S } from "./config";
import { bearingDeg, distanceM } from "./geo";
import type { Age, Fix, NearTower, Tower } from "./types";

// Produced by the Rust ETL (scripts/build_data.sh) and copied to assets/towers.json
export const BUNDLED: Tower[] = require("../assets/towers.json") as Tower[];

const CACHE_KEY = "community-towers-v2";

export async function loadCachedCommunity(): Promise<Tower[]> {
  try {
    const s = await AsyncStorage.getItem(CACHE_KEY);
    return s ? (JSON.parse(s) as Tower[]) : [];
  } catch {
    return [];
  }
}

/** Approved community towers from your Rust API. Falls back to the cache when offline. */
export async function fetchCommunity(): Promise<Tower[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${API_URL}/api/towers/community`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as {
      id: string; lat: number; lon: number; op: string; note: string; photo: string;
      accuracy?: number; created_at?: number;
    }[];
    const towers: Tower[] = rows.map((r) => ({
      id: r.id,
      lat: r.lat,
      lon: r.lon,
      op: r.op,
      radios: [],
      acc_m: Math.max(5, Math.round(r.accuracy ?? 20)),
      first: r.created_at ?? 0,
      last: r.created_at ?? 0,
      note: r.note,
      photo: `${API_URL}${r.photo}`,
      source: "community",
    }));
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(towers));
    return towers;
  } catch {
    return loadCachedCommunity();
  } finally {
    clearTimeout(timer);
  }
}

const nowS = () => Date.now() / 1000;

export function ageOf(t: Tower): Exclude<Age, "all"> | null {
  const now = nowS();
  if (t.first && now - t.first <= NEW_WITHIN_S) return "new";
  if (t.last && now - t.last > OLD_AFTER_S) return "old";
  if (t.last && now - t.last <= ACTIVE_WITHIN_S) return "active";
  return null;
}

export function matchesAge(t: Tower, age: Age) {
  if (age === "all") return true;
  const now = nowS();
  if (age === "new") return !!t.first && now - t.first <= NEW_WITHIN_S;
  if (age === "active") return !!t.last && now - t.last <= ACTIVE_WITHIN_S;
  return !!t.last && now - t.last > OLD_AFTER_S;
}

export function makeFilter(op: string | null, age: Age) {
  return (t: Tower) => (!op || t.op === op) && matchesAge(t, age);
}

export function trustLabel(t: Tower) {
  if (t.source === "community") return { text: "Community photo", tone: "amber" as const };
  if (t.source === "osm") return { text: "Mapped mast (OSM)", tone: "green" as const };
  if (t.osm) return { text: "OSM mast + OpenCelliD", tone: "green" as const };
  return { text: "Estimated from cell data", tone: "zinc" as const };
}

export function ageLabel(t: Tower) {
  const a = ageOf(t);
  if (a === "new") return { text: "New", tone: "blue" as const };
  if (a === "old") return { text: "Not seen 12+ months", tone: "red" as const };
  if (a === "active") return { text: "Active", tone: "green" as const };
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatMonth(unix?: number) {
  if (!unix) return null;
  const d = new Date(unix * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Closest towers to the fix that pass `pass`, searching outward so remote areas still get results. */
export function nearest(
  towers: Tower[],
  fix: Pick<Fix, "lat" | "lon"> | null,
  pass: (t: Tower) => boolean,
  limit = 10,
  maxKm = Infinity,
): NearTower[] {
  if (!fix) return [];
  let pool: Tower[] = [];
  for (const box of [0.05, 0.2, 0.6, 2, 180]) {
    pool = towers.filter((t) => Math.abs(t.lat - fix.lat) < box && Math.abs(t.lon - fix.lon) < box && pass(t));
    // a box half-width of `box` degrees guarantees correctness only up to that radius,
    // so widen until we have enough candidates
    if (pool.length >= limit * 2 || box === 180) break;
  }
  return pool
    .map((t) => ({ ...t, dist: distanceM(fix.lat, fix.lon, t.lat, t.lon), bearing: bearingDeg(fix.lat, fix.lon, t.lat, t.lon) }))
    .filter((t) => t.dist <= maxKm * 1000)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
}

export function withDistance(t: Tower, fix: Pick<Fix, "lat" | "lon">): NearTower {
  return { ...t, dist: distanceM(fix.lat, fix.lon, t.lat, t.lon), bearing: bearingDeg(fix.lat, fix.lon, t.lat, t.lon) };
}

let cachedId: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (cachedId) return cachedId;
  let id = await AsyncStorage.getItem("device-id");
  if (!id) {
    id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    await AsyncStorage.setItem("device-id", id);
  }
  cachedId = id;
  return id;
}
