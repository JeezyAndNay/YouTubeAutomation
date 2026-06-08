// Google Sheets client — Idea Catalog
// Sheet: 1kF8cfyh3qZZIcPcSWYs8olZZYPxFhxBTUhtjK04Eb68  tab: Ideas
//
// Run `node scripts/google-auth.mjs` once to populate GOOGLE_REFRESH_TOKEN in .env.local

import { google } from "googleapis";

const SPREADSHEET_ID = "1kF8cfyh3qZZIcPcSWYs8olZZYPxFhxBTUhtjK04Eb68";
const SHEET_NAME     = "Ideas";

// Column order as it appears in the sheet (matches n8n Mark In Progress schema)
const COLUMNS = [
  "ID", "DATE_ADDED", "STATUS", "TOPIC", "ANGLE",
  "KEY_EVIDENCE", "KEY_RESEARCHERS", "HOOK_STYLE",
  "TONE_DIAL", "RELATED_VIDEO", "NOTES",
] as const;

export type IdeaStatus = "New" | "In Progress" | "Complete";

export type Idea = {
  id: string;
  rowNumber: number;   // 1-based sheet row (header = row 1, data starts at row 2)
  dateAdded: string;
  status: IdeaStatus;
  topic: string;
  angle: string;
  keyEvidence: string;
  keyResearchers: string;
  hookStyle: string;
  toneDial: string;
  relatedVideo: string;
  notes: string;
};

// ── Auth ──────────────────────────────────────────────────────────────────────

function getClient() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google credentials not configured. Run `node scripts/google-auth.mjs` first."
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function sheets() {
  return google.sheets({ version: "v4", auth: getClient() });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeStatus(raw: string): IdeaStatus {
  const trimmed = raw.trim();
  if (trimmed === "In Progress") return "In Progress";
  if (trimmed === "Complete")    return "Complete";
  return "New";
}

function rowToIdea(row: string[], rowNumber: number): Idea {
  const get = (col: typeof COLUMNS[number]) => row[COLUMNS.indexOf(col)] ?? "";
  return {
    id:              get("ID"),
    rowNumber,
    dateAdded:       get("DATE_ADDED"),
    status:          normalizeStatus(get("STATUS")),
    topic:           get("TOPIC"),
    angle:           get("ANGLE"),
    keyEvidence:     get("KEY_EVIDENCE"),
    keyResearchers:  get("KEY_RESEARCHERS"),
    hookStyle:       get("HOOK_STYLE"),
    toneDial:        get("TONE_DIAL"),
    relatedVideo:    get("RELATED_VIDEO"),
    notes:           get("NOTES"),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getIdeas(): Promise<Idea[]> {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:K`,
  });

  const rows = res.data.values ?? [];
  // row 0 = headers, data starts at row 1 (sheet row 2)
  return rows
    .slice(1)
    .map((row, i) => rowToIdea(row as string[], i + 2))
    .filter((idea) => idea.topic.trim() !== "");
}

export async function updateIdea(
  rowNumber: number,
  patch: Partial<Pick<Idea, "status" | "topic" | "angle" | "notes" | "keyEvidence" | "keyResearchers" | "hookStyle" | "toneDial" | "relatedVideo">>
) {
  // Read the current row first to preserve untouched cells
  const range = `${SHEET_NAME}!A${rowNumber}:K${rowNumber}`;
  const cur = await sheets().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  const current = (cur.data.values?.[0] ?? []) as string[];

  const updated = [...current];
  const set = (col: typeof COLUMNS[number], val: string | undefined) => {
    if (val !== undefined) updated[COLUMNS.indexOf(col)] = val;
  };

  set("STATUS",          patch.status);
  set("TOPIC",           patch.topic);
  set("ANGLE",           patch.angle);
  set("NOTES",           patch.notes);
  set("KEY_EVIDENCE",    patch.keyEvidence);
  set("KEY_RESEARCHERS", patch.keyResearchers);
  set("HOOK_STYLE",      patch.hookStyle);
  set("TONE_DIAL",       patch.toneDial);
  set("RELATED_VIDEO",   patch.relatedVideo);

  await sheets().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [updated] },
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function getIdeasSheetId(): Promise<number> {
  const res = await sheets().spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = res.data.sheets?.find((s) => s.properties?.title === SHEET_NAME);
  if (sheet?.properties?.sheetId === undefined || sheet.properties.sheetId === null) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in spreadsheet`);
  }
  return sheet.properties.sheetId;
}

/**
 * Permanently removes the row for the given rowNumber from the Google Sheet.
 * All rows below shift up by one — subsequent row numbers become stale, so
 * always re-fetch the idea list after calling this.
 */
export async function deleteIdea(rowNumber: number) {
  const sheetId = await getIdeasSheetId();
  await sheets().spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1, // Sheets API is 0-based; row 2 → index 1
              endIndex:   rowNumber,     // exclusive upper bound
            },
          },
        },
      ],
    },
  });
}
