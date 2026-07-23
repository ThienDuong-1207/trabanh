import { google } from "googleapis";
import {
  COLUMN_TO_FIELD,
  NUMERIC_FIELDS,
  SKIP_SHEETS,
  resolveCategoryName,
  upsertProductRows,
  ImportSummary,
  ProductRow,
} from "./excelImport";

// Mirrors importProductsFromWorkbook (lib/excelImport.ts) but reads a Google
// Sheet instead of an uploaded .xlsx — same tab-per-category, same
// COLUMN_TO_FIELD headers, so both sources share the exact same row shape
// and the same upsertProductRows() write path.
export async function syncFromGoogleSheet(): Promise<ImportSummary> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!apiKey || !spreadsheetId) {
    throw new Error("Thiếu biến môi trường GOOGLE_API_KEY / GOOGLE_SHEET_ID");
  }

  // API-key-only auth (no service account) — works because the Sheet is
  // shared as "Anyone with the link: Viewer", which Google Cloud's default
  // org policy (iam.disableServiceAccountKeyCreation) doesn't block, unlike
  // creating a service account JSON key.
  const sheets = google.sheets({ version: "v4", auth: apiKey });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allTabNames = (meta.data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => !!t);

  const skippedSheets: string[] = [];
  const matchedTabs: { name: string; category: string }[] = [];
  for (const name of allTabNames) {
    if (SKIP_SHEETS.has(name)) continue;
    const category = resolveCategoryName(name);
    if (!category) {
      skippedSheets.push(name);
      continue;
    }
    matchedTabs.push({ name, category });
  }

  const rows: ProductRow[] = [];
  if (matchedTabs.length > 0) {
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: matchedTabs.map((t) => `'${t.name}'!A:Z`),
      // Without this, cells formatted as currency come back as their DISPLAY
      // string (e.g. "82.000 đ") instead of the raw number — Number() on
      // that yields NaN, which JSON-serializes to null and silently wipes
      // the price in the database. UNFORMATTED_VALUE returns the real
      // underlying value (82000) regardless of how the cell is formatted.
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    (data.valueRanges ?? []).forEach((range, i) => {
      const { category } = matchedTabs[i];
      const values = range.values ?? [];
      if (values.length === 0) return;

      const header = values[0];
      const fieldByCol = new Map<number, string>();
      header.forEach((h, colIndex) => {
        const field = COLUMN_TO_FIELD[String(h ?? "").trim()];
        if (field) fieldByCol.set(colIndex, field);
      });

      values.slice(1).forEach((row, rowIndex) => {
        // +1 for the header row already sliced off, +1 to convert 0-based to
        // the 1-based row number as it appears in the actual Google Sheet.
        const record: ProductRow = { category_sheet: category, row_number: rowIndex + 2 };
        let hasMaNoiBo = false;
        fieldByCol.forEach((field, colIndex) => {
          const raw = row[colIndex];
          const value = raw === undefined || raw === "" ? null : raw;
          if (field === "ma_noi_bo" && value) hasMaNoiBo = true;
          if (NUMERIC_FIELDS.has(field) && value !== null) {
            const n = Number(value);
            // Guard against ever writing NaN — it JSON-serializes to null and
            // would silently wipe an existing price if some cell still comes
            // back unparsable despite UNFORMATTED_VALUE.
            record[field] = Number.isNaN(n) ? null : n;
          } else {
            record[field] = value;
          }
        });
        if (hasMaNoiBo) rows.push(record);
      });
    });
  }

  const summary = await upsertProductRows(rows, "update-all");
  return { ...summary, skippedSheets };
}
