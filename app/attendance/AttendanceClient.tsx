"use client";

import { useCallback, useEffect, useState } from "react";

type TodayResponse = {
  today: string;
  serverNow: string;
  shift: {
    id: string;
    name: string;
    loai_ca: "gio" | "ngay";
    start_time: string;
    end_time: string;
    store_name: string;
    radius_m: number;
  } | null;
  attendance: {
    check_in_at: string | null;
    check_out_at: string | null;
    status: string | null;
    late_minutes: number | null;
    early_minutes: number | null;
    work_minutes: number | null;
    ot_minutes: number | null;
    flags: string[];
  } | null;
};

const TZ = "Asia/Ho_Chi_Minh";

function bannerStyle(ok: boolean): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: "var(--radius-md)",
    background: ok ? "var(--success-wash)" : "var(--danger-wash)",
    color: ok ? "var(--success-ink)" : "var(--danger-ink)",
    fontWeight: 500,
  };
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

// Lấy vị trí độ chính xác cao. Lỗi được đổi sang tiếng Việt dễ hiểu cho
// nhân viên, vì họ thường không biết cách bật định vị.
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Trình duyệt không hỗ trợ định vị"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        reject(new Error("Bạn chưa cho phép truy cập vị trí. Mở cài đặt trình duyệt, bật quyền vị trí cho trang này rồi thử lại."));
      } else if (err.code === err.TIMEOUT) {
        reject(new Error("Không lấy được vị trí kịp thời. Thử lại ở nơi thoáng hơn."));
      } else {
        reject(new Error("Không lấy được vị trí. Kiểm tra GPS/định vị của điện thoại rồi thử lại."));
      }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

export default function AttendanceClient({
  displayName,
  chucDanh,
  role,
}: {
  displayName: string;
  chucDanh: string | null;
  role: string;
}) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/today", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Không tải được thông tin ca");
      setData(json);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(action: "check_in" | "check_out") {
    setBusy(true);
    setMessage(null);
    try {
      const pos = await getPosition();
      const res = await fetch("/api/attendance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Thao tác thất bại");
      setMessage({ type: "ok", text: `${json.message} lúc ${formatTime(json.attendance.check_in_at ?? json.attendance.check_out_at)}` });
      await load();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const shift = data?.shift;
  const att = data?.attendance;
  const checkedIn = !!att?.check_in_at;
  const checkedOut = !!att?.check_out_at;

  return (
    <main style={{ minHeight: "100vh", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 480, margin: "0 auto" }}>
      {/* Nhân viên (staff) không có menu, nên chỉ các vai trò khác mới cần nút quay lại. */}
      {role !== "staff" && (
        <a className="btn btn-quiet" href="/" style={{ alignSelf: "flex-start" }}>
          ← Quay lại
        </a>
      )}

      <header>
        <h1 style={{ fontSize: 19, margin: 0 }}>Điểm danh</h1>
        <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>
          {displayName}
          {chucDanh ? ` · ${chucDanh}` : ""}
        </p>
      </header>

      {loadError && <div role="alert" style={bannerStyle(false)}>{loadError}</div>}

      {data && !shift && (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 16 }}>
          <p style={{ margin: 0 }}>Hôm nay bạn không có ca làm việc.</p>
        </section>
      )}

      {shift && (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 16, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{shift.name}</div>
          <div style={{ color: "var(--muted)" }}>
            {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} · {shift.store_name}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Giờ vào</div>
              <div style={{ fontSize: 17 }}>{formatTime(att?.check_in_at ?? null)}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Giờ ra</div>
              <div style={{ fontSize: 17 }}>{formatTime(att?.check_out_at ?? null)}</div>
            </div>
          </div>

          <button
            type="button"
            className={checkedIn ? "btn btn-danger" : "btn btn-success"}
            style={{ minHeight: 48, marginTop: 8, fontSize: 16 }}
            disabled={busy || checkedOut}
            onClick={() => submit(checkedIn ? "check_out" : "check_in")}
          >
            {busy ? "Đang lấy vị trí…" : checkedOut ? "Đã hoàn thành ca hôm nay" : checkedIn ? "Ra ca" : "Vào ca"}
          </button>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
            Chỉ điểm danh được khi đang ở trong phạm vi {shift.radius_m}m quanh cửa hàng.
          </p>
        </section>
      )}

      {message && (
        <div role="status" style={bannerStyle(message.type === "ok")}>
          {message.text}
        </div>
      )}
    </main>
  );
}
