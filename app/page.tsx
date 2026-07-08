"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Product, ProductInput, CATEGORY_ORDER } from "@/lib/types";

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [brandNames, setBrandNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Tất cả");
  const [brandFilter, setBrandFilter] = useState<string>("Tất cả");
  const [missingOnly, setMissingOnly] = useState(false);
  const [tab, setTab] = useState<"all" | "pending">("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<"misa" | "word" | null>(null);
  const [exportingAll, setExportingAll] = useState<"category" | "brand" | "word" | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [formTarget, setFormTarget] = useState<"new" | Product | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadProducts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*, brand:brands(name)")
      .order("category_sheet", { ascending: true })
      .order("ten_hang_hoa", { ascending: true });
    if (error) {
      alert("Lỗi tải dữ liệu: " + error.message);
    } else {
      setProducts(data as Product[]);
    }
    setLoading(false);
  }

  async function loadBrandNames() {
    const { data, error } = await supabase.from("brands").select("name").order("name");
    if (!error) setBrandNames((data ?? []).map((b) => b.name as string));
  }

  useEffect(() => {
    loadProducts();
    loadBrandNames();
  }, []);

  const pendingIds = useMemo(
    () =>
      new Set(
        products
          .filter((p) => !p.last_exported_at || new Date(p.updated_at) > new Date(p.last_exported_at))
          .map((p) => p.id)
      ),
    [products]
  );

  const visible = useMemo(() => {
    let list = products;
    if (tab === "pending") list = list.filter((p) => pendingIds.has(p.id));
    if (category !== "Tất cả") list = list.filter((p) => p.category_sheet === category);
    if (brandFilter !== "Tất cả") list = list.filter((p) => p.brand?.name === brandFilter);
    if (missingOnly) list = list.filter(isMissingInfo);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.ten_hang_hoa?.toLowerCase().includes(q) ||
          p.ten_hoa_don?.toLowerCase().includes(q) ||
          p.ma_noi_bo?.toLowerCase().includes(q) ||
          p.ma_vach?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, tab, category, brandFilter, missingOnly, search, pendingIds]);

  async function savePrice(p: Product, field: "gia_ban" | "gia_thung", value: string) {
    const num = value.trim() === "" ? null : Number(value.replace(/[^\d]/g, ""));
    if (value.trim() !== "" && (num === null || Number.isNaN(num))) {
      alert("Giá không hợp lệ");
      return;
    }
    setSavingId(p.id);
    const { error } = await supabase.from("products").update({ [field]: num }).eq("id", p.id);
    setSavingId(null);
    if (error) {
      alert("Lưu thất bại: " + error.message);
      return;
    }
    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, [field]: num, updated_at: new Date().toISOString() } : x))
    );
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    setSelected(new Set(visible.map((p) => p.id)));
  }

  async function doExport(kind: "misa" | "word") {
    if (selected.size === 0) {
      alert("Chọn ít nhất 1 sản phẩm để xuất file.");
      return;
    }
    setExporting(kind);
    try {
      const res = await fetch(`/api/export-${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      const blob = await res.blob();
      downloadBlob(blob, kind === "misa" ? "MISA_Import_Update.xlsx" : "Bang_gia_block_7.7x4cm_Update.docx");

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("products")
        .update({ last_exported_at: now })
        .in("id", Array.from(selected));
      if (error) throw error;
      await loadProducts();
      setSelected(new Set());
    } catch (e: any) {
      alert("Xuất file thất bại: " + e.message);
    } finally {
      setExporting(null);
    }
  }

  const EXPORT_ALL_ROUTES: Record<"category" | "brand" | "word", { url: string; filename: string }> = {
    category: { url: "/api/export-by-category", filename: "Danh_sach_theo_loai.xlsx" },
    brand: { url: "/api/export-by-brand", filename: "Danh_sach_theo_thuong_hieu.xlsx" },
    word: { url: "/api/export-word-all", filename: "Bang_gia_block_7.7x4cm_Toan_bo.docx" },
  };

  async function doExportAll(kind: "category" | "brand" | "word") {
    setExportingAll(kind);
    try {
      const { url, filename } = EXPORT_ALL_ROUTES[kind];
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      const blob = await res.blob();
      downloadBlob(blob, filename);
    } catch (e: any) {
      alert("Xuất file thất bại: " + e.message);
    } finally {
      setExportingAll(null);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import-products", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nhập file thất bại");
      const skipped = data.skippedSheets?.length ? ` (bỏ qua sheet: ${data.skippedSheets.join(", ")})` : "";
      alert(`Đã nhập ${data.productsUpserted} sản phẩm, ${data.brandsUpserted} thương hiệu.${skipped}`);
      await loadProducts();
      await loadBrandNames();
    } catch (e: any) {
      alert("Nhập file thất bại: " + e.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSaveProduct(input: ProductInput) {
    const isCreate = formTarget === "new";
    const id = formTarget && formTarget !== "new" ? formTarget.id : undefined;
    try {
      const res = await fetch(id ? `/api/products/${id}` : "/api/products", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lưu thất bại");
      setFormTarget(null);
      await loadProducts();
      await loadBrandNames();
      if (isCreate) {
        // Jump straight to the pending-export view with the new product ready
        // to export, skipping the search-and-tick step.
        setTab("pending");
        setCategory("Tất cả");
        setBrandFilter("Tất cả");
        setMissingOnly(false);
        setSearch("");
        setSelected(new Set([data.id]));
      }
    } catch (e: any) {
      alert("Lưu sản phẩm thất bại: " + e.message);
    }
  }

  async function handleDeleteProduct(p: Product) {
    if (!confirm(`Xóa sản phẩm "${p.ten_hang_hoa}"? Không thể hoàn tác.`)) return;
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xóa thất bại");
      await loadProducts();
    } catch (e: any) {
      alert("Xóa sản phẩm thất bại: " + e.message);
    }
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 22 }}>Quản lý giá sản phẩm — Tiệm Trà Bánh</h1>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0", flexWrap: "wrap" }}>
        <input
          placeholder="Tìm theo tên / mã / mã vạch..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 8, minWidth: 260, borderRadius: 6, border: "1px solid #ccc" }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: 8, borderRadius: 6 }}>
          <option>Tất cả</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} style={{ padding: 8, borderRadius: 6 }}>
          <option>Tất cả</option>
          {brandNames.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#333" }}>
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          Chỉ hiện SP thiếu thông tin
        </label>
        <div style={{ display: "flex", gap: 4, background: "#e9ebef", borderRadius: 8, padding: 4 }}>
          <button
            onClick={() => setTab("pending")}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
              background: tab === "pending" ? "#fff" : "transparent",
              fontWeight: tab === "pending" ? 700 : 400,
            }}
          >
            Chờ xuất file ({pendingIds.size})
          </button>
          <button
            onClick={() => setTab("all")}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
              background: tab === "all" ? "#fff" : "transparent",
              fontWeight: tab === "all" ? 700 : 400,
            }}
          >
            Tất cả ({products.length})
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => setFormTarget("new")} style={btnStyle("#1F4E78", "#fff")}>
          + Thêm sản phẩm
        </button>
        <button disabled={importing} onClick={() => fileInputRef.current?.click()} style={btnStyle("#fff", "#333")}>
          {importing ? "Đang nhập..." : "Nhập từ Excel"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
          }}
        />
        <div style={{ flex: 1 }} />
        <button disabled={exportingAll !== null} onClick={() => doExportAll("category")} style={btnStyle("#fff", "#333")}>
          {exportingAll === "category" ? "Đang xuất..." : "Xuất theo loại"}
        </button>
        <button disabled={exportingAll !== null} onClick={() => doExportAll("brand")} style={btnStyle("#fff", "#333")}>
          {exportingAll === "brand" ? "Đang xuất..." : "Xuất theo thương hiệu"}
        </button>
        <button disabled={exportingAll !== null} onClick={() => doExportAll("word")} style={btnStyle("#fff", "#333")}>
          {exportingAll === "word" ? "Đang xuất..." : "Xuất toàn bộ bảng giá"}
        </button>
      </div>

      {tab === "pending" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <button onClick={selectAllPending} style={btnStyle("#fff", "#333")}>
            Chọn tất cả đang hiện ({visible.length})
          </button>
          <button onClick={() => setSelected(new Set())} style={btnStyle("#fff", "#333")}>
            Bỏ chọn
          </button>
          <span style={{ color: "#666" }}>Đã chọn: {selected.size}</span>
          <div style={{ flex: 1 }} />
          <button disabled={exporting !== null} onClick={() => doExport("misa")} style={btnStyle("#1F4E78", "#fff")}>
            {exporting === "misa" ? "Đang xuất..." : "Xuất MISA (.xlsx)"}
          </button>
          <button disabled={exporting !== null} onClick={() => doExport("word")} style={btnStyle("#8a1f1f", "#fff")}>
            {exporting === "word" ? "Đang xuất..." : "Xuất bảng giá 7.7x4cm (.docx)"}
          </button>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", border: "1px solid #ddd" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#1F4E78", color: "#fff", textAlign: "left" }}>
              {tab === "pending" && <th style={th}></th>}
              <th style={th}>Mã hàng hóa</th>
              <th style={th}>Tên trên hóa đơn</th>
              <th style={th}>Nhóm</th>
              <th style={th}>ĐVT</th>
              <th style={th}>Giá bán lẻ</th>
              <th style={th}>Giá thùng</th>
              <th style={th}>Cập nhật lúc</th>
              <th style={th}>Đã xuất lúc</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: "center" }}>Đang tải...</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: "#888" }}>Không có sản phẩm nào.</td></tr>
            )}
            {visible.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #eee", background: pendingIds.has(p.id) ? "#fff8e6" : "#fff" }}>
                {tab === "pending" && (
                  <td style={td}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                  </td>
                )}
                <td style={{ ...td, fontFamily: "monospace" }}>{p.ma_noi_bo}</td>
                <td style={td}>{p.ten_hoa_don || p.ten_hang_hoa}</td>
                <td style={td}>{p.category_sheet}</td>
                <td style={td}>{p.dvt}</td>
                <td style={td}>
                  <PriceInput value={p.gia_ban} onSave={(v) => savePrice(p, "gia_ban", v)} saving={savingId === p.id} />
                </td>
                <td style={td}>
                  <PriceInput value={p.gia_thung} onSave={(v) => savePrice(p, "gia_thung", v)} saving={savingId === p.id} />
                </td>
                <td style={{ ...td, fontSize: 12, color: "#666" }}>{formatDate(p.updated_at)}</td>
                <td style={{ ...td, fontSize: 12, color: "#666" }}>
                  {p.last_exported_at ? formatDate(p.last_exported_at) : "Chưa xuất"}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button onClick={() => setFormTarget(p)} style={smallBtnStyle}>Sửa</button>
                  <button onClick={() => handleDeleteProduct(p)} style={{ ...smallBtnStyle, marginLeft: 6, color: "#8a1f1f" }}>Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "#888", fontSize: 12, marginTop: 16 }}>
        Sửa giá xong tự lưu ngay (không cần bấm nút riêng). Sản phẩm nào vừa đổi giá sẽ tự hiện ở tab
        &quot;Chờ xuất file&quot; — chọn xong bấm xuất MISA hoặc Word, chỉ đúng các sản phẩm đã chọn.
      </p>

      {formTarget !== null && (
        <ProductForm
          initial={formTarget === "new" ? null : formTarget}
          brandNames={brandNames}
          onCancel={() => setFormTarget(null)}
          onSave={handleSaveProduct}
        />
      )}
    </main>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PriceInput({ value, onSave, saving }: { value: number | null; onSave: (v: string) => void; saving: boolean }) {
  const [local, setLocal] = useState(value?.toString() ?? "");
  useEffect(() => setLocal(value?.toString() ?? ""), [value]);
  return (
    <input
      value={local}
      disabled={saving}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== (value?.toString() ?? "")) onSave(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{ width: 100, padding: 4, border: "1px solid #ccc", borderRadius: 4, textAlign: "right" }}
    />
  );
}

type FormState = {
  ma_noi_bo: string;
  ten_hang_hoa: string;
  ten_hoa_don: string;
  dvt: string;
  gia_ban: string;
  gia_thung: string;
  quy_cach: string;
  ty_le: string;
  brand: string;
  ma_hang_hoa: string;
  ma_vach: string;
  ma_thung: string;
  ma_nhom_thay_the: string;
  trang_thai: string;
  ten_shopee: string;
  ten_tiktok: string;
  xuat_xu: string;
  category_sheet: string;
};

function productToFormState(p: Product | null): FormState {
  return {
    ma_noi_bo: p?.ma_noi_bo ?? "",
    ten_hang_hoa: p?.ten_hang_hoa ?? "",
    ten_hoa_don: p?.ten_hoa_don ?? "",
    dvt: p?.dvt ?? "",
    gia_ban: p?.gia_ban?.toString() ?? "",
    gia_thung: p?.gia_thung?.toString() ?? "",
    quy_cach: p?.quy_cach ?? "",
    ty_le: p?.ty_le?.toString() ?? "",
    brand: p?.brand?.name ?? "",
    ma_hang_hoa: p?.ma_hang_hoa ?? "",
    ma_vach: p?.ma_vach ?? "",
    ma_thung: p?.ma_thung ?? "",
    ma_nhom_thay_the: p?.ma_nhom_thay_the ?? "",
    trang_thai: p?.trang_thai ?? "",
    ten_shopee: p?.ten_shopee ?? "",
    ten_tiktok: p?.ten_tiktok ?? "",
    xuat_xu: p?.xuat_xu ?? "",
    category_sheet: p?.category_sheet ?? CATEGORY_ORDER[0],
  };
}

function formStateToInput(f: FormState): ProductInput {
  const str = (s: string) => (s.trim() === "" ? null : s.trim());
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    ma_noi_bo: f.ma_noi_bo.trim(),
    ten_hang_hoa: f.ten_hang_hoa.trim(),
    ten_hoa_don: str(f.ten_hoa_don),
    dvt: str(f.dvt),
    gia_ban: num(f.gia_ban),
    gia_thung: num(f.gia_thung),
    quy_cach: str(f.quy_cach),
    ty_le: num(f.ty_le),
    brand: str(f.brand),
    ma_hang_hoa: str(f.ma_hang_hoa),
    ma_vach: str(f.ma_vach),
    ma_thung: str(f.ma_thung),
    ma_nhom_thay_the: str(f.ma_nhom_thay_the),
    trang_thai: str(f.trang_thai),
    ten_shopee: str(f.ten_shopee),
    ten_tiktok: str(f.ten_tiktok),
    xuat_xu: str(f.xuat_xu),
    category_sheet: f.category_sheet,
  };
}

function ProductForm({
  initial, brandNames, onCancel, onSave,
}: {
  initial: Product | null;
  brandNames: string[];
  onCancel: () => void;
  onSave: (input: ProductInput) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => productToFormState(initial));
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!form.ma_noi_bo.trim() || !form.ten_hang_hoa.trim()) {
      alert("Cần nhập Mã nội bộ và Tên hàng hóa.");
      return;
    }
    setSaving(true);
    await onSave(formStateToInput(form));
    setSaving(false);
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>{initial ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h2>

        <div style={formGrid}>
          <Field label="Mã nội bộ *"><input style={inputStyle} value={form.ma_noi_bo} onChange={(e) => set("ma_noi_bo", e.target.value)} disabled={!!initial} /></Field>
          <Field label="Nhóm hàng *">
            <select style={inputStyle} value={form.category_sheet} onChange={(e) => set("category_sheet", e.target.value)}>
              {CATEGORY_ORDER.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Tên hàng hóa (gốc) *"><input style={inputStyle} value={form.ten_hang_hoa} onChange={(e) => set("ten_hang_hoa", e.target.value)} /></Field>
          <Field label="Tên trên hóa đơn"><input style={inputStyle} value={form.ten_hoa_don} onChange={(e) => set("ten_hoa_don", e.target.value)} /></Field>
          <Field label="Đơn vị tính"><input style={inputStyle} value={form.dvt} onChange={(e) => set("dvt", e.target.value)} /></Field>
          <Field label="Thương hiệu / NCC">
            <input style={inputStyle} list="brand-list" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            <datalist id="brand-list">{brandNames.map((b) => <option key={b} value={b} />)}</datalist>
          </Field>
          <Field label="Giá bán lẻ"><input style={inputStyle} value={form.gia_ban} onChange={(e) => set("gia_ban", e.target.value)} /></Field>
          <Field label="Giá thùng"><input style={inputStyle} value={form.gia_thung} onChange={(e) => set("gia_thung", e.target.value)} /></Field>
          <Field label="Quy cách thùng"><input style={inputStyle} value={form.quy_cach} onChange={(e) => set("quy_cach", e.target.value)} /></Field>
          <Field label="Tỷ lệ quy đổi"><input style={inputStyle} value={form.ty_le} onChange={(e) => set("ty_le", e.target.value)} /></Field>
          <Field label="Mã hàng hóa (NCC/POS)"><input style={inputStyle} value={form.ma_hang_hoa} onChange={(e) => set("ma_hang_hoa", e.target.value)} /></Field>
          <Field label="Mã vạch"><input style={inputStyle} value={form.ma_vach} onChange={(e) => set("ma_vach", e.target.value)} /></Field>
          <Field label="Mã thùng"><input style={inputStyle} value={form.ma_thung} onChange={(e) => set("ma_thung", e.target.value)} /></Field>
          <Field label="Mã nhóm thay thế"><input style={inputStyle} value={form.ma_nhom_thay_the} onChange={(e) => set("ma_nhom_thay_the", e.target.value)} /></Field>
          <Field label="Trạng thái"><input style={inputStyle} value={form.trang_thai} onChange={(e) => set("trang_thai", e.target.value)} /></Field>
          <Field label="Xuất xứ"><input style={inputStyle} value={form.xuat_xu} onChange={(e) => set("xuat_xu", e.target.value)} /></Field>
          <Field label="Tên sàn Shopee"><input style={inputStyle} value={form.ten_shopee} onChange={(e) => set("ten_shopee", e.target.value)} /></Field>
          <Field label="Tên sàn TikTok Shop"><input style={inputStyle} value={form.ten_tiktok} onChange={(e) => set("ten_tiktok", e.target.value)} /></Field>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onCancel} style={btnStyle("#fff", "#333")}>Hủy</button>
          <button disabled={saving} onClick={submit} style={btnStyle("#1F4E78", "#fff")}>
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#333" }}>
      {label}
      {children}
    </label>
  );
}

// A product "thiếu thông tin" if it has no thương hiệu, no mã vạch, or an
// inconsistent quy cách thùng (only some of quy_cach/ty_le/gia_thung are set).
function isMissingInfo(p: Product): boolean {
  if (!p.brand_id) return true;
  if (!p.ma_vach) return true;
  const thungFields = [p.quy_cach, p.ty_le, p.gia_thung];
  const thungFieldsSet = thungFields.filter((v) => v !== null && v !== undefined && v !== "").length;
  if (thungFieldsSet > 0 && thungFieldsSet < thungFields.length) return true;
  return false;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 600, fontSize: 13 };
const td: React.CSSProperties = { padding: "8px 12px" };
const inputStyle: React.CSSProperties = { padding: 8, borderRadius: 6, border: "1px solid #ccc", width: "100%" };
const smallBtnStyle: React.CSSProperties = { background: "#fff", border: "1px solid #ccc", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 };
const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 };
const modalStyle: React.CSSProperties = { background: "#fff", borderRadius: 10, padding: 24, width: "min(720px, 92vw)", maxHeight: "88vh", overflowY: "auto" };
const formGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
function btnStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, border: "1px solid #ccc", borderRadius: 6, padding: "8px 14px", cursor: "pointer" };
}
