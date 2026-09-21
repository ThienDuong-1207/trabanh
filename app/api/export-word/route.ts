import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildWordFile, WordLabelItem, WordLabelMode } from "@/lib/wordBuilder";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const {
      ids,
      mode: rawMode,
      promoFrom,
      promoTo,
    } = (await req.json()) as { ids: string[]; mode?: string; promoFrom?: string; promoTo?: string };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }
    const mode: WordLabelMode = rawMode === "price_change" ? "price_change" : "normal";
    const promo = mode === "price_change" && promoFrom && promoTo ? { from: promoFrom, to: promoTo } : undefined;

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*").in("id", ids);
    if (error) throw error;

    let items: WordLabelItem[] = data as Product[];
    let skippedNames: string[] = [];

    if (mode === "price_change") {
      // Lấy đúng 1 lần đổi giá bán lẻ GẦN NHẤT của mỗi mã (bỏ qua các dòng
      // price_history chỉ đổi giá thùng, gia_ban_old === gia_ban_new lúc đó)
      // — mã nào chưa từng thật sự đổi giá bán lẻ thì không có "giá cũ" để
      // in, bị loại khỏi tem đợt này thay vì in sai/thiếu.
      const { data: history, error: histErr } = await supabase
        .from("price_history")
        .select("product_id, gia_ban_old, gia_ban_new, changed_at")
        .in("product_id", ids)
        .order("changed_at", { ascending: false });
      if (histErr) throw histErr;

      const oldPriceByProduct = new Map<string, number>();
      for (const h of history ?? []) {
        const productId = h.product_id as string;
        if (oldPriceByProduct.has(productId)) continue;
        const oldPrice = h.gia_ban_old as number | null;
        const newPrice = h.gia_ban_new as number | null;
        if (oldPrice === null || newPrice === null || oldPrice === newPrice) continue;
        oldPriceByProduct.set(productId, oldPrice);
      }

      const eligible: WordLabelItem[] = [];
      for (const p of data as Product[]) {
        const oldPrice = oldPriceByProduct.get(p.id);
        if (oldPrice === undefined) {
          skippedNames.push(p.ten_hang_hoa);
          continue;
        }
        eligible.push({ ...p, gia_ban_old: oldPrice });
      }
      items = eligible;
    }

    const buf = await buildWordFile(items, mode, promo);
    const filename =
      mode === "price_change" ? "Bang_gia_block_7.7x4cm_Khuyen_mai.docx" : "Bang_gia_block_7.7x4cm_Update.docx";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ...(skippedNames.length > 0 ? { "X-Skipped-Products": encodeURIComponent(JSON.stringify(skippedNames)) } : {}),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
