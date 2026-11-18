# Run and build Tower Finder (one place, one terminal)

Everything is driven from the **project root** (`~/tower-finder`) with `pnpm <script>`.
The Rust API and the Expo app start together through `concurrently`; their logs are
prefixed `[api]` (magenta) and `[app]` (cyan). Ctrl+C stops both. If the API crashes it is
restarted automatically (up to 3 times), and if it keeps failing everything stops so you notice.

Prerequisites: Rust (`cargo`), Node 20+, Expo Go on your phone (see SETUP.md part A).

## 1. First time only

```bash
cd ~/tower-finder
pnpm bootstrap        # installs root + app packages, builds the Rust API and ETL in release mode
pnpm data         # downloads OSM masts + builds data/towers.json and app/assets/towers.json
```

`pnpm data` needs `data/639.csv` (or `639.csv.gz`) from OpenCelliD in `data/`.
If you already have `data/osm.json`, use `pnpm data:rebuild` to skip the download.

## 2. Every day: run everything

| Command | What it starts |
| --- | --- |
| `pnpm dev` | API on :8080 + Expo (scan the QR with Expo Go) |
| `pnpm dev:web` | API + Expo web in your browser (http://localhost:8081) |
| `pnpm dev:tunnel` | API + Expo over a tunnel (phone not on the same Wi-Fi as Metro) |
| `pnpm dev:clear` | Same as `dev`, but clears the Metro cache (use after `pnpm data`) |
| `pnpm api` | Only the Rust API |
| `pnpm app` | Only Expo, pointing at an API that is already running |

On start it prints:

```
API     http://localhost:8080/api/health
Admin   http://localhost:8080/admin   token: <your ADMIN_TOKEN>
App ->  EXPO_PUBLIC_API_URL=http://192.168.x.x:8080
```

- `server/.env` is created automatically with a random `ADMIN_TOKEN` the first time.
- The app is told your laptop's Wi-Fi IP automatically, so the phone can reach the API.
  To override it (e.g. a deployed server): `EXPO_PUBLIC_API_URL=https://api.example.com pnpm dev`.
- Extra Expo flags pass straight through: `pnpm dev --android`, `pnpm dev --port 8082`.

Phone cannot reach the API? Check `http://<laptop-ip>:8080/api/health` in the phone browser.
If it fails, allow the port: `sudo ufw allow 8080/tcp` and make sure both are on the same Wi-Fi.

## 3. Build for release

| Command | Output |
| --- | --- |
| `pnpm build` | Release builds of API + ETL, and a TypeScript check of the app |
| `pnpm build:server` | `server/target/release/tower-api` (a single binary) |
| `pnpm build:web` | Static web app in `app/dist/` |
| `pnpm build:apk` | Android APK via EAS cloud build (`pnpm dlx eas-cli login` first) |
| `pnpm build:apk:local` | Android APK built locally (needs Android SDK + JDK 17) -> `app/android/app/build/outputs/apk/release/` |
| `pnpm check` | Fast `cargo check` on both crates + app typecheck |

### Running the release API on a server

```bash
pnpm build:server
cd server
ADMIN_TOKEN=$(openssl rand -hex 24) BIND=0.0.0.0:8080 TOWERS_JSON=../data/towers.json ./target/release/tower-api
```

Then build the app against it: `EXPO_PUBLIC_API_URL=https://your-server pnpm build:apk`.

## Ports and environment

| Name | Default | Used by |
| --- | --- | --- |
| `BIND` | `0.0.0.0:8080` | API listen address (set in `server/.env`) |
| `ADMIN_TOKEN` | generated | API admin page / review endpoints |
| `TOWERS_JSON` | `../data/towers.json` | API, to flag submissions near known towers |
| `EXPO_PUBLIC_API_URL` | auto (LAN IP) | App, where to send submissions |
