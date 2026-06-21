#!/usr/bin/env node
/**
 * One-time Google OAuth2 setup.
 * Uses the "installed" client from Downloads — run this once, then never again.
 *
 * Usage:
 *   node scripts/google-auth.mjs
 *
 * On success it writes GOOGLE_REFRESH_TOKEN to .env.local.
 */

import { createServer } from "http";
import { google } from "googleapis";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Credentials ──────────────────────────────────────────────────────────────
// Priority:
//   1. GOOGLE_CREDENTIALS_PATH env var → JSON file
//   2. JSON file at the default Downloads path
//   3. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET already in .env.local

const CREDS_PATH =
  process.env.GOOGLE_CREDENTIALS_PATH ??
  "/Users/jneal/Downloads/client_secret_899803211250-sdcqjves3ji4s6b1gdh6kh9s02s44lg7.apps.googleusercontent.com.json";

let CLIENT_ID, CLIENT_SECRET;
try {
  const { installed } = JSON.parse(readFileSync(CREDS_PATH, "utf-8"));
  CLIENT_ID     = installed.client_id;
  CLIENT_SECRET = installed.client_secret;
  console.log("✓ Loaded credentials from JSON file");
} catch {
  // JSON file missing — pull from .env.local instead
  const envPath = resolve(__dirname, "../.env.local");
  const envText = readFileSync(envPath, "utf-8");
  const get = (key) => envText.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
  CLIENT_ID     = get("GOOGLE_CLIENT_ID");
  CLIENT_SECRET = get("GOOGLE_CLIENT_SECRET");
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("ERROR: No credentials file found and GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set in .env.local");
    process.exit(1);
  }
  console.log("✓ Loaded credentials from .env.local (JSON file not found — that's OK)");
}
const REDIRECT_PORT = 3001;
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}`;

// ── OAuth2 client ─────────────────────────────────────────────────────────────
const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
];

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

// ── Callback server ───────────────────────────────────────────────────────────
console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for Google to redirect back...\n");

// Try to open browser automatically
const { exec } = await import("child_process");
exec(`open "${authUrl}"`);

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
    const code = url.searchParams.get("code");
    if (!code) {
      res.end("No code received. Try again.");
      return reject(new Error("No code in callback"));
    }
    res.end("<h2>Auth complete — you can close this tab.</h2>");
    server.close();
    resolve(code);
  });
  server.listen(REDIRECT_PORT);
});

// ── Exchange code for tokens ──────────────────────────────────────────────────
const { tokens } = await oauth2.getToken(code);
const refreshToken = tokens.refresh_token;

if (!refreshToken) {
  console.error(
    "\nNo refresh_token returned. This usually means the account was already authorized.\n" +
    "Go to https://myaccount.google.com/permissions and revoke access to this app, then re-run."
  );
  process.exit(1);
}

// ── Write to .env.local ───────────────────────────────────────────────────────
const envPath = resolve(__dirname, "../.env.local");
let env = readFileSync(envPath, "utf-8");

const line = `GOOGLE_REFRESH_TOKEN=${refreshToken}`;
if (env.includes("GOOGLE_REFRESH_TOKEN=")) {
  env = env.replace(/GOOGLE_REFRESH_TOKEN=.*/m, line);
} else {
  env += `\n${line}\n`;
}
writeFileSync(envPath, env, "utf-8");

console.log("✓ GOOGLE_REFRESH_TOKEN written to .env.local");
console.log("  Restart `npm run dev` to pick up the new token.\n");
