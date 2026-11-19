#!/usr/bin/env bash
# Turns the repo into ONE pnpm workspace (the layout Expo and EAS document for monorepos):
#
#   tower-finder/                 <- git root, the ONLY pnpm-workspace.yaml and pnpm-lock.yaml
#     package.json                <- project scripts (pnpm dev, pnpm data, ...)
#     pnpm-workspace.yaml         <- packages: [app], nodeLinker: hoisted
#     .easignore                  <- what EAS uploads (includes the generated towers.json)
#     app/                        <- the Expo project: app.json, eas.json, package.json
#     etl/  server/  scripts/     <- Rust crates and helper scripts (not part of pnpm)
#
# Rules after this:  install from the ROOT, run expo/eas/expo-doctor from app/.
# Safe to run twice. It never touches your source code, Rust, or data.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f app/package.json ] || { echo "app/package.json not found. Run this from the tower-finder repo."; exit 1; }
command -v node >/dev/null || { echo "node is required"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required"; exit 1; }
PNPM_VERSION="$(pnpm --version | tail -1)"

say() { printf '\n== %s\n' "$*"; }

say "1/7 Stray root app.json (created by running 'eas init' at the repo root)"
if [ -f app.json ]; then
  node -e '
    const fs = require("fs");
    const root = JSON.parse(fs.readFileSync("app.json", "utf8")).expo || {};
    const p = "app/app.json";
    const a = JSON.parse(fs.readFileSync(p, "utf8"));
    a.expo.extra = { ...(a.expo.extra || {}), ...(root.extra || {}) };
    if (root.owner) a.expo.owner = root.owner;
    fs.writeFileSync(p, JSON.stringify(a, null, 2) + "\n");
    console.log("moved EAS project id into app/app.json:", (a.expo.extra.eas || {}).projectId || "(none)");
  '
  rm app.json
else
  echo "none, nothing to move"
fi

say "2/7 One workspace file at the root"
CARRY=""
if [ -f app/pnpm-workspace.yaml ]; then
  # keep pnpm settings such as minimumReleaseAgeExclude, drop the nested 'packages' key if present
  CARRY="$(awk '/^packages:/{skip=1; next} skip && /^[[:space:]]+-/{next} {skip=0; print}' app/pnpm-workspace.yaml)"
fi
{
  echo "# Single pnpm workspace for the whole repo (Expo needs a flat node_modules)."
  echo "packages:"
  echo "  - app"
  echo "nodeLinker: hoisted"
  if [ -n "$CARRY" ]; then echo "$CARRY" | grep -v '^nodeLinker:' ; fi
} > pnpm-workspace.yaml
cat pnpm-workspace.yaml

say "3/7 Remove the nested workspace, extra lockfiles and old installs"
rm -f app/pnpm-workspace.yaml app/pnpm-lock.yaml app/package-lock.json app/yarn.lock app/.npmrc
rm -f package-lock.json yarn.lock pnpm-lock.yaml
rm -rf node_modules app/node_modules
echo "done (pnpm will create a single pnpm-lock.yaml at the root)"

say "4/7 Root package.json: pin pnpm and point scripts at the app workspace"
PNPM_VERSION="$PNPM_VERSION" node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.packageManager = "pnpm@" + process.env.PNPM_VERSION;
  p.scripts = p.scripts || {};
  Object.assign(p.scripts, {
    bootstrap: "pnpm install && pnpm build:server && pnpm build:etl",
    typecheck: "pnpm --filter app exec tsc --noEmit",
    "build:web": "pnpm --filter app exec expo export --platform web --output-dir dist",
    doctor: "cd app && npx expo-doctor",
    "build:apk": "cd app && eas build --platform android --profile preview",
    "build:aab": "cd app && eas build --platform android --profile production",
    update: "cd app && eas update",
  });
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  console.log("packageManager = pnpm@" + process.env.PNPM_VERSION);
'

say "5/7 app/eas.json (EAS config lives next to app.json)"
if [ -f app/eas.json ]; then
  echo "app/eas.json already exists, left as is. Make sure each build profile has: \"pnpm\": \"$PNPM_VERSION\""
else
  cat > app/eas.json <<EOF
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "base": {
      "pnpm": "$PNPM_VERSION"
    },
    "preview": {
      "extends": "base",
      "distribution": "internal",
      "environment": "preview",
      "android": { "buildType": "apk" }
    },
    "production": {
      "extends": "base",
      "environment": "production",
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {}
  }
}
EOF
  echo "created app/eas.json (pnpm $PNPM_VERSION on EAS, same as your laptop)"
fi

say "6/7 .easignore (so EAS uploads the generated towers.json even though git ignores it)"
{
  echo "# Used by EAS instead of .gitignore when packing the project for a cloud build."
  if [ -f .gitignore ]; then grep -vE 'towers\.json' .gitignore || true; fi
  for line in "node_modules/" "target/" "data/" ".env" "*.keystore" "*.jks" "*.apk" "*.aab" "server/uploads/" "server/data/" "dist/" ".expo/"; do
    grep -qxF "$line" .gitignore 2>/dev/null || echo "$line"
  done
} | awk '!seen[$0]++' > .easignore
echo "wrote .easignore"
if [ ! -s app/assets/towers.json ] || [ "$(tr -d '[:space:]' < app/assets/towers.json)" = "[]" ]; then
  echo "WARNING: app/assets/towers.json is missing or empty. Run: pnpm data"
else
  echo "app/assets/towers.json present: $(du -h app/assets/towers.json | cut -f1)"
fi

say "7/7 Install once, from the root"
pnpm install
echo
echo "Done. From now on:"
echo "  install   : pnpm install            (repo root, one lockfile)"
echo "  run app   : pnpm dev                (or: cd app && pnpm exec expo start -c)"
echo "  check     : pnpm typecheck && pnpm doctor"
echo "  eas/expo  : always cd app first"
echo
echo "Then commit:  git add -A && git commit -m \"build: unify pnpm workspace at repo root and move EAS config into app/\""
