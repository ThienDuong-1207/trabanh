import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildWordFile, WordLabelItem, WordLabelMode } from "@/lib/wordBuilder";
import { Product } from "@/lib/types";

export const runtime = "nodejs";

type PromoItemInput = { id: string; giaGoc: number | null; giaKm: number | null };

export async function POST(req: NextRequest) {
  try {
    const {
      ids,
      mode: rawMode,
      promoFrom,
      promoTo,
      promoItems,
    } = (await req.json()) as {
      ids: string[];
      mode?: string;
      promoFrom?: string;
      promoTo?: string;
      promoItems?: PromoItemInput[];
    };
    if (!ids || ids.length === 0) {
      return NextResponse.json({ error: "Chưa chọn sản phẩm nào" }, { status: 400 });
    }
    const mode: WordLabelMode = rawMode === "price_change" ? "price_change" : "normal";
    const promo = mode === "price_change" && promoFrom && promoTo ? { from: promoFrom, to: promoTo } : undefined;

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("products").select("*").in("id", ids);
    if (error) throw error;

    let items: WordLabelItem[];
    let skippedNames: string[] = [];

    if (mode === "price_change") {
      // Giá gốc/giá khuyến mãi nhập tay trực tiếp trên form lúc xuất (không
      // ghi ngược lại products) — không còn tự tra price_history nữa: sản
      // phẩm/combo nào không có giá khuyến mãi được nhập thì bỏ qua, thay vì
      // tự suy ra "giá cũ" từ lịch sử đổi giá thật.
      const overrideById = new Map((promoItems ?? []).map((it) => [it.id, it]));
      const eligible: WordLabelItem[] = [];
      for (const p of data as Product[]) {
        const override = overrideById.get(p.id);
        if (!override || override.giaKm == null) {
          skippedNames.push(p.ten_hang_hoa);
          continue;
        }
        eligible.push({ ...p, gia_ban: override.giaKm, gia_ban_old: override.giaGoc });
      }
      items = eligible;
    } else {
      // Mode thường: combo dùng gia_goc của chính nó làm "giá cũ" gạch ngang
      // tự động, không cần nhập tay — sản phẩm thật không đổi hành vi.
      items = (data as Product[]).map((p) => (p.is_combo && p.gia_goc != null ? { ...p, gia_ban_old: p.gia_goc } : p));
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
