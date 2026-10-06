"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string; latitude: number; longitude: number; radius_m: number; office_ips: string[] };

type Employee = { id: string; display_name: string | null; username: string | null; chuc_danh: string | null; role: string | null };

type Assignment = {
  id: string;
  tu_ngay: string;
  den_ngay: string | null;
  thu_ap_dung: number[];
  employee: { id: string; display_name: string | null; username: string | null; chuc_danh: string | null } | null;
};

type ShiftRow = {
  id: string;
  name: string;
  loai_ca: "gio" | "ngay";
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  grace_minutes: number;
  half_day_after_minutes: number;
  absent_after_minutes: number;
  active: boolean;
  store: { id: string; name: string } | null;
  assignments: Assignment[];
};

const WEEKDAYS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 7, label: "CN" },
];

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function personName(p: { display_name: string | null; username: string | null } | null): string {
  return p?.display_name || p?.username || "—";
}

// Đọc JSON an toàn: lỗi từ API luôn có trường "error" để hiển thị cho người dùng.
async function requestJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Thao tác thất bại");
  return json;
}

// Tách "vĩ độ, kinh độ" từ chuỗi copy của Google Maps. Trả về null nếu không đúng dạng hoặc ngoài khoảng cho phép.
function parseCoords(input: string): { latitude: number; longitude: number } | null {
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function StoresView() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [coords, setCoords] = useState("");
  const [radius, setRadius] = useState("200");
  const [officeIps, setOfficeIps] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const json = await requestJson("/api/stores");
      setStores(json.stores ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseCoords(coords);
    if (!parsed) {
      setError("Tọa độ không hợp lệ. Dán nguyên dòng copy từ Google Maps, dạng \"10.776900, 106.700900\".");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await requestJson("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          radius_m: Number(radius),
          office_ips: officeIps.split(/[,\s]+/).filter(Boolean),
        }),
      });
      setName("");
      setCoords("");
      setRadius("200");
      setOfficeIps("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app app-full table-page">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Cửa hàng</h1>
          <p className="app-header-meta">{stores.length} cửa hàng · dùng để giới hạn vị trí điểm danh</p>
        </div>
      </header>

      {error && <div role="alert" className="panel" style={{ color: "var(--danger-ink)", background: "var(--danger-wash)" }}>{error}</div>}

      <section className="panel">
        <h3>Thêm cửa hàng</h3>
        <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
          <div className="field-grid">
            <label className="field">
              Tên cửa hàng
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              Bán kính (mét)
              <input type="number" min={20} max={1000} value={radius} onChange={(e) => setRadius(e.target.value)} required />
            </label>
          </div>
          <label className="field">
            Tọa độ (dán từ Google Maps)
            <input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="10.776900, 106.700900" required />
          </label>
          <label className="field">
            IP Wi-Fi công ty (không bắt buộc, cách nhau bằng dấu phẩy)
            <input value={officeIps} onChange={(e) => setOfficeIps(e.target.value)} placeholder="Để trống nếu không kiểm tra IP" />
          </label>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-micro)" }}>
            Mở Google Maps, nhấn chuột phải vào vị trí cửa hàng, bấm vào dòng tọa độ để copy rồi dán vào ô trên.
          </p>
          <div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Đang lưu…" : "Thêm cửa hàng"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Danh sách cửa hàng</h3>
        {loading && <p style={{ color: "var(--muted)" }}>Đang tải…</p>}
        {!loading && stores.length === 0 && <p style={{ color: "var(--muted)" }}>Chưa có cửa hàng nào.</p>}
        <div style={{ display: "grid", gap: 8 }}>
          {stores.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div>
                <div style={{ fontWeight: 650 }}>{s.name}</div>
                <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>
                  {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)} · bán kính {s.radius_m}m
                </div>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>
                {s.office_ips.length > 0 ? `IP công ty: ${s.office_ips.join(", ")}` : "Không kiểm tra IP"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ShiftsView() {
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [loaiCa, setLoaiCa] = useState<"gio" | "ngay">("gio");
  const [storeId, setStoreId] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [shiftJson, storeJson, profileRes] = await Promise.all([
        requestJson("/api/shifts"),
        requestJson("/api/stores"),
        supabase.from("profiles").select("id, display_name, username, chuc_danh, role").not("role", "is", null).order("display_name"),
      ]);
      setShifts(shiftJson.shifts ?? []);
      setStores(storeJson.stores ?? []);
      setEmployees((profileRes.data as Employee[]) ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createShift(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await requestJson("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          loai_ca: loaiCa,
          store_id: storeId,
          start_time: startTime,
          end_time: endTime,
          break_start: breakStart || null,
          break_end: breakEnd || null,
        }),
      });
      setName("");
      setBreakStart("");
      setBreakEnd("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app app-full table-page">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Ca làm việc</h1>
          <p className="app-header-meta">{shifts.length} ca · phân ca cho nhân viên bên dưới từng ca</p>
        </div>
      </header>

      {error && <div role="alert" className="panel" style={{ color: "var(--danger-ink)", background: "var(--danger-wash)" }}>{error}</div>}

      <section className="panel">
        <h3>Tạo ca làm việc</h3>
        {stores.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>Cần tạo cửa hàng trước ở mục Cửa hàng.</p>
        ) : (
          <form onSubmit={createShift} style={{ display: "grid", gap: 10 }}>
            <div className="field-grid">
              <label className="field">
                Tên ca
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Ca sáng bán hàng" required />
              </label>
              <label className="field">
                Cách tính công
                <select value={loaiCa} onChange={(e) => setLoaiCa(e.target.value as "gio" | "ngay")}>
                  <option value="gio">Theo giờ (tính số giờ thực làm)</option>
                  <option value="ngay">Theo ngày (1 công / nửa công)</option>
                </select>
              </label>
              <label className="field">
                Cửa hàng
                <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
                  <option value="">Chọn cửa hàng</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Giờ vào
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </label>
              <label className="field">
                Giờ ra
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </label>
              <label className="field">
                Nghỉ từ (không bắt buộc)
                <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} />
              </label>
              <label className="field">
                Nghỉ đến (không bắt buộc)
                <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} />
              </label>
            </div>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-micro)" }}>
              Ngưỡng mặc định: ân hạn 5 phút, trễ trên 30 phút là nửa ca, trên 120 phút là vắng cả ca.
            </p>
            <div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Đang lưu…" : "Tạo ca"}
              </button>
            </div>
          </form>
        )}
      </section>

      {loading && <p style={{ color: "var(--muted)" }}>Đang tải…</p>}

      {shifts.map((s) => (
        <section key={s.id} className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 650 }}>
                {s.name} <span className="pill">{s.loai_ca === "gio" ? "Theo giờ" : "Theo ngày"}</span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>
                {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                {s.break_start && s.break_end ? ` · nghỉ ${s.break_start.slice(0, 5)}–${s.break_end.slice(0, 5)}` : ""}
                {` · ${s.store?.name ?? "—"} · ${s.assignments.length} nhân viên`}
              </div>
            </div>
            <button className="btn" onClick={() => setOpenShiftId(openShiftId === s.id ? null : s.id)}>
              {openShiftId === s.id ? "Đóng" : "Phân ca"}
            </button>
          </div>

          {openShiftId === s.id && (
            <AssignPanel shift={s} employees={employees} onChanged={load} />
          )}
        </section>
      ))}
    </div>
  );
}

