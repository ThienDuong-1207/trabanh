import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildWordFile } from "@/lib/wordBuilder";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids: string[] };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*").in("id", ids);
    if (error) throw error;

    const buf = await buildWordFile(data as Product[]);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Bang_gia_block_7.7x4cm_Update.docx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
