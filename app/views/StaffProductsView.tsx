"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Product } from "@/lib/types";

function formatVnd(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("vi-VN");
}

// Bảng hàng hóa CHỈ XEM cho trang staff (/staff) — không có ô sửa/nút xóa nào,
// cố tình KHÔNG dùng lại ProductRow (bảng nội bộ dày đặc, có thể sửa) để
// chắc chắn staff không sửa/xóa được gì, dù vô tình. Đọc trực tiếp bảng
// products qua RLS ("role is not null" được đọc), không cần route riêng.
export default function StaffProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Tất cả");

  useEffect(() => {
    supabase
      .from("products")
      .select("id, ma_noi_bo, ten_hang_hoa, ma_vach, dvt, gia_ban, gia_thung, quy_cach, category_sheet, photo_url, is_combo, is_draft, brand:brands(name)")
      .eq("is_draft", false)
      .order("ten_hang_hoa")
      .then(({ data, error }) => {
        if (!error) setProducts((data as unknown as Product[]) ?? []);
        setLoading(false);
      });
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) set.add(p.category_sheet);
    return ["Tất cả", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "Tất cả" && p.category_sheet !== category) return false;
      if (!q) return true;
      return p.ten_hang_hoa.toLowerCase().includes(q) || p.ma_noi_bo.toLowerCase().includes(q) || (p.ma_vach ?? "").includes(q);
    });
  }, [products, search, category]);

  return (
    <div className="app app-full table-page">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Hàng hóa</h1>
          <p className="app-header-meta">{filtered.length} sản phẩm · chỉ xem, không sửa/xóa được</p>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <input placeholder="Tìm theo tên / mã / mã vạch..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ảnh</th>
                <th>Tên hàng hóa</th>
                <th>Mã</th>
                <th>ĐVT</th>
                <th>Quy cách</th>
                <th className="num">Giá bán</th>
                <th className="num">Giá thùng</th>
                <th>Thương hiệu</th>
                <th>Nhóm hàng</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Không có sản phẩm nào khớp.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.photo_url} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: "var(--radius-sm)" }} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{p.ten_hang_hoa}</td>
                  <td>{p.ma_noi_bo}</td>
                  <td>{p.dvt ?? "—"}</td>
                  <td>{p.quy_cach ?? "—"}</td>
                  <td className="num">{formatVnd(p.gia_ban)}đ</td>
                  <td className="num">{formatVnd(p.gia_thung)}đ</td>
                  <td>{p.brand?.name ?? "—"}</td>
                  <td>{p.category_sheet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
