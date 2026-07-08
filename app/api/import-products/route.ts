import { NextRequest, NextResponse } from "next/server";
import { importProductsFromWorkbook } from "@/lib/excelImport";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn file Excel" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await importProductsFromWorkbook(buffer);
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
