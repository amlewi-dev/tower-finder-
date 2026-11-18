#!/usr/bin/env bash
# Downloads every mobile-phone mast/tower OpenStreetMap knows in Kenya (no account or key needed).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
curl -fG https://overpass-api.de/api/interpreter \
  -H 'User-Agent: tower-finder/0.1 (personal project)' \
  --data-urlencode 'data=[out:json][timeout:180];
area["ISO3166-1"="KE"][admin_level=2]->.ke;
(
  nwr["man_made"~"^(mast|tower)$"]["tower:type"="communication"](area.ke);
  nwr["communication:mobile_phone"="yes"](area.ke);
);
out center;' -o data/osm.json
echo "saved data/osm.json ($(du -h data/osm.json | cut -f1))"
