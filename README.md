# Tower Finder (Kenya)

> Quick start: see **RUN.md** — `pnpm bootstrap`, `pnpm data`, then `pnpm dev` runs the Rust API and Expo app together.


**Start with SETUP.md: the complete step-by-step guide (tools, accounts, running, APK, hosting).**

Finds the nearest Safaricom / Airtel / Telkom cell towers from your GPS position, points an arrow at them,
shows them on a map, and lets people submit new towers with a photo that **you** approve.

```
OpenCelliD 639.csv ─┐
                    ├─► Rust ETL (etl/) ─► towers.json ─► Expo app (app/, works offline)
OSM Overpass ───────┘                                         │
                                                              ▼
                     Rust API (server/): submissions ─► your /admin page ─► approved towers ─► app
```

Trust levels shown in the app: **OpenCelliD estimate**, **OpenCelliD + OSM confirmed**, **Community approved**.

## Tested

Rust ETL and API were compiled and run end to end (submission rules, auto-flags, admin approval, photo serving).
The Expo app type-checks and bundles for Android with Metro. It has **not** been run on a physical phone yet:
the first run on your device is the real test, so report anything odd.

## 0. Prerequisites (Ubuntu)

```bash
sudo apt update && sudo apt install -y build-essential pkg-config curl openssl
curl https://sh.rustup.rs -sSf | sh          # Rust (restart the terminal afterwards)
# Node 20+ : https://nodejs.org  then install pnpm: npm install -g pnpm   (or: corepack enable pnpm)
```

On your Android phone install **Expo Go** from the Play Store.

## 1. Data: OpenCelliD CSV

You already have `~/tower-finder/data/639.csv`. Note that the file has **no header row**; the ETL knows the column order.
To download it again: opencellid.org → Data → Kenya (639) → use your access token. Two downloads per file per day.

**Revoke the token you pasted in the screenshot** (Access Token page → Revoke Token → create a new one).
The app never needs the token, because the CSV is processed offline. Keep any token only in a private `.env` on your PC.

## 2. Data: OpenStreetMap confirmation

```bash
cd ~/tower-finder
./scripts/fetch_osm.sh        # no account, no key
```

(The "OAuth 2 application" page is not needed. OAuth is only for apps that write to OSM.)

## 3. Build towers.json

```bash
./scripts/build_data.sh
```

It reads `data/639.csv`, keeps Safaricom (MNC 2), Airtel (3) and Telkom (7), drops junk rows and nonsense ranges,
clusters cells within about 110 m into one tower, checks each tower against OSM masts within 300 m,
writes `data/towers.json`, and copies it to `app/assets/towers.json`.

OSM coverage in Kenya is patchy: "confirmed" raises confidence, "not confirmed" does **not** mean fake.

## 4. Run the API

```bash
./scripts/run_server.sh
```

It creates `server/.env` with a random `ADMIN_TOKEN` and prints the admin URL. Keep it running in its own terminal.
Review submissions at `http://localhost:8080/admin` (it asks for the token).

Submission rules (in `server/src/main.rs`): GPS accuracy 50 m or better, inside Kenya, a real JPEG/PNG/WebP photo
(checked by file signature, 8 MB max), a valid operator, 10 submissions per device per day. Flags help you decide:
`near_opencellid` (within 150 m of a known cluster) and `corroborated_by_other_device` (another device within 50 m).
Nothing is shown to users until you click Approve.

## 5. Run the app

```bash
cd app
cp .env.example .env
pnpm install
```

Edit `.env`: for a real phone on the same Wi-Fi set `EXPO_PUBLIC_API_URL=http://<your PC LAN IP>:8080`
(get the IP with `hostname -I`). Then:

```bash
pnpm exec expo start -c
```

Scan the QR code with Expo Go. If the phone cannot reach the API, allow the port: `sudo ufw allow 8080/tcp`.

Screens: **Radar** (compass arrow, nearest tower, operator filter, list), **Map** (OpenStreetMap, tap a tower to point at it
or navigate), **Add** (GPS accuracy meter, camera, operator, note, submit).

The first launch asks for location and camera permission. The app starts with no towers until step 3 has been run.

## 6. Build an APK to share

```bash
cd app
pnpm add -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview      # make the preview profile output an apk in eas.json
```

For a public release, deploy the API behind **HTTPS** (a small VPS with Caddy works), set `EXPO_PUBLIC_API_URL`
to the https URL, and remove `usesCleartextTraffic` from `app/app.json`.

## Licensing (important before you publish)

- OpenCelliD data is CC BY-SA 4.0. The app already credits it on the Radar and Map screens. If you publish `towers.json`,
  it must carry the same license and say that cells were clustered.
- OSM data is ODbL. Credit "© OpenStreetMap contributors" (already in the app). The app only stores a yes/no flag,
  not OSM points.
- Do not commit `data/` or the raw CSV to GitHub (already in `.gitignore`).

## Known limits

- Grid clustering can split one tower across two adjacent 110 m buckets, so you may see two dots very close together.
- Locations are estimates (often hundreds of metres off). Towers are shared between operators, so the app cannot say who owns a mast.
- `device_id` is a random id stored on the phone. It limits casual spam but is not real authentication.
- The map uses the public OpenStreetMap tile server, which is fine for a demo; for heavy public use switch to a tile provider.
- shadcn/ui and the `motion` library are web-only. The UI uses shadcn-style components (`app/src/ui.tsx`, NativeWind)
  and animations come from Reanimated. React Native Reusables is the drop-in option if you want real shadcn components.
