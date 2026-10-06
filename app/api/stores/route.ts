import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, requireRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Danh sách cửa hàng (để chọn khi tạo ca). Chỉ Kế toán/Admin xem đầy đủ.
export async function GET() {
  const denied = await requireRole(["accountant"]);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin().from("stores").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stores: data ?? [] });
}

// Tạo cửa hàng: tên, tọa độ, bán kính (mặc định 200m), IP Wi-Fi công ty (không bắt buộc).
export async function POST(req: NextRequest) {
  const denied = await requireRole([]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  const body = (await req.json()) as {
    name: string;
    latitude: number;
    longitude: number;
    radius_m?: number;
    office_ips?: string[];
  };
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên cửa hàng" }, { status: 400 });
  if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
    return NextResponse.json({ error: "Tọa độ cửa hàng không hợp lệ" }, { status: 400 });
  }
  const radius = body.radius_m ?? 200;
  if (!Number.isInteger(radius) || radius < 20 || radius > 1000) {
    return NextResponse.json({ error: "Bán kính phải từ 20 đến 1000 mét" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("stores")
    .insert({
      name,
      latitude: body.latitude,
      longitude: body.longitude,
      radius_m: radius,
      office_ips: (body.office_ips ?? []).map((ip) => ip.trim()).filter(Boolean),
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    actorId: current!.userId,
    actorName: current!.displayName,
    action: "store.create",
    targetType: "store",
    targetId: data.id,
    targetLabel: name,
  });
  return NextResponse.json({ store: data });
}
