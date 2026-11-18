# Tower Finder: complete setup guide (Ubuntu laptop + Android phone)

Do the parts in order. Each step says what you should see when it worked.
Project folder used below: `~/tower-finder`.

---------------------------------------------------------------------

## PART A. Install the tools on your laptop

### A1. System packages
```bash
sudo apt update
sudo apt install -y build-essential pkg-config curl git openssl unzip jq
```
`build-essential` gives the C compiler that the Rust database library needs.

### A2. Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
Press Enter to accept the default install, then **close the terminal and open a new one**.
Check:
```bash
rustc --version     # 1.80 or newer
cargo --version
```

### A3. Node.js (use nvm so you get a current version without sudo problems)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```
Close and reopen the terminal, then:
```bash
nvm install --lts
node --version      # v20 or newer
pnpm --version   # if missing: npm install -g pnpm   (or: corepack enable pnpm)
```

### A4. Put the project in place
```bash
cd ~
unzip ~/Downloads/tower-finder.zip -d ~/tmp-tf
cp -r ~/tmp-tf/tower-finder/* ~/tower-finder/      # your data/ folder is kept
rm -rf ~/tmp-tf
ls ~/tower-finder            # should list: README.md SETUP.md app data etl scripts server
ls ~/tower-finder/data       # should include 639.csv
chmod +x ~/tower-finder/scripts/*.sh
```

### A5. Phone
1. Install **Expo Go** from the Google Play Store.
2. Connect the phone to the **same Wi-Fi** as the laptop (not mobile data).
3. If the Wi-Fi is a public or hotel network it may block devices from talking to each other
   ("client isolation"). Use your home Wi-Fi, or turn on your phone's hotspot and connect the laptop to it.

---------------------------------------------------------------------

## PART B. Configure the third-party services

### B1. OpenCelliD (tower data)
You already have an account. Do this now:
1. Go to opencellid.org and log in.
2. Dashboard > **Access Tokens**. Your old token was shown in a screenshot, so click it, then **Revoke Token**.
3. Create a new token. Copy it into a private note (a password manager). **Do not put it in the app, in git, or in a screenshot.**
4. To download data again: opencellid.org > **Data** > find Kenya > click the `639` link. The download needs your token.
   Limit: each file can be downloaded twice per day, so keep your copy of `639.csv.gz`.
5. You do not need the API for the app to work. The token is only for downloads, for spot checks, and for uploading observations later.

Optional spot check of one area (replace TOKEN; BBOX is latmin,lonmin,latmax,lonmax):
```bash
curl "https://opencellid.org/cell/getInArea?key=TOKEN&BBOX=-1.30,36.80,-1.28,36.83&mcc=639&mnc=2&format=json&limit=50"
```
Your plan allows 5,000 requests per day.

### B2. OpenStreetMap (confirmation)
- **No account, key or OAuth app is needed.** Reading data through Overpass is open.
- The "OAuth 2 application" page you opened is only for apps that edit OSM for users. Ignore it.
- Be polite to the public servers: run `fetch_osm.sh` once, not in a loop.

### B3. Expo account (only needed for building an APK)
1. Sign up at https://expo.dev/signup.
2. Remember the username and password. You use them in Part G.
3. Expo Go itself does not need an account for local testing.

### B4. Things you do NOT need
Google Maps API key (the map uses OpenStreetMap), Apple developer account (Android only), any paid service.

---------------------------------------------------------------------

## PART C. Build the tower data

### C1. Check the CSV
```bash
cd ~/tower-finder
head -3 data/639.csv
cut -d, -f3 data/639.csv | sort | uniq -c | sort -rn | head -5
```
Expected: lots of rows with MNC 2 (Safaricom), 3 (Airtel), 7 (Telkom). The file has no header row. That is normal.

If you ever need to unpack a new download, use the terminal, not the file manager (the file manager gave you the "mtree" error):
```bash
gunzip -k data/639.csv.gz
```

### C2. Download OpenStreetMap towers
```bash
./scripts/fetch_osm.sh
```
Expected: `saved data/osm.json (… K)`.
If it fails with a timeout or 429, wait a minute and run it again. If it keeps failing, edit the script and replace
`https://overpass-api.de/api/interpreter` with `https://overpass.kumi.systems/api/interpreter`.

