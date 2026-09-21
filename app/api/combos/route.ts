import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireRole, getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

const ALL_ROLES = ["sales", "accountant", "admin"] as const;

export async function GET() {
  const denied = await requireRole([...ALL_ROLES]);
  if (denied) return denied;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("combos")
    .select("*, items:combo_items(*, product:products(ten_hang_hoa, ma_noi_bo, gia_ban))")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const denied = await requireRole([...ALL_ROLES]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  try {
    const { ten_combo, gia_ban, ma_vach, items } = (await req.json()) as {
      ten_combo: string;
      gia_ban: number | null;
      ma_vach: string | null;
      items: { product_id: string; quantity: number }[];
    };
    if (!ten_combo?.trim()) return NextResponse.json({ error: "Cần nhập tên combo" }, { status: 400 });
    if (!items || items.length === 0) return NextResponse.json({ error: "Combo cần ít nhất 1 sản phẩm" }, { status: 400 });

    const supabase = supabaseAdmin();
    const { data: combo, error } = await supabase
      .from("combos")
      .insert({ ten_combo: ten_combo.trim(), gia_ban, ma_vach: ma_vach || null })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await supabase
      .from("combo_items")
      .insert(items.map((it) => ({ combo_id: combo.id, product_id: it.product_id, quantity: it.quantity })));
    if (itemsError) throw itemsError;

    await logActivity({
      actorId: current!.userId,
      actorName: current!.displayName,
      action: "combo.create",
      targetType: "combo",
      targetId: combo.id,
      targetLabel: combo.ten_combo,
    });

    return NextResponse.json(combo);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
