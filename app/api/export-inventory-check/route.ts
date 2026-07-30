import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildInventoryCheckPdf } from "@/lib/inventoryCheckBuilder";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { ids, startDate } = (await req.json()) as { ids: string[]; startDate: string };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: "Chưa chọn ngày bắt đầu" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*, brand:brands(name)").in("id", ids);
    if (error) throw error;

    const buf = await buildInventoryCheckPdf(data as Product[], startDate);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/pdf" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
