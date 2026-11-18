#!/usr/bin/env node
// Runs the Rust API and the Expo app together from one terminal.
//   node scripts/dev.mjs            -> API + Expo (scan QR with Expo Go)
//   node scripts/dev.mjs --web      -> API + Expo web in the browser
//   node scripts/dev.mjs --api-only -> just the API
//   node scripts/dev.mjs --app-only -> just Expo (uses an API that is already running)
// Any other flags (e.g. --tunnel, --android, -c) are passed to `expo start`.
import concurrently from "concurrently";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(root, "server");
const appDir = join(root, "app");
const args = process.argv.slice(2);
const apiOnly = args.includes("--api-only");
const appOnly = args.includes("--app-only");
const expoArgs = args.filter((a) => a !== "--api-only" && a !== "--app-only");
const isWeb = expoArgs.includes("--web");

function loadServerEnv() {
  const envPath = join(serverDir, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `ADMIN_TOKEN=${randomBytes(24).toString("hex")}\n`);
    chmodSync(envPath, 0o600);
    console.log("Created server/.env with a new ADMIN_TOKEN");
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function lanIp() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && !/^(docker|br-|veth|virbr)/.test(name)) candidates.push(a.address);
    }
  }
  return candidates.find((ip) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip)) ?? candidates[0] ?? "127.0.0.1";
}

function has(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

const serverEnv = loadServerEnv();
const port = (serverEnv.BIND ?? process.env.BIND ?? "0.0.0.0:8080").split(":").pop();
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? `http://${isWeb ? "localhost" : lanIp()}:${port}`;

const prebuilt = join(serverDir, "target", "release", "tower-api");
const apiCommand = has("cargo") ? "cargo run --release" : existsSync(prebuilt) ? prebuilt : null;
if (!appOnly && !apiCommand) {
  console.error("Rust is not installed and no prebuilt server was found. Install Rust (see SETUP.md A2) or run with --app-only.");
  process.exit(1);
}
if (!existsSync(join(appDir, "node_modules"))) {
  console.error("App dependencies missing. Run:  pnpm bootstrap");
  process.exit(1);
}
if (!existsSync(join(appDir, "assets", "towers.json"))) {
  console.warn("app/assets/towers.json is missing. Run:  pnpm data   (the map will be empty until you do)");
}

const commands = [];
if (!appOnly) {
  commands.push({
    name: "api",
    command: apiCommand,
    cwd: serverDir,
    prefixColor: "magenta",
    env: { ...serverEnv, RUST_LOG: process.env.RUST_LOG ?? "info" },
  });
}
if (!apiOnly) {
  commands.push({
    name: "app",
    command: `pnpm exec expo start ${expoArgs.join(" ")}`.trim(),
    cwd: appDir,
    prefixColor: "cyan",
    env: { EXPO_PUBLIC_API_URL: apiUrl },
  });
}

console.log("\n  Tower Finder dev");
if (!appOnly) console.log(`  API     http://localhost:${port}/api/health`);
if (!appOnly) console.log(`  Admin   http://localhost:${port}/admin   token: ${serverEnv.ADMIN_TOKEN}`);
if (!apiOnly) console.log(`  App ->  EXPO_PUBLIC_API_URL=${apiUrl}`);
console.log("  Ctrl+C stops everything\n");

const { result } = concurrently(commands, {
  prefix: "name",
  killOthersOn: ["failure"],
  restartTries: 3,
  restartDelay: 2000,
});
result.then(
  () => process.exit(0),
  () => process.exit(1),
);
