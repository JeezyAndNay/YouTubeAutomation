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
const CREDS_PATH =
  process.env.GOOGLE_CREDENTIALS_PATH ??
  "/Users/jneal/Downloads/client_secret_899803211250-sdcqjves3ji4s6b1gdh6kh9s02s44lg7.apps.googleusercontent.com.json";

const { installed } = JSON.parse(readFileSync(CREDS_PATH, "utf-8"));
const CLIENT_ID     = installed.client_id;
const CLIENT_SECRET = installed.client_secret;
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
