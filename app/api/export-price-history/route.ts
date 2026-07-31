import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { buildPriceHistoryExcel, PriceHistoryExportRow } from "@/lib/priceHistoryExportBuilder";

export const runtime = "nodejs";

// Dùng chung cho cả nút "Xuất Excel" thường (from/to tùy chọn, thường bỏ
// trống = toàn bộ) và bước 1 của "Xuất & dọn dữ liệu cũ hơn 1 năm" (gọi với
// to = 1 năm trước) — tránh viết 2 lần logic build file giống hệt nhau.
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  try {
    const { from, to } = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    const supabase = supabaseAdmin();
    let query = supabase
      .from("price_history")
      .select("changed_at, gia_ban_old, gia_ban_new, gia_thung_old, gia_thung_new, product:products(ma_noi_bo, ten_hang_hoa, category_sheet)")
      .order("changed_at", { ascending: true });
    if (from) query = query.gte("changed_at", from);
    if (to) query = query.lt("changed_at", to);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as PriceHistoryExportRow[];
    const buf = await buildPriceHistoryExcel(rows);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Row-Count": String(rows.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
