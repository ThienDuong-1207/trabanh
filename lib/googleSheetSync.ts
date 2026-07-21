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

      for (const row of values.slice(1)) {
        const record: ProductRow = { category_sheet: category };
        let hasMaNoiBo = false;
        fieldByCol.forEach((field, colIndex) => {
          const raw = row[colIndex];
          const value = raw === undefined || raw === "" ? null : raw;
          if (field === "ma_noi_bo" && value) hasMaNoiBo = true;
          record[field] = NUMERIC_FIELDS.has(field) && value !== null ? Number(value) : value;
        });
        if (hasMaNoiBo) rows.push(record);
      }
    });
  }

  const summary = await upsertProductRows(rows, "update-all");
  return { ...summary, skippedSheets };
}
