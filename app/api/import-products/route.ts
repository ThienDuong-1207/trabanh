import { NextRequest, NextResponse } from "next/server";
import { importProductsFromWorkbook, ImportMode } from "@/lib/excelImport";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn file Excel" }, { status: 400 });
    }
    const mode: ImportMode = form.get("mode") === "update-all" ? "update-all" : "new-only";
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await importProductsFromWorkbook(buffer, mode);
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
