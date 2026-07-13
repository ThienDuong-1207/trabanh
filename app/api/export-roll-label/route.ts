import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildRollLabelFile } from "@/lib/rollLabelBuilder";
import { generateInternalEan13, isValidEan13 } from "@/lib/ean13";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

const INTERNAL_PREFIX = "200";

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids: string[] };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*").in("id", ids);
    if (error) throw error;

    // Only products with a giá bán lẻ actually get printed (the tag shows
    // the price) — skip the rest before minting any mã vạch, so a product
    // that never makes it onto a label doesn't burn a barcode for nothing.
    const products = (data as Product[]).filter((p) => p.gia_ban);
    if (products.length === 0) {
      return NextResponse.json(
        { error: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." },
        { status: 400 }
      );
    }

    // Products missing a mã vạch get a freshly-minted, permanent EAN-13
    // ("200" GS1 internal-use prefix) instead of a one-off value that would
    // differ every time this export runs — the code printed today has to
    // still match the product tomorrow.
    const { data: existing, error: existingError } = await supabase
      .from("products")
      .select("ma_vach")
      .like("ma_vach", `${INTERNAL_PREFIX}%`);
    if (existingError) throw existingError;

    let nextSeq = 1;
    for (const row of existing ?? []) {
      const code = row.ma_vach as string;
      if (isValidEan13(code)) {
        const seq = Number(code.slice(INTERNAL_PREFIX.length, 12));
        if (seq >= nextSeq) nextSeq = seq + 1;
      }
    }

    const items: { product: Product; barcode: string }[] = [];
    const toPersist: { id: string; ma_vach: string }[] = [];
    for (const p of products) {
      if (p.ma_vach) {
        items.push({ product: p, barcode: p.ma_vach });
        continue;
      }
      const code = generateInternalEan13(nextSeq);
      nextSeq += 1;
      items.push({ product: { ...p, ma_vach: code }, barcode: code });
      toPersist.push({ id: p.id, ma_vach: code });
    }

    for (const row of toPersist) {
      const { error: updateError } = await supabase.from("products").update({ ma_vach: row.ma_vach }).eq("id", row.id);
      if (updateError) throw updateError;
    }

    const buf = await buildRollLabelFile(items);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="Tem_cuon_5x3cm.docx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
