#!/usr/bin/env bash
# data/639.csv(.gz) + data/osm.json  ->  data/towers.json  ->  app/assets/towers.json
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f data/639.csv ]; then
  [ -f data/639.csv.gz ] || { echo "Put 639.csv.gz in data/ first (see README step 1)"; exit 1; }
  gunzip -k data/639.csv.gz
fi
(cd etl && cargo run --release -- ../data/639.csv ../data/osm.json ../data/towers.json)
cp data/towers.json app/assets/towers.json
echo "copied to app/assets/towers.json  ->  restart Metro with: cd app && npx expo start -c"