### C3. Process everything into towers.json
```bash
./scripts/build_data.sh
```
The first run compiles Rust (a minute or two). Expected last lines:
```
Safaricom: NNNNN towers
Airtel: NNNN towers
Telkom: NNN towers
NNNNN towers total, NNNN confirmed by OSM -> ../data/towers.json
copied to app/assets/towers.json
```
Check the file:
```bash
jq length data/towers.json
jq '.[0]' data/towers.json
```
A low OSM "confirmed" number is normal because OSM coverage in Kenya is patchy.

---------------------------------------------------------------------

## PART D. Run the API server

### D1. Start it
Open a **new terminal** (leave it running):
```bash
cd ~/tower-finder
./scripts/run_server.sh
```
First run creates `server/.env` with a random `ADMIN_TOKEN`, compiles, and prints:
```
Admin page:  http://localhost:8080/admin   token: <your token>
tower-api listening on http://0.0.0.0:8080
```
Copy the token somewhere safe. It is also in `server/.env`.

### D2. Test it
In another terminal:
```bash
curl http://localhost:8080/api/health          # {"ok":true}
curl http://localhost:8080/api/towers/community   # []
```
Open http://localhost:8080/admin in your browser, paste the token. You should see "Nothing here."

### D3. Let your phone reach it
1. Find the laptop's Wi-Fi address:
   ```bash
   hostname -I
   ```
   Use the first address that looks like `192.168.x.x` or `10.x.x.x`.
2. Open the firewall port (only if ufw is active):
   ```bash
   sudo ufw status
   sudo ufw allow 8080/tcp
   ```
3. On the phone's browser open `http://YOUR_IP:8080/api/health`. You must see `{"ok":true}`.
   If you do not, the app cannot submit towers either. Fix this first (same Wi-Fi, firewall, no client isolation).

---------------------------------------------------------------------

## PART E. Run the app on your phone

```bash
cd ~/tower-finder/app
cp .env.example .env
nano .env
```
Set the line to your laptop address:
```
EXPO_PUBLIC_API_URL=http://192.168.1.23:8080
```
Save (Ctrl+O, Enter, Ctrl+X). Then:
```bash
pnpm install
pnpm exec expo start -c
```
1. A QR code appears in the terminal.
2. Open **Expo Go** on the phone and tap **Scan QR code**.
3. Allow **location** when asked.
4. Wait for the GPS fix (outdoors is much faster).

What you should see: the **Radar** tab with an arrow, a distance, and a list of nearby towers.

Problems:
- **"Project is incompatible with this version of Expo Go"**: the app uses a very new Expo SDK. Update Expo Go from the Play Store. If the store version is older than the project, run `cd ~/tower-finder/app && pnpm exec expo install expo@latest --fix` or tell me and I will adjust it.
- **Phone cannot load the bundle**: confirm same Wi-Fi, then try `pnpm exec expo start -c --tunnel` (it asks to install a helper, say yes).
- **No towers listed**: you skipped Part C, or you did not restart Metro with `-c` after building the data.
- **Compass jumps around**: wave the phone in a figure 8 to calibrate, and keep it away from metal and magnets.

### Full test of the crowdsourcing flow
1. Open the **Add** tab. Wait until the badge shows 50 m or better (go outside).
2. Tap **Open camera**, allow camera, take a photo of any tower or mast.
3. Pick the operator, add a note, tap **Submit for review**. You should see "Submitted".
4. On the laptop open http://localhost:8080/admin. The submission shows up with the photo, a link to OpenStreetMap, and flags.
5. Click **Approve**.
6. In the app, on the Radar tab, pull down to refresh. The Map tab shows the community tower with a yellow ring.

If submitting fails with "Network request failed": the API address in `app/.env` is wrong or the phone cannot reach the laptop. Repeat D3.

---------------------------------------------------------------------

## PART F. Put the API on the internet (needed before you share the app)

An APK on other people's phones cannot reach your laptop. Pick one.

### F1. Quick demo: Cloudflare quick tunnel (free, no domain)
1. Install `cloudflared` following https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. With the API running:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```
3. It prints a `https://something.trycloudflare.com` address. Use it as `EXPO_PUBLIC_API_URL`.
   The address changes each time you restart it, and your laptop must stay on.

### F2. Proper: a small VPS with HTTPS
Needs: an Ubuntu VPS (1 GB RAM is enough), and a domain or subdomain such as `api.yourdomain.com`.

1. In your domain's DNS add an **A record**: `api` pointing to the VPS IP address.
2. Build on the laptop and copy the binary (same Ubuntu release avoids library problems):
   ```bash
   cd ~/tower-finder/server && cargo build --release
   ssh user@VPS_IP "mkdir -p ~/tower-api/data ~/tower-api/uploads"
   scp target/release/tower-api user@VPS_IP:~/tower-api/
   scp ../data/towers.json user@VPS_IP:~/tower-api/towers.json
   ```
