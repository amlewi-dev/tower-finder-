//! Tower Finder API
//!
//! POST /api/submissions            multipart: lat, lon, accuracy, operator, note, device_id, photo
//! GET  /api/towers/community       approved submissions only
//! GET  /uploads/<file>             photos
//! GET  /admin                      review page (needs ADMIN_TOKEN to load data)
//! GET  /api/admin/submissions      ?status=pending|approved|rejected   (Bearer ADMIN_TOKEN)
//! POST /api/admin/submissions/:id/approve | reject                    (Bearer ADMIN_TOKEN)
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{Html, Json},
    routing::{get, post},
    Router,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::{cors::{Any, CorsLayer}, services::ServeDir};

const MAX_ACCURACY_M: f64 = 50.0; // reject worse GPS fixes
const NEAR_KNOWN_M: f64 = 150.0; // near an OpenCelliD cluster
const CORROBORATE_M: f64 = 50.0; // two different devices within this distance
const MAX_PER_DEVICE_PER_DAY: i64 = 10;
const MAX_PHOTO_BYTES: usize = 8 * 1024 * 1024;
const OPERATORS: [&str; 4] = ["Safaricom", "Airtel", "Telkom", "Other"];

type ApiResult<T> = Result<T, (StatusCode, String)>;

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    known: Arc<Vec<(f64, f64)>>,
    admin_token: Arc<String>,
}

#[derive(Deserialize)]
struct KnownTower {
    lat: f64,
    lon: f64,
}

#[derive(Serialize)]
struct Submission {
    id: i64,
    lat: f64,
    lon: f64,
    accuracy: f64,
    operator: String,
    note: String,
    photo: String,
    status: String,
    flags: Vec<String>,
    created_at: i64,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

fn bad<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}
fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    eprintln!("internal error: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
}

fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * 6_371_000.0 * a.sqrt().asin()
}

fn require_admin(headers: &HeaderMap, st: &AppState) -> ApiResult<()> {
    let given = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if given.is_empty() || given != st.admin_token.as_str() {
        return Err((StatusCode::UNAUTHORIZED, "bad admin token".into()));
    }
    Ok(())
}

/// Only accept real JPEG / PNG / WebP files (checks magic bytes, not the client's claim).
fn image_ext(b: &[u8]) -> Option<&'static str> {
    if b.len() > 12 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
        Some("jpg")
    } else if b.len() > 8 && b[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        Some("png")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            accuracy REAL NOT NULL,
            operator TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            photo TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            flags TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            reviewed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);
        CREATE INDEX IF NOT EXISTS idx_sub_device ON submissions(device_id, created_at);",
    )
}

// ---------- public handlers ----------

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn submit(State(st): State<AppState>, mut mp: Multipart) -> ApiResult<Json<Value>> {
    let mut f: HashMap<String, String> = HashMap::new();
    let mut photo: Option<Vec<u8>> = None;
    while let Some(field) = mp.next_field().await.map_err(bad)? {
        let name = field.name().unwrap_or("").to_string();
        if name == "photo" {
            photo = Some(field.bytes().await.map_err(bad)?.to_vec());
        } else {
            f.insert(name, field.text().await.map_err(bad)?);
        }
    }

    let num = |k: &str| -> ApiResult<f64> {
        f.get(k)
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .ok_or_else(|| bad(format!("missing or invalid {k}")))
    };
    let lat = num("lat")?;
    let lon = num("lon")?;
    let accuracy = num("accuracy")?;
    if !(-4.9..=5.2).contains(&lat) || !(33.8..=42.0).contains(&lon) {
        return Err(bad("location is outside Kenya"));
    }
    if accuracy <= 0.0 || accuracy > MAX_ACCURACY_M {
        return Err(bad(format!("GPS accuracy must be {MAX_ACCURACY_M} m or better, move to open sky and retry")));
    }
    let operator = f.get("operator").map(|s| s.trim().to_string()).unwrap_or_default();
    if !OPERATORS.contains(&operator.as_str()) {
        return Err(bad("operator must be Safaricom, Airtel, Telkom or Other"));
    }
    let device_id = f.get("device_id").map(|s| s.trim().to_string()).unwrap_or_default();
    if device_id.len() < 8 || device_id.len() > 64 {
        return Err(bad("missing device_id"));
    }
    let note: String = f.get("note").map(|s| s.trim().chars().take(300).collect()).unwrap_or_default();
    let photo = photo.ok_or_else(|| bad("a photo of the tower is required"))?;
    if photo.len() > MAX_PHOTO_BYTES {
        return Err(bad("photo too large (max 8 MB)"));
    }
    let ext = image_ext(&photo).ok_or_else(|| bad("photo must be a JPEG, PNG or WebP image"))?;

    // rate limit + corroboration check
    let mut flags: Vec<&str> = Vec::new();
    {
        let db = st.db.lock().unwrap();
        let recent: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM submissions WHERE device_id = ?1 AND created_at > ?2",
                params![device_id, now() - 86_400],
                |r| r.get(0),
            )
            .map_err(internal)?;
        if recent >= MAX_PER_DEVICE_PER_DAY {
            return Err((StatusCode::TOO_MANY_REQUESTS, "daily submission limit reached".into()));
        }
        let mut stmt = db
            .prepare("SELECT lat, lon, device_id FROM submissions WHERE status != 'rejected' AND ABS(lat - ?1) < 0.001 AND ABS(lon - ?2) < 0.001")
            .map_err(internal)?;
        let rows = stmt
            .query_map(params![lat, lon], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?)))
            .map_err(internal)?;
        for row in rows.flatten() {
            if row.2 != device_id && haversine_m(lat, lon, row.0, row.1) <= CORROBORATE_M {
                flags.push("corroborated_by_other_device");
                break;
            }
        }
    }
    if st.known.iter().any(|&(la, lo)| (la - lat).abs() < 0.01 && haversine_m(lat, lon, la, lo) <= NEAR_KNOWN_M) {
        flags.push("near_opencellid");
    }

    fs::create_dir_all("uploads").map_err(internal)?;
    let file = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    fs::write(format!("uploads/{file}"), &photo).map_err(internal)?;

    let id = {
        let db = st.db.lock().unwrap();
        db.execute(
            "INSERT INTO submissions (device_id, lat, lon, accuracy, operator, note, photo, flags, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![device_id, lat, lon, accuracy, operator, note, file, flags.join(","), now()],
        )
        .map_err(internal)?;
        db.last_insert_rowid()
    };
    Ok(Json(json!({ "id": id, "status": "pending", "flags": flags })))
}

