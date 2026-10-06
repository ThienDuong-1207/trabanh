import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, requireRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";
import { displayNameOf } from "@/lib/attendanceServer";

export const runtime = "nodejs";

type Range = { tu_ngay: string; den_ngay: string | null; thu_ap_dung: number[] };

// Hai khoảng phân ca trùng nhau khi: ngày áp dụng giao nhau VÀ có chung ít
// nhất một thứ. Một nhân viên chỉ được một ca trong một ngày.
function overlaps(a: Range, b: Range): boolean {
  const aEnd = a.den_ngay ?? "9999-12-31";
  const bEnd = b.den_ngay ?? "9999-12-31";
  const dateOverlap = a.tu_ngay <= bEnd && b.tu_ngay <= aEnd;
  const dayOverlap = a.thu_ap_dung.some((d) => b.thu_ap_dung.includes(d));
  return dateOverlap && dayOverlap;
}

// Gán nhiều nhân viên vào ca. Kiểm tra trùng với mọi phân ca hiện có của từng
// nhân viên trước khi ghi; nếu có ai trùng thì không ghi gì cả.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole([]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  const body = (await req.json()) as {
    employee_ids: string[];
    tu_ngay: string;
    den_ngay?: string | null;
    thu_ap_dung: number[];
  };
  if (!Array.isArray(body.employee_ids) || body.employee_ids.length === 0) {
    return NextResponse.json({ error: "Chọn ít nhất một nhân viên" }, { status: 400 });
  }
  if (!body.tu_ngay) return NextResponse.json({ error: "Thiếu ngày bắt đầu" }, { status: 400 });
  const denEnd = body.den_ngay || null;
  if (denEnd && denEnd < body.tu_ngay) {
    return NextResponse.json({ error: "Ngày kết thúc phải sau ngày bắt đầu" }, { status: 400 });
  }
  const days = Array.from(new Set(body.thu_ap_dung ?? [])).filter((d) => d >= 1 && d <= 7);
  if (days.length === 0) return NextResponse.json({ error: "Chọn ít nhất một thứ áp dụng" }, { status: 400 });

  const supabase = supabaseAdmin();
  const newRange: Range = { tu_ngay: body.tu_ngay, den_ngay: denEnd, thu_ap_dung: days };

  const { data: existing, error: existingError } = await supabase
    .from("shift_assignments")
    .select("nhan_vien_id, tu_ngay, den_ngay, thu_ap_dung, shift:shifts(name), employee:profiles!nhan_vien_id(display_name, username)")
    .in("nhan_vien_id", body.employee_ids);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const conflicts: string[] = [];
  for (const empId of body.employee_ids) {
    const rows = (existing ?? []).filter((r: any) => r.nhan_vien_id === empId);
    const clash = rows.find((r: any) => overlaps(newRange, r as Range));
    if (clash) {
      const who = displayNameOf((clash as any).employee);
      conflicts.push(`${who} đã có ca "${(clash as any).shift?.name ?? ""}" trùng ngày/thứ`);
    }
  }
  if (conflicts.length > 0) {
    return NextResponse.json({ error: `Không gán được: ${conflicts.join("; ")}` }, { status: 409 });
  }

  const rows = body.employee_ids.map((id) => ({
    nhan_vien_id: id,
    shift_id: params.id,
    tu_ngay: body.tu_ngay,
    den_ngay: denEnd,
    thu_ap_dung: days,
  }));
  const { data, error } = await supabase.from("shift_assignments").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    actorId: current!.userId,
    actorName: current!.displayName,
    action: "shift.assign",
    targetType: "shift",
    targetId: params.id,
    detail: { employees: body.employee_ids.length, tu_ngay: body.tu_ngay, den_ngay: denEnd, thu_ap_dung: days },
  });
  return NextResponse.json({ created: data?.length ?? 0 });
}

// Bỏ phân ca một nhân viên khỏi ca: DELETE /api/shifts/{id}/assignments?assignment_id=...
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole([]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  const assignmentId = req.nextUrl.searchParams.get("assignment_id");
  if (!assignmentId) return NextResponse.json({ error: "Thiếu assignment_id" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("shift_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("shift_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    actorId: current!.userId,
    actorName: current!.displayName,
    action: "shift.unassign",
    targetType: "shift",
    targetId: params.id,
    detail: { assignment_id: assignmentId },
  });
  return NextResponse.json({ ok: true });
}