3. On the VPS create the service file:
   ```bash
   sudo nano /etc/systemd/system/tower-api.service
   ```
   ```ini
   [Unit]
   Description=Tower Finder API
   After=network.target

   [Service]
   User=YOUR_VPS_USER
   WorkingDirectory=/home/YOUR_VPS_USER/tower-api
   Environment=ADMIN_TOKEN=PASTE_A_LONG_RANDOM_TOKEN
   Environment=TOWERS_JSON=/home/YOUR_VPS_USER/tower-api/towers.json
   Environment=BIND=127.0.0.1:8080
   ExecStart=/home/YOUR_VPS_USER/tower-api/tower-api
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   Generate the token with `openssl rand -hex 24`. Then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tower-api
   systemctl status tower-api
   ```
4. Install Caddy (automatic HTTPS) following https://caddyserver.com/docs/install#debian-ubuntu-raspbian, then:
   ```bash
   sudo nano /etc/caddy/Caddyfile
   ```
   ```
   api.yourdomain.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```
   ```bash
   sudo systemctl reload caddy
   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   ```
5. Test: `curl https://api.yourdomain.com/api/health` must return `{"ok":true}`.
   Admin page: `https://api.yourdomain.com/admin`.
6. Back up `~/tower-api/data/app.db` and `~/tower-api/uploads/` regularly.

---------------------------------------------------------------------

## PART G. Build an installable Android APK

1. Set the API address for the build. Edit `app/eas.json` after step 3 so the preview profile looks like this
   (the `.env` file is not uploaded to the build server, so the address must be in this file):
   ```json
   {
     "cli": { "version": ">= 16.0.0" },
     "build": {
       "preview": {
         "distribution": "internal",
         "android": { "buildType": "apk" },
         "env": { "EXPO_PUBLIC_API_URL": "https://api.yourdomain.com" }
       },
       "production": {}
     }
   }
   ```
2. In `app/app.json`, once you use HTTPS, delete the whole `expo-build-properties` plugin entry
   (it only exists to allow plain http during testing).
3. Commands:
   ```bash
   cd ~/tower-finder/app
   pnpm add -g eas-cli
   eas login                      # your expo.dev account
   eas build:configure            # choose Android; it creates eas.json
   ```
   Now apply the eas.json edit from step 1, then:
   ```bash
   eas build -p android --profile preview
   ```
4. Wait for the build (about 10 to 20 minutes). It prints a link. Open it on your phone, download the APK, and install it
   (Android asks to allow installs from your browser: accept).
5. The bundled `towers.json` is inside the APK, so rebuild the APK whenever you refresh the data.

---------------------------------------------------------------------

## PART H. Publish the project (portfolio)

```bash
cd ~/tower-finder
git init
git add .
git commit -m "Tower Finder"
```
The `.gitignore` already keeps out `data/`, tokens, uploads and the database. Create a repo on GitHub and push.
Add to the repo: screenshots, a 30 to 60 second screen recording of Radar, Map and Add, and the attribution lines from the README.

Never commit: your OpenCelliD token, `server/.env`, the raw CSV.

---------------------------------------------------------------------

## Troubleshooting quick list

| Symptom | Fix |
|---|---|
| `cargo: command not found` | Open a new terminal after installing Rust, or run `source ~/.cargo/env` |
| `linker cc not found` | `sudo apt install build-essential` |
| Server exits asking for ADMIN_TOKEN | Use `./scripts/run_server.sh`, or `export ADMIN_TOKEN=$(openssl rand -hex 24)` first |
| `Address already in use` | Another copy is running: `pkill tower-api` |
| Admin page says bad token | Click "Change token" and paste the one from `server/.env` |
| Radar says "No tower data bundled" | Run Part C, then `pnpm exec expo start -c` |
| GPS never reaches 50 m | Go outside, wait 30 to 60 seconds, turn off battery saver |
| Map is blank | The map needs internet for OpenStreetMap tiles; check phone data or Wi-Fi |
| Submit says "location is outside Kenya" | Server only accepts Kenyan coordinates (change the bounds in `server/src/main.rs` to test elsewhere) |
| "daily submission limit reached" | 10 per device per day; raise `MAX_PER_DEVICE_PER_DAY` in `server/src/main.rs` while testing |
| After changing Rust code | Stop the server and run `./scripts/run_server.sh` again |
