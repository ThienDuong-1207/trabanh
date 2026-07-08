"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Product, ProductInput, CATEGORY_ORDER } from "@/lib/types";
import { QUY_CACH_SUGGESTIONS, TY_LE_SUGGESTIONS, extractQuantityFromQuyCach } from "@/lib/suggestionLists";

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [brandNames, setBrandNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Tất cả");
  const [brandFilter, setBrandFilter] = useState<string>("Tất cả");
  const [missingOnly, setMissingOnly] = useState(false);
  const [tab, setTab] = useState<"all" | "pending">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<"misa" | "word" | null>(null);
  const [exportingAll, setExportingAll] = useState<"category" | "brand" | "word" | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [formTarget, setFormTarget] = useState<"new" | Product | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
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

  function selectAllVisible() {
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

  async function dismissPending() {
    if (selected.size === 0) {
      alert("Chọn ít nhất 1 sản phẩm để bỏ chờ xuất file.");
      return;
    }
    if (!confirm(`Bỏ chờ xuất file cho ${selected.size} sản phẩm? Sẽ không tải file nào, chỉ tắt trạng thái "chờ xuất".`)) return;
    setDismissing(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("products").update({ last_exported_at: now }).in("id", Array.from(selected));
      if (error) throw error;
      await loadProducts();
      setSelected(new Set());
    } catch (e: any) {
      alert("Thao tác thất bại: " + e.message);
    } finally {
      setDismissing(false);
    }
  }

  const EXPORT_ALL_ROUTES: Record<"category" | "brand" | "word", { url: string; filename: string }> = {
    category: { url: "/api/export-by-category", filename: "Danh_sach_theo_loai.xlsx" },
    brand: { url: "/api/export-by-brand", filename: "Danh_sach_theo_thuong_hieu.xlsx" },
    word: { url: "/api/export-word-all", filename: "Bang_gia_block_7.7x4cm_Toan_bo.docx" },
  };

  async function doExportAll(kind: "category" | "brand" | "word") {
    setMoreMenuOpen(false);
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
    setMoreMenuOpen(false);
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
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      await loadProducts();
    } catch (e: any) {
      alert("Xóa sản phẩm thất bại: " + e.message);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>Quản lý giá sản phẩm — Tiệm Trà Bánh</h1>
        <div className="stat-chips">
          <div className="chip">
            Tổng <b>{products.length}</b>
          </div>
          <div className="chip warm">
            Chờ xuất <b>{pendingIds.size}</b>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <SearchIcon />
          <input placeholder="Tìm theo tên / mã / mã vạch..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option>Tất cả</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option>Tất cả</option>
          {brandNames.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <label className={`toggle-pill${missingOnly ? " active" : ""}`}>
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          <WarningIcon />
          Thiếu thông tin
        </label>

        <div className="toolbar-spacer" />

        <button className="btn btn-primary" onClick={() => setFormTarget("new")}>
          <PlusIcon />
          Thêm sản phẩm
        </button>

        <div className="menu-wrap" ref={moreMenuRef}>
          <button className="btn" onClick={() => setMoreMenuOpen((v) => !v)} disabled={importing || exportingAll !== null}>
            {importing || exportingAll !== null ? "Đang xử lý..." : "Nhập & xuất"}
            <ChevronDownIcon />
          </button>
          {moreMenuOpen && (
            <div className="menu">
              <button onClick={() => fileInputRef.current?.click()}>
                <ImportIcon />
                Nhập từ Excel
              </button>
              <div className="menu-divider" />
              <button onClick={() => doExportAll("category")}>
                <SheetIcon />
                Xuất theo loại sản phẩm
              </button>
              <button onClick={() => doExportAll("brand")}>
                <SheetIcon />
                Xuất theo thương hiệu
              </button>
              <button onClick={() => doExportAll("word")}>
                <DocIcon />
                Xuất toàn bộ bảng giá (.docx)
              </button>
            </div>
          )}
        </div>
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
      </div>

      <div className="view-row">
        <div className="view-row-left">
          <div className="segmented">
            <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
              Tất cả ({products.length})
            </button>
            <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>
              Chờ xuất file ({pendingIds.size})
            </button>
          </div>
          <button className="btn btn-neutral" onClick={selectAllVisible}>
            Chọn tất cả đang hiện
          </button>
          {selected.size > 0 && (
            <button className="btn btn-danger" onClick={() => setSelected(new Set())}>
              Bỏ chọn
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="selection-bar">
            <span>
              Đã chọn <b>{selected.size}</b> sản phẩm
            </span>
            <button className="btn btn-primary solid-primary" disabled={exporting !== null} onClick={() => doExport("misa")}>
              {exporting === "misa" ? "Đang xuất..." : "Xuất MISA (.xlsx)"}
            </button>
            <button className="btn" disabled={exporting !== null} onClick={() => doExport("word")}>
              {exporting === "word" ? "Đang xuất..." : "Xuất bảng giá (.docx)"}
            </button>
            {tab === "pending" && (
              <button className="btn btn-danger" disabled={dismissing} onClick={dismissPending}>
                {dismissing ? "Đang xử lý..." : "Bỏ chờ xuất file"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Mã · Tên sản phẩm</th>
                <th>Nhóm</th>
                <th>ĐVT</th>
                <th className="num">Giá bán lẻ</th>
                <th className="num">Giá thùng</th>
                <th>Trạng thái</th>
                <th style={{ width: 76 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="loading-state">
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    Không có sản phẩm nào.
                  </td>
                </tr>
              )}
              {visible.map((p) => {
                const isPending = pendingIds.has(p.id);
                return (
                  <tr key={p.id} className={isPending ? "is-pending" : ""}>
                    <td>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                    </td>
                    <td className="name-cell">
                      {p.ten_hoa_don || p.ten_hang_hoa}
                      <span className="sub code-cell">{p.ma_noi_bo}</span>
                    </td>
                    <td>{p.category_sheet}</td>
                    <td>{p.dvt}</td>
                    <td className="num">
                      <PriceInput value={p.gia_ban} onSave={(v) => savePrice(p, "gia_ban", v)} saving={savingId === p.id} />
                    </td>
                    <td className="num">
                      <PriceInput value={p.gia_thung} onSave={(v) => savePrice(p, "gia_thung", v)} saving={savingId === p.id} />
                    </td>
                    <td>
                      <StatusPill product={p} isPending={isPending} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Sửa" aria-label="Sửa sản phẩm" onClick={() => setFormTarget(p)}>
                          <EditIcon />
                        </button>
                        <button className="icon-btn danger" title="Xóa" aria-label="Xóa sản phẩm" onClick={() => handleDeleteProduct(p)}>
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="helper-text">
        Sửa giá xong tự lưu ngay (không cần bấm nút riêng). Sản phẩm nào vừa đổi giá sẽ tự hiện ở tab &quot;Chờ xuất
        file&quot; — chọn xong bấm xuất MISA hoặc Word, chỉ đúng các sản phẩm đã chọn.
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
      className="price-input"
      value={local}
      disabled={saving}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== (value?.toString() ?? "")) onSave(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function StatusPill({ product, isPending }: { product: Product; isPending: boolean }) {
  const title = `Cập nhật: ${formatDate(product.updated_at)}${
    product.last_exported_at ? " · Đã xuất: " + formatDate(product.last_exported_at) : ""
  }`;
  if (isPending) {
    return (
      <span className="status-pill warm" title={title}>
        <span className="dot" />
        {product.last_exported_at ? "Vừa sửa giá" : "Mới thêm"}
      </span>
    );
  }
  return (
    <span className="status-pill success" title={title}>
      <span className="dot" />
      Đã xuất {relativeTimeVi(product.last_exported_at!)}
    </span>
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

// Dropdown options are curated suggestions, not an exhaustive list — if the
// current value isn't among them (custom/legacy data), keep it selectable.
function withCurrent(options: (string | number)[], current: string): string[] {
  const strOptions = options.map(String);
  return current && !strOptions.includes(current) ? [...strOptions, current] : strOptions;
}

function ProductForm({
  initial,
  brandNames,
  onCancel,
  onSave,
}: {
  initial: Product | null;
  brandNames: string[];
  onCancel: () => void;
  onSave: (input: ProductInput) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => productToFormState(initial));
  const [saving, setSaving] = useState(false);

  const [brandCustom, setBrandCustom] = useState(!!initial?.brand?.name && !brandNames.includes(initial.brand.name));

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setQuyCach(value: string) {
    setForm((prev) => {
      const autoTyLe = prev.ty_le.trim() === "" ? extractQuantityFromQuyCach(value) : null;
      return { ...prev, quy_cach: value, ty_le: autoTyLe !== null ? String(autoTyLe) : prev.ty_le };
    });
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
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h2>{initial ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h2>
        <p className="modal-sub">Điền thông tin cơ bản trước — các mục còn lại có thể bổ sung sau.</p>

        <div className="field-group">
          <h3>Thông tin cơ bản</h3>
          <div className="field-grid">
            <Field label="Mã nội bộ *">
              <input value={form.ma_noi_bo} onChange={(e) => set("ma_noi_bo", e.target.value)} disabled={!!initial} />
            </Field>
            <Field label="Nhóm hàng *">
              <select value={form.category_sheet} onChange={(e) => set("category_sheet", e.target.value)}>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Tên hàng hóa (gốc) *">
              <input value={form.ten_hang_hoa} onChange={(e) => set("ten_hang_hoa", e.target.value)} />
            </Field>
            <Field label="Tên trên hóa đơn">
              <input value={form.ten_hoa_don} onChange={(e) => set("ten_hoa_don", e.target.value)} />
            </Field>
            <Field label="Đơn vị tính">
              <input value={form.dvt} onChange={(e) => set("dvt", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="field-group">
          <h3>Giá &amp; quy cách thùng</h3>
          <div className="field-grid">
            <Field label="Giá bán lẻ">
              <input value={form.gia_ban} onChange={(e) => set("gia_ban", e.target.value)} />
            </Field>
            <Field label="Giá thùng">
              <input value={form.gia_thung} onChange={(e) => set("gia_thung", e.target.value)} />
            </Field>
            <Field label="Quy cách thùng">
              <select value={form.quy_cach} onChange={(e) => setQuyCach(e.target.value)}>
                <option value="">— Chọn quy cách —</option>
                {withCurrent(QUY_CACH_SUGGESTIONS, form.quy_cach).map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </Field>
            <Field label="Tỷ lệ quy đổi">
              <select value={form.ty_le} onChange={(e) => set("ty_le", e.target.value)}>
                <option value="">— Chọn tỷ lệ —</option>
                {withCurrent(TY_LE_SUGGESTIONS, form.ty_le).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="field-group">
          <h3>Thương hiệu &amp; mã liên quan</h3>
          <div className="field-grid">
            <Field label="Thương hiệu / NCC">
              {brandCustom ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    autoFocus
                    placeholder="Nhập tên thương hiệu mới"
                    value={form.brand}
                    onChange={(e) => set("brand", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-quiet" onClick={() => setBrandCustom(false)}>
                    Chọn từ danh sách
                  </button>
                </div>
              ) : (
                <select
                  value={brandNames.includes(form.brand) ? form.brand : ""}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setBrandCustom(true);
                      set("brand", "");
                    } else {
                      set("brand", e.target.value);
                    }
                  }}
                >
                  <option value="">— Chọn thương hiệu —</option>
                  {brandNames.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                  <option value="__new__">+ Thương hiệu mới…</option>
                </select>
              )}
            </Field>
            <Field label="Mã hàng hóa (NCC/POS)">
              <input value={form.ma_hang_hoa} onChange={(e) => set("ma_hang_hoa", e.target.value)} />
            </Field>
            <Field label="Mã vạch">
              <input value={form.ma_vach} onChange={(e) => set("ma_vach", e.target.value)} />
            </Field>
            <Field label="Mã thùng">
              <input value={form.ma_thung} onChange={(e) => set("ma_thung", e.target.value)} />
            </Field>
            <Field label="Mã nhóm thay thế">
              <input value={form.ma_nhom_thay_the} onChange={(e) => set("ma_nhom_thay_the", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="field-group">
          <h3>Kênh bán &amp; khác</h3>
          <div className="field-grid">
            <Field label="Trạng thái">
              <input value={form.trang_thai} onChange={(e) => set("trang_thai", e.target.value)} />
            </Field>
            <Field label="Xuất xứ">
              <input value={form.xuat_xu} onChange={(e) => set("xuat_xu", e.target.value)} />
            </Field>
            <Field label="Tên sàn Shopee">
              <input value={form.ten_shopee} onChange={(e) => set("ten_shopee", e.target.value)} />
            </Field>
            <Field label="Tên sàn TikTok Shop">
              <input value={form.ten_tiktok} onChange={(e) => set("ten_tiktok", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Hủy
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Đang lưu..." : "Lưu sản phẩm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
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

function relativeTimeVi(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} tháng trước`;
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function SheetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 4v16" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
