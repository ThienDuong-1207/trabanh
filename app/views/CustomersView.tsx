"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Order, OrderStatus } from "@/lib/types";

function formatVnd(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("vi-VN");
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  cho_thanh_toan: "Chờ thanh toán",
  da_thanh_toan: "Đã thanh toán",
  dang_xu_ly: "Đang xử lý",
  dang_giao: "Đang giao",
  hoan_thanh: "Hoàn thành",
  huy: "Đã huỷ",
};

type CustomerSummary = { phone: string; name: string; orderCount: number; totalSpent: number; lastOrderAt: string; orders: Order[] };

// "Khách hàng" — chưa có bảng customers riêng, gom trực tiếp từ orders theo
// customer_phone (giống tra-banh-shop/components/admin/CustomersView.tsx,
// cùng đọc một bảng orders trong CÙNG project Supabase).
export default function CustomersView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<CustomerSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(2000);
      if (!cancelled) {
        if (!error) setOrders((data as Order[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const customers = useMemo(() => {
    const byPhone = new Map<string, CustomerSummary>();
    for (const o of orders) {
      const existing = byPhone.get(o.customer_phone);
      if (existing) {
        existing.orderCount++;
        if (o.status !== "huy") existing.totalSpent += o.total_amount;
        existing.orders.push(o);
      } else {
        byPhone.set(o.customer_phone, {
          phone: o.customer_phone,
          name: o.customer_name,
          orderCount: 1,
          totalSpent: o.status !== "huy" ? o.total_amount : 0,
          lastOrderAt: o.created_at,
          orders: [o],
        });
      }
    }
    return [...byPhone.values()].sort((a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime());
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, query]);

  return (
    <div className="app app-full table-page">
      <div className="view-header">
        <div>
          <h1>Khách hàng</h1>
          <p>Gom từ đơn hàng website tra-banh-shop theo số điện thoại — nhận ra khách quen đặt lại thường xuyên.</p>
        </div>
      </div>

      <div className="toolbar">
        <input placeholder="Tìm theo tên hoặc số điện thoại..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Khách hàng</th>
                <th>Số điện thoại</th>
                <th className="num">Số đơn</th>
                <th className="num">Tổng chi tiêu</th>
                <th>Đơn gần nhất</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Chưa có khách hàng nào khớp.
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.phone}>
                  <td>{c.name}</td>
                  <td>{c.phone}</td>
                  <td className="num">{c.orderCount}</td>
                  <td className="num">{formatVnd(c.totalSpent)}đ</td>
                  <td>{formatDate(c.lastOrderAt)}</td>
                  <td>
                    <button className="btn btn-quiet" onClick={() => setDetail(c)}>
                      Xem đơn hàng
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal modal-wide">
            <h2>{detail.name}</h2>
            <p className="modal-sub">
              {detail.phone} · {detail.orderCount} đơn · Tổng chi tiêu {formatVnd(detail.totalSpent)}đ
            </p>

            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Mã đơn</th>
                      <th>Ngày đặt</th>
                      <th className="num">Tổng tiền</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.order_code}</td>
                        <td>{formatDate(o.created_at)}</td>
                        <td className="num">{formatVnd(o.total_amount)}đ</td>
                        <td>{STATUS_LABEL[o.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setDetail(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
