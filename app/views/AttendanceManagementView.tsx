"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  id: string;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string | null;
  late_minutes: number | null;
  early_minutes: number | null;
  work_minutes: number | null;
  work_units: number | null;
  ot_minutes: number | null;
  ot_status: string | null;
  flags: string[] | null;
  employee: { id: string; display_name: string | null; username: string | null; chuc_danh: string | null } | null;
  shift: { name: string | null } | null;
};

type Employee = { id: string; display_name: string | null; username: string | null };

const STATUS_LABEL: Record<string, string> = { on_time: "Đúng giờ", late: "Đi trễ", half_day: "Nửa ca", absent: "Vắng" };
const STATUS_PILL: Record<string, string> = { on_time: "pill-success", late: "pill-warm", half_day: "pill-warm", absent: "pill-danger" };

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

// Đầu/cuối tháng hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD — mặc định lọc
// sẵn tháng này vì chấm công dùng để tính lương theo tháng.
function monthRangeVn(): { from: string; to: string } {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AttendanceManagementView() {
  const defaultRange = monthRangeVn();
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("role", ["sales", "staff"])
      .order("display_name")
      .then(({ data }) => setEmployees(data ?? []));
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("attendance")
        .select(
          "id, work_date, check_in_at, check_out_at, status, late_minutes, early_minutes, work_minutes, work_units, ot_minutes, ot_status, flags, employee:profiles(id, display_name, username, chuc_danh), shift:shifts(name)",
        )
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: false });
      if (employeeId) query = query.eq("user_id", employeeId);
      const { data, error: err } = await query;
      if (err) throw err;
      setRows((data as unknown as Row[]) ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, from, to]);

  const totals = useMemo(() => {
    let workMinutes = 0;
    let otMinutes = 0;
    let lateCount = 0;
    let absentCount = 0;
    for (const r of rows) {
      workMinutes += r.work_minutes ?? 0;
      otMinutes += r.ot_minutes ?? 0;
      if (r.status === "late" || r.status === "half_day") lateCount++;
      if (r.status === "absent") absentCount++;
    }
    return { workHours: workMinutes / 60, otHours: otMinutes / 60, lateCount, absentCount };
  }, [rows]);

  async function exportExcel() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId || undefined, from, to }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Xuất file thất bại");
      }
      const blob = await res.blob();
      const who = employeeId ? employees.find((e) => e.id === employeeId)?.display_name ?? "nhan_vien" : "tat_ca";
      downloadBlob(blob, `Cham_cong_${who.replace(/\s+/g, "_")}_${from}_${to}.xlsx`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app app-full table-page">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Quản lý điểm danh</h1>
          <p className="app-header-meta">
            {rows.length} bản ghi · {totals.workHours.toFixed(1)}h công · {totals.otHours.toFixed(1)}h tăng ca · {totals.lateCount} lần trễ/nửa ca · {totals.absentCount} vắng
          </p>
        </div>
      </header>

      <div className="toolbar">
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Tất cả nhân viên</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.display_name || e.username}
            </option>
          ))}
        </select>
        <label className="field">
          Từ ngày
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Đến ngày
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn btn-primary" style={{ marginLeft: "auto" }} disabled={exporting} onClick={exportExcel}>
          {exporting ? "Đang xuất…" : "Xuất Excel"}
        </button>
      </div>

      {error && (
        <div role="alert" className="panel" style={{ color: "var(--danger-ink)", background: "var(--danger-wash)" }}>
          {error}
        </div>
      )}

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Chức danh</th>
                <th>Ca</th>
                <th>Ngày</th>
                <th>Vào</th>
                <th>Ra</th>
                <th>Trạng thái</th>
                <th className="num">Phút trễ</th>
                <th className="num">Phút công</th>
                <th className="num">Tăng ca</th>
                <th>Cờ</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Không có bản ghi nào trong khoảng ngày này.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee?.display_name || r.employee?.username || "—"}</td>
                  <td>{r.employee?.chuc_danh ?? "—"}</td>
                  <td>{r.shift?.name ?? "—"}</td>
                  <td>{r.work_date}</td>
                  <td>{timeOf(r.check_in_at)}</td>
                  <td>{timeOf(r.check_out_at)}</td>
                  <td>
                    {r.status && (
                      <span className={`pill ${STATUS_PILL[r.status] ?? "pill-primary"}`}>
                        <span className="dot" />
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    )}
                  </td>
                  <td className="num">{r.late_minutes ?? "—"}</td>
                  <td className="num">{r.work_minutes ?? "—"}</td>
                  <td className="num">
                    {r.ot_minutes ? `${r.ot_minutes}${r.ot_status === "pending" ? " (chờ duyệt)" : ""}` : "—"}
                  </td>
                  <td style={{ color: "var(--danger-ink)", fontSize: "var(--text-micro)" }}>{(r.flags ?? []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