function AssignPanel({ shift, employees, onChanged }: { shift: ShiftRow; employees: Employee[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [tuNgay, setTuNgay] = useState(todayIso());
  const [denNgay, setDenNgay] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function assign() {
    setSaving(true);
    setError(null);
    try {
      await requestJson(`/api/shifts/${shift.id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_ids: selected, tu_ngay: tuNgay, den_ngay: denNgay || null, thu_ap_dung: days }),
      });
      setSelected([]);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function unassign(assignmentId: string) {
    setError(null);
    try {
      await requestJson(`/api/shifts/${shift.id}/assignments?assignment_id=${assignmentId}`, { method: "DELETE" });
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Nhân viên đang được phân ca</div>
        {shift.assignments.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>Chưa có nhân viên nào.</p>}
        {shift.assignments.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "4px 0" }}>
            <span>
              {personName(a.employee)}
              {a.employee?.chuc_danh ? ` · ${a.employee.chuc_danh}` : ""}
              <span style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>
                {" "}· {a.tu_ngay}
                {a.den_ngay ? ` → ${a.den_ngay}` : " → lâu dài"} · {a.thu_ap_dung.map((d) => WEEKDAYS.find((w) => w.value === d)?.label).join(", ")}
              </span>
            </span>
            <button className="btn btn-quiet" onClick={() => unassign(a.id)}>
              Bỏ
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 650 }}>Thêm nhân viên vào ca</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {employees.map((e) => (
            <label key={e.id} className="pill" style={{ cursor: "pointer", gap: 6 }}>
              <input
                type="checkbox"
                checked={selected.includes(e.id)}
                onChange={() => setSelected(toggle(selected, e.id))}
              />
              {personName(e)}
              {e.chuc_danh ? ` (${e.chuc_danh})` : ""}
            </label>
          ))}
        </div>
        <div className="field-grid">
          <label className="field">
            Từ ngày
            <input type="date" value={tuNgay} onChange={(e) => setTuNgay(e.target.value)} />
          </label>
          <label className="field">
            Đến ngày (để trống = lâu dài)
            <input type="date" value={denNgay} min={tuNgay} onChange={(e) => setDenNgay(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {WEEKDAYS.map((w) => (
            <label key={w.value} className="pill" style={{ cursor: "pointer", gap: 6 }}>
              <input type="checkbox" checked={days.includes(w.value)} onChange={() => setDays(toggle(days, w.value))} />
              {w.label}
            </label>
          ))}
        </div>
        {error && <div role="alert" style={{ color: "var(--danger-ink)" }}>{error}</div>}
        <div>
          <button
            className="btn btn-primary"
            disabled={saving || selected.length === 0 || days.length === 0}
            onClick={assign}
          >
            {saving ? "Đang gán…" : `Gán ${selected.length || ""} nhân viên`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
