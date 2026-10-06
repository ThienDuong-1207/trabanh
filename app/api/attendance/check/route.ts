import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { computeAttendance, GPS_MAX_ACCURACY_M, haversineMeters, vnDateString } from "@/lib/attendance";
import { findShiftForDate, getClientIp, rulesSnapshot, toColumns } from "@/lib/attendanceServer";

export const runtime = "nodejs";

// Vào/ra ca. Thời điểm lấy từ đồng hồ server, không tin giờ máy khách. Vị trí
// được kiểm tra lại ở server: khoảng cách do server tính từ tọa độ cửa hàng,
// không dùng khoảng cách do trình duyệt gửi lên.
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  try {
    const body = (await req.json()) as {
      action: "check_in" | "check_out";
      latitude: number;
      longitude: number;
      accuracy: number;
    };
    const { action, latitude, longitude, accuracy } = body;
    if (action !== "check_in" && action !== "check_out") {
      return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
    }
    if (![latitude, longitude, accuracy].every((n) => typeof n === "number" && Number.isFinite(n))) {
      return NextResponse.json({ error: "Thiếu vị trí. Hãy cho phép truy cập vị trí và thử lại." }, { status: 400 });
    }
    if (accuracy > GPS_MAX_ACCURACY_M) {
      return NextResponse.json(
        { error: `Tín hiệu GPS chưa đủ chính xác (±${Math.round(accuracy)}m). Thử ra chỗ thoáng hơn rồi bấm lại.` },
        { status: 422 },
      );
    }

    const now = new Date();
    const today = vnDateString(now);
    const found = await findShiftForDate(current.userId, today);
    if (!found) {
      return NextResponse.json({ error: "Hôm nay bạn không có ca làm việc" }, { status: 403 });
    }
    const { shift } = found;
    if (!shift.active) {
      return NextResponse.json({ error: "Ca làm việc này đã bị tắt" }, { status: 403 });
    }

    const store = shift.store;
    const distance = haversineMeters(latitude, longitude, store.latitude, store.longitude);
    if (distance > store.radius_m) {
      return NextResponse.json(
        {
          error: `Bạn đang cách ${store.name} khoảng ${Math.round(distance)}m, phải trong phạm vi ${store.radius_m}m mới ${action === "check_in" ? "vào ca" : "ra ca"} được.`,
        },
        { status: 403 },
      );
    }

    // IP chỉ là bằng chứng bổ sung (4G/IP động sẽ không khớp), nên không chặn —
    // chỉ đánh dấu để admin/kế toán xem lại.
    const ip = getClientIp(req);
    const ipMismatch = store.office_ips.length > 0 && !(ip && store.office_ips.includes(ip));

    const supabase = supabaseAdmin();
    const { data: existing, error: existingError } = await supabase
      .from("attendance")
      .select("*")
      .eq("user_id", current.userId)
      .eq("work_date", today)
      .maybeSingle();
    if (existingError) throw existingError;

    const location = {
      latitude,
      longitude,
      accuracy_m: accuracy,
      distance_m: Math.round(distance * 10) / 10,
      ip,
    };

    if (action === "check_in") {
      if (existing) {
        return NextResponse.json({ error: "Hôm nay bạn đã vào ca rồi" }, { status: 409 });
      }
      const computed = computeAttendance(shift, today, now, null);
      const flags = ipMismatch ? ["ip_mismatch"] : [];
      const { data: row, error } = await supabase
        .from("attendance")
        .insert({
          user_id: current.userId,
          shift_id: shift.id,
          store_id: store.id,
          work_date: today,
          check_in_at: now.toISOString(),
          check_in_latitude: location.latitude,
          check_in_longitude: location.longitude,
          check_in_accuracy_m: location.accuracy_m,
          check_in_distance_m: location.distance_m,
          check_in_ip: location.ip,
          ...toColumns(computed),
          flags,
          shift_snapshot: rulesSnapshot(shift),
        })
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ attendance: row, message: "Đã vào ca" });
    }

    // check_out
    if (!existing || !existing.check_in_at) {
      return NextResponse.json({ error: "Bạn chưa vào ca hôm nay" }, { status: 409 });
    }
    if (existing.check_out_at) {
      return NextResponse.json({ error: "Bạn đã ra ca hôm nay rồi" }, { status: 409 });
    }
    const computed = computeAttendance(shift, today, new Date(existing.check_in_at), now);
    // Giữ cờ cũ (vd ip_mismatch từ lúc vào ca), thêm cờ mới nếu ra ca lệch IP.
    const flags = Array.from(new Set([...(existing.flags ?? []), ...(ipMismatch ? ["ip_mismatch"] : [])]));
    const { data: row, error } = await supabase
      .from("attendance")
      .update({
        check_out_at: now.toISOString(),
        check_out_latitude: location.latitude,
        check_out_longitude: location.longitude,
        check_out_accuracy_m: location.accuracy_m,
        check_out_distance_m: location.distance_m,
        check_out_ip: location.ip,
        ...toColumns(computed),
        flags,
        updated_at: now.toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ attendance: row, message: "Đã ra ca" });
  } catch (e: any) {
    console.error("attendance check failed:", e);
    return NextResponse.json({ error: e.message ?? "Lỗi không xác định" }, { status: 500 });
  }
}
