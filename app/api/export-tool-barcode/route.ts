import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildToolBarcodeFile } from "@/lib/toolBarcodeBuilder";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

const TOOL_CATEGORY = "Công cụ dụng cụ";

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids: string[] };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*, brand:brands(name)").in("id", ids);
    if (error) throw error;

    const toolItems = (data as Product[]).filter((p) => p.category_sheet === TOOL_CATEGORY);
    if (toolItems.length === 0) {
      return NextResponse.json(
        { error: `Không có sản phẩm nhóm "${TOOL_CATEGORY}" nào trong danh sách đã chọn.` },
        { status: 400 }
      );
    }

    const buf = await buildToolBarcodeFile(toolItems);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Tem_ma_vach_CCDC.docx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
