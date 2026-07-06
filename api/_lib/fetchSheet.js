// api/_lib/fetchSheet.js
// ─────────────────────────────────────────────────────────────────
// Shared helper used by every API route.
// Fetches the published Google Sheet CSV and returns parsed rows.
// The SHEET_URL is stored in Vercel environment variables — it is
// NEVER visible in this source code or to any browser.
// ─────────────────────────────────────────────────────────────────

const fetch = require("node-fetch");
const { parse } = require("csv-parse/sync");

/**
 * Fetches a specific sheet from the published Google Sheet workbook.
 *
 * @param {string} sheetName  - The gid (sheet tab id) OR leave blank for first sheet
 * @returns {Array<Object>}   - Array of row objects keyed by header row
 */
async function fetchSheet(gid = "0") {
  const baseUrl = process.env.SHEET_URL;

  if (!baseUrl) {
    throw new Error(
      "SHEET_URL environment variable is not set. " +
      "Add it in Vercel → Project Settings → Environment Variables."
    );
  }

  // Build the URL for the specific sheet tab
  // gid=0 is the first sheet, gid=XXXXXXX is any other tab
  const url = `${baseUrl}&gid=${gid}&single=true&output=csv`;

  const response = await fetch(url, {
    // Bypass Google's cache so we always get fresh data
    headers: { "Cache-Control": "no-cache" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sheet (gid=${gid}): ${response.status} ${response.statusText}`
    );
  }

  const csvText = await response.text();

  // Parse CSV into array of objects using the first row as headers
  const rows = parse(csvText, {
    columns: true,          // use first row as keys
    skip_empty_lines: true,
    trim: true,             // strip whitespace from values
    relax_column_count: true,
  });

  return rows;
}

/**
 * Helper: converts a string like "75.3" or "75.3%" to a float.
 * Returns null if the value is empty or not a number.
 */
function toFloat(val) {
  if (val === null || val === undefined || val === "") return null;
  const cleaned = String(val).replace(/%/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Helper: converts a string to an integer.
 */
function toInt(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = parseInt(String(val).trim(), 10);
  return isNaN(num) ? null : num;
}

/**
 * Helper: standard JSON response with CORS headers
 */
function jsonResponse(res, data, statusCode = 200) {
  res.status(statusCode).json({
    success: true,
    updatedAt: new Date().toISOString(),
    data,
  });
}

/**
 * Helper: standard error response
 */
function errorResponse(res, message, statusCode = 500) {
  res.status(statusCode).json({
    success: false,
    error: message,
    updatedAt: new Date().toISOString(),
  });
}

module.exports = { fetchSheet, toFloat, toInt, jsonResponse, errorResponse };