"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Order, OrderItem, OrderStatus, PaymentMethod } from "@/lib/types";

// Đơn hàng từ website bán hàng (tra-banh-shop) — đọc/sửa thẳng bảng
// orders/order_items/order_status_history trong CÙNG project Supabase, qua
// client phía trình duyệt (tôn trọng RLS: role sales/accountant/admin/staff
// được xem và sửa, xem tra-banh-shop/supabase/migrations/001, 007b). Không
// có API route riêng ở trabanh cho việc này, vì RLS đã kiểm soát đủ — giống
// cách tra-banh-shop/components/admin/OrdersView.tsx tự làm, không viết lại
// bằng cách khác cho "nhất quán" giả tạo.

function formatVnd(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("vi-VN");
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Giống Segmented trong HomeClient.tsx (không export dùng chung được vì
// định nghĩa cục bộ trong file đó) — khối "thumb" trượt BẮT BUỘC phải có,
// vì .segmented button.active chỉ đổi màu chữ sang trắng, không tự có nền.
type SegmentedItem = { key: string; label: React.ReactNode; active: boolean; onClick: () => void };
function Segmented({ items }: { items: SegmentedItem[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbStyle, setThumbStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const activeKey = items.find((it) => it.active)?.key;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const activeIndex = items.findIndex((it) => it.active);
    if (!container || activeIndex === -1) return;
    const btn = container.querySelectorAll("button")[activeIndex] as HTMLButtonElement | undefined;
    if (!btn) return;
    setThumbStyle({ opacity: 1, width: btn.offsetWidth, transform: `translateX(${btn.offsetLeft}px)` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, items.length, items.map((it) => String(it.label)).join("|")]);

  return (
    <div className="segmented" style={{ marginBottom: 14, overflowX: "auto" }} ref={containerRef}>
      <div className="segmented-thumb" style={thumbStyle} />
      {items.map((it) => (
        <button key={it.key} type="button" className={it.active ? "active" : ""} onClick={it.onClick}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_ORDER: OrderStatus[] = ["cho_thanh_toan", "da_thanh_toan", "dang_xu_ly", "dang_giao", "hoan_thanh", "huy"];
const STATUS_LABEL: Record<OrderStatus, string> = {
  cho_thanh_toan: "Chờ thanh toán",
  da_thanh_toan: "Đã thanh toán",
  dang_xu_ly: "Đang xử lý",
  dang_giao: "Đang giao",
  hoan_thanh: "Hoàn thành",
  huy: "Đã huỷ",
};
const STATUS_PILL_CLASS: Record<OrderStatus, string> = {
  cho_thanh_toan: "pill-warm",
  da_thanh_toan: "pill-primary",
  dang_xu_ly: "pill-primary",
  dang_giao: "pill-primary",
  hoan_thanh: "pill-success",
  huy: "pill-danger",
};
const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  chuyen_khoan: "Chuyển khoản (VietQR)",
  cod: "Tiền mặt khi nhận hàng (COD)",
};
const ACTIVE_FLOW: OrderStatus[] = ["cho_thanh_toan", "da_thanh_toan", "dang_xu_ly", "dang_giao", "hoan_thanh"];

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`pill ${STATUS_PILL_CLASS[status]}`}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function StatusStepper({ status }: { status: OrderStatus }) {
  if (status === "huy") {
    return (
      <div className="status-stepper">
        <StatusBadge status="huy" />
      </div>
    );
  }
  const currentIndex = ACTIVE_FLOW.indexOf(status);
  return (
    <div className="status-stepper">
      {ACTIVE_FLOW.map((s, i) => (
        <div key={s} className={`status-step${i < currentIndex ? " done" : ""}${i === currentIndex ? " current" : ""}`}>
          {i < ACTIVE_FLOW.length - 1 && <div className={`status-step-line${i < currentIndex ? " done" : ""}`} />}
          <div className="status-step-dot">{i < currentIndex ? "✓" : i + 1}</div>
          <div className="status-step-label">{STATUS_LABEL[s]}</div>
        </div>
      ))}
    </div>
  );
}

type HistoryRow = { id: string; status: OrderStatus; changed_at: string; changed_by_profile: { display_name: string | null } | null };

function Timeline({ history }: { history: HistoryRow[] }) {
  if (history.length === 0) return null;
  return (
    <div className="timeline">
      {history.map((h, i) => (
        <div key={h.id} className={`timeline-row${i === history.length - 1 ? " current" : ""}`}>
          {i < history.length - 1 && <div className="timeline-line" />}
          <div className="timeline-dot" />
          <div>
            <div className="timeline-status">{STATUS_LABEL[h.status]}</div>
            <div className="timeline-meta">
              {formatDate(h.changed_at)}
              {h.changed_by_profile?.display_name ? ` · ${h.changed_by_profile.display_name}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OrdersView({ userId }: { userId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);
  const [detailHistory, setDetailHistory] = useState<HistoryRow[]>([]);
  const [shipperName, setShipperName] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [nextStatus, setNextStatus] = useState<OrderStatus>("cho_thanh_toan");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
      if (!cancelled) {
        if (!error) setOrders((data as Order[]) ?? []);
        setLoading(false);
      }
    })();

    // Đơn mới từ website hiện ngay không cần tải lại trang, cùng cơ chế
    // realtime "postgres_changes" tra-banh-shop đã dùng cho bảng này.
    const channel = supabase
      .channel("trabanh-orders")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        setOrders((prev) => [payload.new as Order, ...prev]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload) => {
        const updated = payload.new as Order;
        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const counts = useMemo(() => {
    const c = new Map<OrderStatus, number>();
    for (const o of orders) c.set(o.status, (c.get(o.status) ?? 0) + 1);
    return c;
  }, [orders]);

  const stats = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
    let ordersToday = 0;
    let revenue7Days = 0;
    for (const o of orders) {
      const createdAt = new Date(o.created_at);
      if (createdAt >= startOfToday) ordersToday++;
      if (o.status !== "huy" && createdAt >= sevenDaysAgo) revenue7Days += o.total_amount;
    }
    return { ordersToday, revenue7Days, pending: counts.get("cho_thanh_toan") ?? 0 };
  }, [orders, counts]);

  const filtered = useMemo(() => (statusFilter === "all" ? orders : orders.filter((o) => o.status === statusFilter)), [orders, statusFilter]);

  async function openDetail(order: Order) {
    setDetailOrder(order);
    setNextStatus(order.status);
    setDetailItems([]);
    setDetailHistory([]);
    setShipperName(null);
    setDetailLoading(true);
    const [itemsRes, historyRes] = await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", order.id),
      supabase
        .from("order_status_history")
        .select("id, status, changed_at, changed_by_profile:profiles(display_name)")
        .eq("order_id", order.id)
        .order("changed_at", { ascending: true }),
    ]);
    if (!itemsRes.error) setDetailItems((itemsRes.data as OrderItem[]) ?? []);
    if (!historyRes.error) setDetailHistory((historyRes.data as unknown as HistoryRow[]) ?? []);
    if (order.shipper_id) {
      const { data } = await supabase.from("profiles").select("display_name").eq("id", order.shipper_id).maybeSingle();
      setShipperName(data?.display_name ?? null);
    }
    setDetailLoading(false);
  }

  async function saveStatus() {
    if (!detailOrder) return;
    setSaving(true);
    const patch: Partial<Order> = { status: nextStatus };
    if (!detailOrder.confirmed_at) {
      patch.confirmed_at = new Date().toISOString();
      patch.confirmed_by = userId;
    }
    const { data, error } = await supabase.from("orders").update(patch).eq("id", detailOrder.id).select().single();
    if (error) {
      setSaving(false);
      alert("Cập nhật đơn hàng thất bại: " + error.message);
      return;
    }
    const updated = data as Order;
    const { error: historyError } = await supabase
      .from("order_status_history")
      .insert({ order_id: updated.id, status: updated.status, changed_by: userId });
    if (historyError) console.error("saveStatus insert order_status_history:", historyError.message);
    else {
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
      setDetailHistory((prev) => [
        ...prev,
        { id: crypto.randomUUID(), status: updated.status, changed_at: new Date().toISOString(), changed_by_profile: { display_name: profile?.display_name ?? null } },
      ]);
    }
    setSaving(false);
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setDetailOrder(updated);
  }

  const detailTotal = detailItems.reduce((sum, it) => sum + it.thanh_tien, 0);

  return (
    <div className="app app-full table-page">
      <div className="view-header">
        <div>
          <h1>Đơn hàng</h1>
          <p>Đơn đặt từ website tra-banh-shop — xem chi tiết và cập nhật trạng thái xử lý.</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Đơn hôm nay</div>
          <div className="value">{stats.ordersToday}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Doanh thu 7 ngày qua</div>
          <div className="value">{formatVnd(stats.revenue7Days)}đ</div>
        </div>
        <div className="kpi-card">
          <div className="label">Chờ thanh toán</div>
          <div className="value accent">{stats.pending}</div>
        </div>
      </div>

      <Segmented
        items={[
          { key: "all", label: `Tất cả (${orders.length})`, active: statusFilter === "all", onClick: () => setStatusFilter("all") },
          ...STATUS_ORDER.map((s) => ({
            key: s,
            label: `${STATUS_LABEL[s]} (${counts.get(s) ?? 0})`,
            active: statusFilter === s,
            onClick: () => setStatusFilter(s),
          })),
        ]}
      />

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách hàng</th>
                <th>Ngày đặt</th>
                <th className="num">Tổng tiền</th>
                <th>Thanh toán</th>
                <th className="col-status">Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Chưa có đơn hàng nào.
                  </td>
                </tr>
              )}
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td>{o.order_code}</td>
                  <td>
                    <div>{o.customer_name}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{o.customer_phone}</div>
                  </td>
                  <td>{formatDate(o.created_at)}</td>
                  <td className="num">{formatVnd(o.total_amount)}đ</td>
                  <td>{PAYMENT_LABEL[o.payment_method]}</td>
                  <td className="col-status">
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    <button className="btn btn-quiet" onClick={() => openDetail(o)}>
                      Xem chi tiết
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailOrder && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setDetailOrder(null)}>
          <div className="modal modal-wide">
            <h2>Đơn {detailOrder.order_code}</h2>
            <p className="modal-sub">
              {detailOrder.customer_name} · {detailOrder.customer_phone}
            </p>

            <StatusStepper status={detailOrder.status} />

            <div className="field-group">
              {detailOrder.customer_address && <p style={{ margin: 0 }}>Địa chỉ: {detailOrder.customer_address}</p>}
              {detailOrder.geocoded_ward && (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 12.5 }}>
                  Khu vực ước lượng: {detailOrder.geocoded_ward} (để gom tuyến giao hàng, có thể lệch thực tế vài km)
                </p>
              )}
              {detailOrder.note && <p style={{ margin: 0 }}>Ghi chú: {detailOrder.note}</p>}
              <p style={{ margin: 0 }}>Thanh toán: {PAYMENT_LABEL[detailOrder.payment_method]}</p>
              <p style={{ margin: 0 }}>Đặt lúc: {formatDate(detailOrder.created_at)}</p>
              {detailOrder.confirmed_at && <p style={{ margin: 0 }}>Xác nhận lúc: {formatDate(detailOrder.confirmed_at)}</p>}
              {detailOrder.shipper_id && <p style={{ margin: 0 }}>Shipper: {shipperName ?? "Đang tải..."}</p>}
            </div>

            {detailHistory.length > 0 && (
              <div className="field-group">
                <h3>Dòng thời gian</h3>
                <Timeline history={detailHistory} />
              </div>
            )}

            <div className="table-card" style={{ marginTop: 10 }}>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Đơn vị</th>
                      <th className="num">Đơn giá</th>
                      <th className="num">SL</th>
                      <th className="num">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLoading && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>
                          Đang tải...
                        </td>
                      </tr>
                    )}
                    {!detailLoading &&
                      detailItems.map((it) => (
                        <tr key={it.id}>
                          <td>{it.ten_hang_hoa}</td>
                          <td>{it.don_vi === "thung" ? "Thùng" : "Lẻ"}</td>
                          <td className="num">{formatVnd(it.don_gia)}đ</td>
                          <td className="num">{it.so_luong}</td>
                          <td className="num">{formatVnd(it.thanh_tien)}đ</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p style={{ textAlign: "right", fontWeight: 600, margin: "8px 0 0" }}>Tổng cộng: {formatVnd(detailTotal)}đ</p>

            <div className="field-group" style={{ marginTop: 14 }}>
              <label className="field">
                Trạng thái
                <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as OrderStatus)}>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setDetailOrder(null)}>
                Đóng
              </button>
              <button className="btn btn-primary" type="button" disabled={saving || nextStatus === detailOrder.status} onClick={saveStatus}>
                {saving ? "Đang lưu..." : "Lưu trạng thái"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