async fn community(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let db = st.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, lat, lon, operator, note, photo, accuracy, created_at FROM submissions WHERE status = 'approved' ORDER BY id")
        .map_err(internal)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": format!("cm_{}", r.get::<_, i64>(0)?),
                "lat": r.get::<_, f64>(1)?,
                "lon": r.get::<_, f64>(2)?,
                "op": r.get::<_, String>(3)?,
                "note": r.get::<_, String>(4)?,
                "photo": format!("/uploads/{}", r.get::<_, String>(5)?),
                "accuracy": r.get::<_, f64>(6)?,
                "created_at": r.get::<_, i64>(7)?,
            }))
        })
        .map_err(internal)?;
    Ok(Json(Value::Array(rows.flatten().collect())))
}

// ---------- admin handlers ----------

async fn admin_page() -> Html<&'static str> {
    Html(include_str!("admin.html"))
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

async fn admin_list(
    State(st): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<StatusQuery>,
) -> ApiResult<Json<Vec<Submission>>> {
    require_admin(&headers, &st)?;
    let status = q.status.unwrap_or_else(|| "pending".into());
    let db = st.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, lat, lon, accuracy, operator, note, photo, status, flags, created_at
             FROM submissions WHERE status = ?1 ORDER BY id DESC LIMIT 200",
        )
        .map_err(internal)?;
    let rows = stmt
        .query_map(params![status], |r| {
            let flags: String = r.get(8)?;
            Ok(Submission {
                id: r.get(0)?,
                lat: r.get(1)?,
                lon: r.get(2)?,
                accuracy: r.get(3)?,
                operator: r.get(4)?,
                note: r.get(5)?,
                photo: format!("/uploads/{}", r.get::<_, String>(6)?),
                status: r.get(7)?,
                flags: flags.split(',').filter(|s| !s.is_empty()).map(String::from).collect(),
                created_at: r.get(9)?,
            })
        })
        .map_err(internal)?;
    Ok(Json(rows.flatten().collect()))
}

async fn review(st: &AppState, headers: &HeaderMap, id: i64, status: &str) -> ApiResult<Json<Value>> {
    require_admin(headers, st)?;
    let db = st.db.lock().unwrap();
    let n = db
        .execute(
            "UPDATE submissions SET status = ?1, reviewed_at = ?2 WHERE id = ?3",
            params![status, now(), id],
        )
        .map_err(internal)?;
    if n == 0 {
        return Err((StatusCode::NOT_FOUND, "no such submission".into()));
    }
    Ok(Json(json!({ "id": id, "status": status })))
}

async fn approve(State(st): State<AppState>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    review(&st, &headers, id, "approved").await
}
async fn reject(State(st): State<AppState>, headers: HeaderMap, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    review(&st, &headers, id, "rejected").await
}

#[tokio::main]
async fn main() {
    let admin_token = env::var("ADMIN_TOKEN").unwrap_or_default();
    if admin_token.len() < 16 {
        eprintln!("Set ADMIN_TOKEN (at least 16 characters) before starting, e.g.:\n  export ADMIN_TOKEN=$(openssl rand -hex 24)");
        std::process::exit(1);
    }
    let towers_path = env::var("TOWERS_JSON").unwrap_or_else(|_| "../data/towers.json".into());
    let known: Vec<(f64, f64)> = fs::read_to_string(&towers_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<KnownTower>>(&s).ok())
        .map(|v| v.into_iter().map(|t| (t.lat, t.lon)).collect())
        .unwrap_or_default();
    println!("loaded {} known towers from {towers_path}", known.len());

    fs::create_dir_all("data").unwrap();
    fs::create_dir_all("uploads").unwrap();
    let conn = Connection::open("data/app.db").expect("open sqlite");
    init_db(&conn).expect("init schema");

    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        known: Arc::new(known),
        admin_token: Arc::new(admin_token),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/submissions", post(submit))
        .route("/api/towers/community", get(community))
        .route("/admin", get(admin_page))
        .route("/api/admin/submissions", get(admin_list))
        .route("/api/admin/submissions/:id/approve", post(approve))
        .route("/api/admin/submissions/:id/reject", post(reject))
        .nest_service("/uploads", ServeDir::new("uploads"))
        .layer(DefaultBodyLimit::max(MAX_PHOTO_BYTES + 64 * 1024))
        .layer(cors)
        .with_state(state);

    let addr = env::var("BIND").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("tower-api listening on http://{addr}  (admin: /admin)");
    axum::serve(listener, app).await.unwrap();
}
