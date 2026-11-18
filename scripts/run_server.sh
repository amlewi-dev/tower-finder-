#!/usr/bin/env bash
# Starts the API. Creates a token the first time and keeps it in server/.env
set -euo pipefail
cd "$(dirname "$0")/../server"
if [ ! -f .env ]; then
  echo "ADMIN_TOKEN=$(openssl rand -hex 24)" > .env
  chmod 600 .env
  echo "Created server/.env with a new ADMIN_TOKEN"
fi
set -a; . ./.env; set +a
echo "Admin page:  http://localhost:8080/admin   token: $ADMIN_TOKEN"
exec cargo run --release
