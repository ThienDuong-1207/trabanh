import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildQuoteExcel } from "@/lib/quoteExcelBuilder";
import { applySavoTamixCaseOverride, QuoteInfo } from "@/lib/quoteBuilder";
import { resolveQuoteItemNames } from "@/lib/productTranslation";
import { Product } from "@/lib/types";

export const runtime = "nodejs";
// Xem chú thích tương ứng trong app/api/export-quote/route.ts.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { ids, savoTamixCaseOverride, ...info } = (await req.json()) as { ids: string[]; savoTamixCaseOverride?: boolean } & QuoteInfo;
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*, brand:brands(name)").in("id", ids);
    if (error) throw error;

    let items = savoTamixCaseOverride ? applySavoTamixCaseOverride(data as Product[]) : (data as Product[]);
    if (info.lang === "en" || info.lang === "zh") {
      items = await resolveQuoteItemNames(items, info.lang);
    }
    const buf = await buildQuoteExcel(items, info);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Bao_gia.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
