import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildWordFile } from "@/lib/wordBuilder";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

// Exports the full price-tag catalog (the "file chung" reference doc) — unlike
// /api/export-word, this never touches last_exported_at, since it's a reference
// snapshot, not the per-batch export tracked by the "Chờ xuất file" tab.
export async function POST() {
  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*, brand:brands(name)");
    if (error) throw error;

    const buf = await buildWordFile(data as Product[]);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Bang_gia_block_7.7x4cm_Toan_bo.docx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
