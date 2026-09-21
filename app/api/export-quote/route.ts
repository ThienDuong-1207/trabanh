import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { applySavoTamixCaseOverride, buildQuotePdf, QuoteInfo } from "@/lib/quoteBuilder";
import { resolveQuoteItemNames } from "@/lib/productTranslation";
import { Product } from "@/lib/types";

export const runtime = "nodejs";
// Mặc định 10s không đủ khi cần dịch nhiều sản phẩm chưa có cache (mỗi lô
// dịch chạy song song nhưng vẫn cần vài chục giây cho những đợt xuất báo giá
// Anh/Trung lần đầu với danh mục lớn) — nới lên mức tối đa còn hỗ trợ ở gói
// Hobby, tránh request bị Vercel cắt giữa chừng.
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
    const buf = await buildQuotePdf(items, info);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Bao_gia.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
