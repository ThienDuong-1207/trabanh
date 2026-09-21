import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildWordFile, WordLabelItem } from "@/lib/wordBuilder";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids: string[] };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn combo nào" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("combos").select("*").in("id", ids);
    if (error) throw error;

    const items: WordLabelItem[] = (data ?? []).map((c) => ({
      ten_hang_hoa: c.ten_combo as string,
      gia_ban: c.gia_ban as number | null,
      ma_vach: c.ma_vach as string | null,
      dvt: "COMBO",
    }));

    const buf = await buildWordFile(items, "combo");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Bang_gia_block_7.7x4cm_Combo.docx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
