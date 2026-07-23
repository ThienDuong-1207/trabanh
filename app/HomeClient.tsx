"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  Product,
  ProductInput,
  PriceChangeRequest,
  Profile,
  ActivityLogEntry,
  Notification,
  CATEGORY_ORDER,
} from "@/lib/types";
import { QUY_CACH_SUGGESTIONS, TY_LE_SUGGESTIONS, DVT_SUGGESTIONS, extractQuantityFromQuyCach } from "@/lib/suggestionLists";
import { ACTION_LABELS } from "@/lib/activityLabels";
import PasswordChecklist from "@/components/PasswordChecklist";

type View = "hanghoa" | "tonkho" | "baocao" | "duyetgia" | "users" | "activitylog";
export type Role = "sales" | "accountant" | "admin";

// Tạm ẩn nav "Quản lý tồn kho" theo yêu cầu — đổi thành true để hiện lại.
const SHOW_INVENTORY_NAV = false;

const ROLE_LABEL: Record<Role, string> = {
  sales: "Sales",
  accountant: "Kế toán",
  admin: "Admin",
};

export default function HomeClient({ displayName, role, userId }: { displayName: string; role: Role; userId: string }) {
  const [activeView, setActiveView] = useState<View>("hanghoa");
  const [products, setProducts] = useState<Product[]>([]);
  const [brandNames, setBrandNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Tất cả");
  const [brandFilter, setBrandFilter] = useState<string>("Tất cả");
  const [missingOnly, setMissingOnly] = useState(false);
  const [compactView, setCompactView] = useState(false);
  const [tab, setTab] = useState<"all" | "pending" | "draft">("all");
  const [priceRequests, setPriceRequests] = useState<PriceChangeRequest[]>([]);
  const [priceHistoryRefreshToken, setPriceHistoryRefreshToken] = useState(0);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [completeDraftTarget, setCompleteDraftTarget] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<"misa" | "word" | "misa-update" | "vertical" | null>(null);
  const [exportingRollLabel, setExportingRollLabel] = useState(false);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [exportingQuote, setExportingQuote] = useState(false);
  const [exportingAll, setExportingAll] = useState<"category" | "brand" | "word" | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importOnlyNew, setImportOnlyNew] = useState(false);
  const [formTarget, setFormTarget] = useState<Product | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const loadProducts = useCallback(async () => {
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
  }, []);

  const loadBrandNames = useCallback(async () => {
    const { data, error } = await supabase.from("brands").select("name").order("name");
    if (!error) setBrandNames((data ?? []).map((b) => b.name as string));
  }, []);

  // RLS already scopes this per role (Giai đoạn 2): sales only sees their own
  // requests, kế toán/admin sees everyone's — so no client-side filtering by
  // "who can see what" is needed here.
  // Chỉ tải các đề xuất đang "pending" — đây là hàng chờ xử lý thực sự nên
  // luôn nhỏ (được duyệt/từ chối là biến mất khỏi tập này ngay). Lịch sử
  // approved/rejected (tăng dần không giới hạn theo thời gian) được tách
  // riêng, tự tải + phân trang bên trong PriceRequestsView.
  const loadPriceRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from("price_change_requests")
      .select(
        "*, product:products(ten_hang_hoa, ma_noi_bo, gia_ban, gia_thung), proposer:profiles!price_change_requests_proposed_by_fkey(display_name, username)"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (!error) setPriceRequests((data ?? []) as PriceChangeRequest[]);
  }, []);

  useEffect(() => {
    loadProducts();
    loadBrandNames();
    loadPriceRequests();
  }, []);

  // Gõ được mượt ngay lập tức trong ô tìm kiếm, nhưng chỉ lọc lại danh sách
  // (và re-render toàn bộ bảng) sau khi người dùng ngừng gõ ~280ms.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 280);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenuOpen(false);
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

  // Everything except the tab (Tất cả / Chờ xuất file) filter — used both to
  // build `visible` and to count each tab accurately for the CURRENT
  // category/brand/search filters, instead of showing a raw whole-catalog
  // count that doesn't match what the tab actually shows once other filters
  // are active.
  const filteredByCriteria = useMemo(() => {
    let list = products;
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
  }, [products, category, brandFilter, missingOnly, search]);

  const visible = useMemo(() => {
    if (tab === "pending") return filteredByCriteria.filter((p) => pendingIds.has(p.id));
    if (tab === "draft") return filteredByCriteria.filter((p) => p.is_draft);
    return filteredByCriteria;
  }, [filteredByCriteria, tab, pendingIds]);

  // Phân trang bảng sản phẩm — catalog có thể lên tới hàng trăm/nghìn dòng,
  // render hết 1 lần vừa chậm vừa không cần thiết khi chỉ xem/sửa 1 khu vực.
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [tab, category, brandFilter, missingOnly, search]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedVisible = useMemo(
    () => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [visible, currentPage]
  );

  const draftInFilter = useMemo(() => filteredByCriteria.filter((p) => p.is_draft).length, [filteredByCriteria]);

  // Only ever one meaningful "pending" request per product in practice — if
  // more than one somehow exists, the most recent wins (price_requests is
  // already ordered newest-first by loadPriceRequests).
  const pendingRequestByProduct = useMemo(() => {
    const map = new Map<string, PriceChangeRequest>();
    for (const r of priceRequests) {
      if (r.status === "pending" && !map.has(r.product_id)) map.set(r.product_id, r);
    }
    return map;
  }, [priceRequests]);

  const pendingInFilter = useMemo(
    () => filteredByCriteria.filter((p) => pendingIds.has(p.id)).length,
    [filteredByCriteria, pendingIds]
  );

  // Products picked earlier (e.g. a whole different category) that the
  // current filter/tab no longer shows — kept visible below `visible` instead
  // of disappearing, so a multi-category selection stays reviewable while
  // browsing to add more.
  const selectedElsewhere = useMemo(() => {
    const visibleIds = new Set(pagedVisible.map((p) => p.id));
    return products.filter((p) => selected.has(p.id) && !visibleIds.has(p.id));
  }, [products, selected, pagedVisible]);

  // Mọi role gõ thẳng vào ô giá — nhưng không ai ghi thẳng vào products nữa,
  // chỉ tạo/cập nhật 1 đề xuất giá; giá thật chỉ đổi khi Kế toán/Admin duyệt
  // (kể cả tự duyệt đề xuất của chính mình).
  const proposePrice = useCallback(
    async (p: Product, field: "gia_ban" | "gia_thung", value: string) => {
      const num = value.trim() === "" ? null : Number(value.replace(/[^\d]/g, ""));
      if (value.trim() !== "" && (num === null || Number.isNaN(num))) {
        alert("Giá không hợp lệ");
        return;
      }
      setSavingId(p.id);
      try {
        const res = await fetch("/api/price-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: p.id, field, value: num }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gửi đề xuất thất bại");
        await loadPriceRequests();
      } catch (e: any) {
        alert("Gửi đề xuất thất bại: " + e.message);
      } finally {
        setSavingId(null);
      }
    },
    [loadPriceRequests]
  );

  // Sửa nhanh các cột khác ngoài giá (Tên hàng hóa, Nhóm hàng, Mã nội bộ,
  // ĐVT, Quy cách, Tỷ lệ, Thương hiệu, Mã vạch, Mã thùng, Tên hóa đơn) — ghi
  // thẳng DB ngay, không qua đề xuất/duyệt; quyền theo từng trường được
  // chặn ở API (app/api/products/[id]/field/route.ts).
  const updateProductField = useCallback(
    async (p: Product, field: string, value: string | number | null) => {
      setSavingId(p.id);
      try {
        const res = await fetch(`/api/products/${p.id}/field`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lưu thất bại");
        setProducts((prev) => prev.map((x) => (x.id === p.id ? data : x)));
        if (field === "brand") await loadBrandNames();
      } catch (e: any) {
        alert("Lưu thất bại: " + e.message);
      } finally {
        setSavingId(null);
      }
    },
    [loadBrandNames]
  );

  async function reviewPriceRequest(id: string, action: "approve" | "reject") {
    if (action === "reject" && !confirm("Từ chối đề xuất giá này?")) return;
    setReviewingRequestId(id);
    try {
      const res = await fetch(`/api/price-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xử lý thất bại");
      await Promise.all([loadPriceRequests(), action === "approve" ? loadProducts() : Promise.resolve()]);
      setPriceHistoryRefreshToken((v) => v + 1);
    } catch (e: any) {
      alert("Xử lý đề xuất thất bại: " + e.message);
    } finally {
      setReviewingRequestId(null);
    }
  }

  async function approveAllPriceRequests() {
    if (!confirm("Duyệt toàn bộ đề xuất giá đang chờ? Không thể hoàn tác.")) return;
    setApprovingAll(true);
    try {
      const res = await fetch("/api/price-requests/approve-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Duyệt tất cả thất bại");
      await Promise.all([loadPriceRequests(), loadProducts()]);
      setPriceHistoryRefreshToken((v) => v + 1);
    } catch (e: any) {
      alert("Duyệt tất cả thất bại: " + e.message);
    } finally {
      setApprovingAll(false);
    }
  }

  async function submitCompleteDraft(fields: {
    ma_noi_bo: string;
    ten_hoa_don: string;
    quy_cach: string;
    dvt: string;
    ty_le: string;
    brand: string;
  }) {
    if (!completeDraftTarget) return;
    try {
      const res = await fetch(`/api/products/${completeDraftTarget.id}/complete-draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ma_noi_bo: fields.ma_noi_bo,
          ten_hoa_don: fields.ten_hoa_don || null,
          quy_cach: fields.quy_cach || null,
          dvt: fields.dvt || null,
          ty_le: fields.ty_le ? Number(fields.ty_le) : null,
          brand: fields.brand || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Hoàn thiện sản phẩm thất bại");
      setCompleteDraftTarget(null);
      await loadProducts();
    } catch (e: any) {
      alert("Hoàn thiện sản phẩm thất bại: " + e.message);
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Additive on purpose: lets a user pick all of one category's products,
  // switch the category filter, then "chọn tất cả đang hiện" again to add the
  // next category on top — building up one combined selection (e.g. for a
  // multi-category báo giá) instead of each click replacing the last one.
  function selectAllVisible() {
    setSelected((prev) => new Set([...prev, ...visible.map((p) => p.id)]));
  }

  async function doExport(kind: "misa" | "word" | "misa-update" | "vertical") {
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
      const filenames = {
        misa: "MISA_Import_Update.xlsx",
        word: "Bang_gia_block_7.7x4cm_Update.docx",
        "misa-update": "MISA_Cap_nhat_thong_tin.xlsx",
        vertical: "Bang_gia_dung.pdf",
      };
      downloadBlob(blob, filenames[kind]);

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

  // Single-tag-per-page 5x3cm label for roll label printers (iPOS IP3350...).
  // Products without a mã vạch get one minted server-side and saved back —
  // marks last_exported_at same as doExport(), since this prints the price.
  async function doExportRollLabel() {
    if (selected.size === 0) {
      alert("Chọn ít nhất 1 sản phẩm để xuất file.");
      return;
    }
    setExportingRollLabel(true);
    try {
      const res = await fetch("/api/export-roll-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || (await res.text()));
      }
      const blob = await res.blob();
      downloadBlob(blob, "Tem_cuon_5x3cm.docx");

      const now = new Date().toISOString();
      const { error } = await supabase.from("products").update({ last_exported_at: now }).in("id", Array.from(selected));
      if (error) throw error;
      await loadProducts();
      setSelected(new Set());
    } catch (e: any) {
      alert("Xuất file thất bại: " + e.message);
    } finally {
      setExportingRollLabel(false);
    }
  }

  async function doExportQuote(fields: QuoteFormFields) {
    setExportingQuote(true);
    try {
      const res = await fetch("/api/export-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), ...fields }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || (await res.text()));
      }
      const blob = await res.blob();
      const dateStr = (fields.date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
      downloadBlob(blob, `Bao_gia_${dateStr}.pdf`);
      setQuoteModalOpen(false);
    } catch (e: any) {
      alert("Xuất báo giá thất bại: " + e.message);
    } finally {
      setExportingQuote(false);
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

  async function handleDeleteSelectedProducts() {
    if (selected.size === 0) {
      alert("Chọn ít nhất 1 sản phẩm để xóa.");
      return;
    }
    if (!confirm(`Xóa ${selected.size} sản phẩm đã chọn? Không thể hoàn tác.`)) return;
    setDeletingSelected(true);
    try {
      const results = await Promise.all(
        Array.from(selected).map(async (id) => {
          const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
          return { id, ok: res.ok };
        })
      );
      const failed = results.filter((r) => !r.ok).length;
      await loadProducts();
      setSelected(new Set());
      if (failed > 0) alert(`Xóa thất bại ${failed}/${results.length} sản phẩm.`);
    } catch (e: any) {
      alert("Xóa thất bại: " + e.message);
    } finally {
      setDeletingSelected(false);
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
      form.append("mode", importOnlyNew ? "new-only" : "update-all");
      const res = await fetch("/api/import-products", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nhập file thất bại");
      const skipped = data.skippedSheets?.length ? ` (bỏ qua sheet: ${data.skippedSheets.join(", ")})` : "";
      const summary = importOnlyNew
        ? `Đã thêm ${data.newCount} sản phẩm mới. ${data.existingCount} sản phẩm đã tồn tại (giữ nguyên, không thay đổi).`
        : `Đã cập nhật ${data.existingCount} sản phẩm đã có và thêm ${data.newCount} sản phẩm mới.`;
      alert(`${summary} ${data.brandsUpserted} thương hiệu.${skipped}`);
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
    if (!formTarget) return;
    try {
      const res = await fetch(`/api/products/${formTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lưu thất bại");
      setFormTarget(null);
      await loadProducts();
      await loadBrandNames();
    } catch (e: any) {
      alert("Lưu sản phẩm thất bại: " + e.message);
    }
  }

  // Thêm sản phẩm bằng dòng trống ở cuối bảng (kiểu Excel) — khác
  // handleSaveProduct ở chỗ không rời tab/không chọn sẵn sản phẩm, để có thể
  // gõ liên tiếp nhiều dòng mà không bị nhảy màn hình sau mỗi lần lưu.
  async function handleCreateProductInline(input: ProductInput): Promise<boolean> {
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Thêm sản phẩm thất bại");
      await loadProducts();
      await loadBrandNames();
      return true;
    } catch (e: any) {
      alert("Thêm sản phẩm thất bại: " + e.message);
      return false;
    }
  }

  const handleDeleteProduct = useCallback(
    async (p: Product) => {
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
    },
    [loadProducts]
  );

  function renderRow(p: Product, extraClassName?: string) {
    return (
      <ProductRow
        key={p.id}
        product={p}
        extraClassName={extraClassName}
        role={role}
        compactView={compactView}
        brandNames={brandNames}
        isSelected={selected.has(p.id)}
        isPending={pendingIds.has(p.id)}
        pendingRequest={pendingRequestByProduct.get(p.id)}
        isSaving={savingId === p.id}
        onToggleSelect={toggleSelect}
        onUpdateField={updateProductField}
        onProposePrice={proposePrice}
        onEdit={setFormTarget}
        onDelete={handleDeleteProduct}
        onCompleteDraft={setCompleteDraftTarget}
      />
    );
  }

  return (
    <div className="shell">
      <Sidebar
        activeView={activeView}
        onChange={setActiveView}
        pendingCount={pendingIds.size}
        priceRequestCount={priceRequests.filter((r) => r.status === "pending").length}
        displayName={displayName}
        role={role}
      />
      <main className="main">
        {activeView === "hanghoa" && (
    <div className="app app-full">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Quản lý giá sản phẩm — Tiệm Trà Bánh</h1>
          <NotificationBell userId={userId} onNavigate={setActiveView} />
        </div>
        <div className="stat-kpis">
          <div className="stat-kpi">
            <div className="stat-kpi-label">Tổng sản phẩm</div>
            <div className="stat-kpi-value">{products.length}</div>
          </div>
          <div className="stat-kpi stat-kpi-warm">
            <div className="stat-kpi-label">Chờ xuất</div>
            <div className="stat-kpi-value">{pendingIds.size}</div>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <SearchIcon />
          <input placeholder="Tìm theo tên / mã / mã vạch..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
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
        <label className="toggle-pill toggle-pill-warm">
          <input type="checkbox" checked={compactView} onChange={(e) => setCompactView(e.target.checked)} />
          Update giá
        </label>

        <div className="toolbar-spacer" />

        <div className="menu-wrap" ref={moreMenuRef}>
          <button className="btn" onClick={() => setMoreMenuOpen((v) => !v)} disabled={importing || exportingAll !== null}>
            {importing || exportingAll !== null ? "Đang xử lý..." : "Nhập & xuất"}
            <ChevronDownIcon />
          </button>
          {moreMenuOpen && (
            <div className="menu">
              <button className="menu-item-accent" onClick={() => fileInputRef.current?.click()}>
                <ImportIcon />
                Nhập từ Excel
              </button>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 10px 4px",
                  fontSize: 12.5,
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={importOnlyNew}
                  onChange={(e) => setImportOnlyNew(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  Chỉ thêm sản phẩm mới (giữ nguyên sản phẩm đã có)
                  <br />
                  <span style={{ fontSize: 11.5 }}>
                    {importOnlyNew
                      ? "Bỏ tick để cập nhật giá/tên/mã vạch... của sản phẩm đã có theo file."
                      : "Sẽ cập nhật mọi thông tin theo file. Riêng Mã nội bộ không bao giờ bị đổi qua import — chỉ sửa được bằng tay."}
                  </span>
                </span>
              </label>
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
              Tất cả ({filteredByCriteria.length})
            </button>
            <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>
              Chờ xuất file ({pendingInFilter})
            </button>
            <button className={tab === "draft" ? "active" : ""} onClick={() => setTab("draft")}>
              Chưa hoàn chỉnh ({draftInFilter})
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
            <div className="menu-wrap" ref={exportMenuRef}>
              <button
                className="btn btn-primary"
                disabled={exporting !== null || exportingRollLabel}
                onClick={() => setExportMenuOpen((v) => !v)}
              >
                {exporting !== null || exportingRollLabel ? "Đang xuất..." : "Xuất file"}
                <ChevronDownIcon />
              </button>
              {exportMenuOpen && (
                <div className="menu">
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      doExport("misa");
                    }}
                  >
                    <SheetIcon />
                    Xuất MISA (.xlsx)
                  </button>
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      doExport("misa-update");
                    }}
                  >
                    <SheetIcon />
                    Xuất cập nhật MISA
                  </button>
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      doExport("word");
                    }}
                  >
                    <DocIcon />
                    Block giá 7.7x4cm
                  </button>
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      doExport("vertical");
                    }}
                  >
                    <DocIcon />
                    Bảng giá đứng
                  </button>
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      setQuoteModalOpen(true);
                    }}
                  >
                    <QuoteIcon />
                    Xuất báo giá (PDF)
                  </button>
                  <button
                    onClick={() => {
                      setExportMenuOpen(false);
                      doExportRollLabel();
                    }}
                  >
                    <SheetIcon />
                    Xuất tem cuộn 5x3cm
                  </button>
                </div>
              )}
            </div>
            {tab === "pending" && (
              <button className="btn btn-danger" disabled={dismissing} onClick={dismissPending}>
                {dismissing ? "Đang xử lý..." : "Bỏ chờ xuất file"}
              </button>
            )}
            {role === "admin" && (
              <button className="btn btn-danger" disabled={deletingSelected} onClick={handleDeleteSelectedProducts}>
                {deletingSelected ? "Đang xóa..." : "Xóa tất cả"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table className={`product-table${compactView ? " product-table-compact" : ""}`}>
            <thead>
              <tr>
                <th className="col-check"></th>
                <th className="col-name">Tên hàng hóa</th>
                {!compactView && <th className="col-group">Nhóm hàng</th>}
                {!compactView && <th className="col-code">Mã nội bộ</th>}
                {!compactView && <th className="col-invoice">Tên hóa đơn</th>}
                {!compactView && <th className="col-dvt">ĐVT</th>}
                <th className="num">Giá bán lẻ</th>
                <th className="num">Giá thùng</th>
                {!compactView && <th className="col-spec">Quy cách thùng</th>}
                {!compactView && <th className="num">Tỷ lệ quy đổi</th>}
                {!compactView && <th className="col-brand">Thương hiệu</th>}
                {!compactView && <th className="col-code">Mã vạch</th>}
                {!compactView && <th className="col-code">Mã thùng</th>}
                {!compactView && <th className="col-status">Trạng thái</th>}
                {!compactView && <th style={{ width: 120 }}></th>}
              </tr>
            </thead>
            <tbody>
              {tab === "all" && (role === "sales" || role === "admin") && (
                <NewProductRow
                  role={role}
                  compactView={compactView}
                  brandNames={brandNames}
                  categoryFilter={category}
                  onCreate={handleCreateProductInline}
                />
              )}
              {loading && (
                <tr>
                  <td colSpan={15} className="loading-state">
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={15} className="empty-state">
                    Không có sản phẩm nào.
                  </td>
                </tr>
              )}
              {pagedVisible.map((p) => renderRow(p))}
              {selectedElsewhere.length > 0 && (
                <tr className="section-divider-row">
                  <td colSpan={15} className="section-divider">
                    Đã chọn ở bộ lọc khác ({selectedElsewhere.length})
                  </td>
                </tr>
              )}
              {selectedElsewhere.map((p) => renderRow(p, "is-selected-elsewhere"))}
            </tbody>
          </table>
        </div>
      </div>

      {pageCount > 1 && (
        <div className="pagination-bar">
          <button className="btn btn-quiet" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
            ← Trước
          </button>
          <span>
            Trang {currentPage}/{pageCount} ({visible.length} sản phẩm)
          </span>
          <button className="btn btn-quiet" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
            Sau →
          </button>
        </div>
      )}

      <p className="helper-text">
        Sửa giá xong tự lưu ngay (không cần bấm nút riêng). Sản phẩm nào vừa đổi giá sẽ tự hiện ở tab &quot;Chờ xuất
        file&quot; — chọn xong bấm xuất MISA hoặc Word, chỉ đúng các sản phẩm đã chọn.
      </p>

      {formTarget !== null && (
        <ProductForm
          initial={formTarget}
          brandNames={brandNames}
          role={role}
          onCancel={() => setFormTarget(null)}
          onSave={handleSaveProduct}
        />
      )}

      {quoteModalOpen && (
        <QuoteForm
          selectedCount={selected.size}
          submitting={exportingQuote}
          onCancel={() => setQuoteModalOpen(false)}
          onSubmit={doExportQuote}
        />
      )}

      {completeDraftTarget && (
        <CompleteDraftForm
          product={completeDraftTarget}
          brandNames={brandNames}
          onCancel={() => setCompleteDraftTarget(null)}
          onSubmit={submitCompleteDraft}
        />
      )}
    </div>
        )}
        {activeView === "tonkho" && <InventoryView />}
        {activeView === "baocao" && <DashboardView products={products} pendingCount={pendingIds.size} />}
        {activeView === "duyetgia" && (
          <PriceRequestsView
            requests={priceRequests}
            role={role}
            reviewingRequestId={reviewingRequestId}
            onReview={reviewPriceRequest}
            approvingAll={approvingAll}
            onApproveAll={approveAllPriceRequests}
            historyRefreshToken={priceHistoryRefreshToken}
          />
        )}
        {activeView === "users" && role === "admin" && <UserManagementView currentUserId={userId} />}
        {activeView === "activitylog" && <ActivityLogView />}
      </main>
    </div>
  );
}

type ProductRowProps = {
  product: Product;
  extraClassName?: string;
  role: Role;
  compactView: boolean;
  brandNames: string[];
  isSelected: boolean;
  isPending: boolean;
  pendingRequest: PriceChangeRequest | undefined;
  isSaving: boolean;
  onToggleSelect: (id: string) => void;
  onUpdateField: (p: Product, field: string, value: string | number | null) => void;
  onProposePrice: (p: Product, field: "gia_ban" | "gia_thung", value: string) => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
  onCompleteDraft: (p: Product) => void;
};

// Bọc React.memo để 1 dòng không re-render khi state không liên quan của
// component cha (search, page, savingId của dòng khác...) thay đổi — mọi
// prop callback truyền vào đây đều ổn định (useCallback / setState) ở nơi gọi.
const ProductRow = memo(function ProductRow({
  product: p,
  extraClassName,
  role,
  compactView,
  brandNames,
  isSelected,
  isPending,
  pendingRequest,
  isSaving,
  onToggleSelect,
  onUpdateField,
  onProposePrice,
  onEdit,
  onDelete,
  onCompleteDraft,
}: ProductRowProps) {
  const className = [isPending ? "is-pending" : "", extraClassName ?? ""].filter(Boolean).join(" ");
  const isAdmin = role === "admin";

  function selectBrand(newValue: string) {
    if (newValue === "__new__") {
      const name = window.prompt("Tên thương hiệu mới:");
      if (name && name.trim()) onUpdateField(p, "brand", name.trim());
      return;
    }
    onUpdateField(p, "brand", newValue);
  }

  return (
    <tr className={className}>
      <td className="col-check">
        <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(p.id)} />
      </td>
      <td className="col-name">
        <InlineTextCell
          value={p.ten_hang_hoa}
          onSave={(v) => onUpdateField(p, "ten_hang_hoa", v)}
          saving={isSaving}
          disabled={!isAdmin}
          title={!isAdmin ? "Chỉ Admin mới đổi được tên hàng hóa" : undefined}
          clickToEdit
        />
        {p.is_draft && <span className="pill pill-warm draft-badge">Nháp</span>}
      </td>
      {!compactView && (
        <td className="col-group">
          {isAdmin ? (
            <select value={p.category_sheet} onChange={(e) => onUpdateField(p, "category_sheet", e.target.value)} disabled={isSaving}>
              {CATEGORY_ORDER.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : (
            p.category_sheet
          )}
        </td>
      )}
      {!compactView && (
        <td className="code-cell col-code">
          <InlineTextCell
            value={p.ma_noi_bo}
            onSave={(v) => onUpdateField(p, "ma_noi_bo", v)}
            saving={isSaving}
            disabled={!isAdmin}
          />
        </td>
      )}
      {!compactView && (
        <td className="col-invoice">
          <InlineTextCell
            value={p.ten_hoa_don}
            onSave={(v) => onUpdateField(p, "ten_hoa_don", v)}
            saving={isSaving}
            disabled={role === "sales"}
          />
        </td>
      )}
      {!compactView && (
        <td className="col-dvt">
          {isAdmin ? (
            <select value={p.dvt ?? ""} onChange={(e) => onUpdateField(p, "dvt", e.target.value)} disabled={isSaving}>
              <option value="">—</option>
              {withCurrent(DVT_SUGGESTIONS, p.dvt ?? "").map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          ) : (
            p.dvt ?? "—"
          )}
        </td>
      )}
      <td className="num">
        <PriceInput
          value={pendingRequest?.proposed_gia_ban != null ? pendingRequest.proposed_gia_ban : p.gia_ban}
          onSave={(v) => onProposePrice(p, "gia_ban", v)}
          saving={isSaving}
        />
      </td>
      <td className="num">
        <PriceInput
          value={pendingRequest?.proposed_gia_thung != null ? pendingRequest.proposed_gia_thung : p.gia_thung}
          onSave={(v) => onProposePrice(p, "gia_thung", v)}
          saving={isSaving}
        />
      </td>
      {!compactView && (
        <td className="col-spec">
          {isAdmin ? (
            <select value={p.quy_cach ?? ""} onChange={(e) => onUpdateField(p, "quy_cach", e.target.value)} disabled={isSaving}>
              <option value="">—</option>
              {withCurrent(QUY_CACH_SUGGESTIONS, p.quy_cach ?? "").map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          ) : (
            p.quy_cach ?? "—"
          )}
        </td>
      )}
      {!compactView && (
        <td className="num">
          {isAdmin ? (
            <select value={p.ty_le?.toString() ?? ""} onChange={(e) => onUpdateField(p, "ty_le", e.target.value)} disabled={isSaving}>
              <option value="">—</option>
              {withCurrent(TY_LE_SUGGESTIONS, p.ty_le?.toString() ?? "").map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          ) : (
            p.ty_le ?? "—"
          )}
        </td>
      )}
      {!compactView && (
        <td className="col-brand">
          {isAdmin ? (
            <select value={brandNames.includes(p.brand?.name ?? "") ? p.brand?.name : ""} onChange={(e) => selectBrand(e.target.value)} disabled={isSaving}>
              <option value="">—</option>
              {brandNames.map((b) => (
                <option key={b}>{b}</option>
              ))}
              <option value="__new__">+ Thương hiệu mới…</option>
            </select>
          ) : (
            p.brand?.name ?? "—"
          )}
        </td>
      )}
      {!compactView && (
        <td className="code-cell col-code">
          <InlineTextCell value={p.ma_vach} onSave={(v) => onUpdateField(p, "ma_vach", v)} saving={isSaving} disabled={!isAdmin} />
        </td>
      )}
      {!compactView && (
        <td className="code-cell col-code">
          <InlineTextCell value={p.ma_thung} onSave={(v) => onUpdateField(p, "ma_thung", v)} saving={isSaving} disabled={!isAdmin} />
        </td>
      )}
      {!compactView && (
        <td className="col-status">
          <StatusPill product={p} isPending={isPending} />
        </td>
      )}
      {!compactView && (
        <td>
          <div className="row-actions">
            {p.is_draft && (role === "accountant" || role === "admin") && (
              <button className="btn btn-quiet" onClick={() => onCompleteDraft(p)}>
                Hoàn thiện
              </button>
            )}
            {role === "admin" && (
              <button className="icon-btn" title="Sửa (Mã nhóm thay thế, Trạng thái, Xuất xứ)" aria-label="Sửa sản phẩm" onClick={() => onEdit(p)}>
                <EditIcon />
              </button>
            )}
            {role === "admin" && (
              <button className="icon-btn danger" title="Xóa" aria-label="Xóa sản phẩm" onClick={() => onDelete(p)}>
                <TrashIcon />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
});

function Sidebar({
  activeView,
  onChange,
  pendingCount,
  priceRequestCount,
  displayName,
  role,
}: {
  activeView: View;
  onChange: (v: View) => void;
  pendingCount: number;
  priceRequestCount: number;
  displayName: string;
  role: Role;
}) {
  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <nav className="sidebar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-logo" src="/templates/logo.png" alt="Trà & Bánh" />
        <div className="brand-text-under">Quản lý sản phẩm</div>
      </div>
      <div className="nav">
        <button className={`nav-item${activeView === "hanghoa" ? " active" : ""}`} onClick={() => onChange("hanghoa")}>
          <TagIcon />
          Quản lý hàng hóa
        </button>
        <button className={`nav-item${activeView === "duyetgia" ? " active" : ""}`} onClick={() => onChange("duyetgia")}>
          <TagIcon />
          Chờ duyệt giá
          {priceRequestCount > 0 && <span className="pill pill-warm badge">{priceRequestCount}</span>}
        </button>
        <button className={`nav-item${activeView === "activitylog" ? " active" : ""}`} onClick={() => onChange("activitylog")}>
          <LogIcon />
          Nhật ký hoạt động
        </button>
        <button className={`nav-item${activeView === "baocao" ? " active" : ""}`} onClick={() => onChange("baocao")}>
          <ChartIcon />
          Báo cáo
          {pendingCount > 0 && <span className="pill pill-warm badge">{pendingCount}</span>}
        </button>
        {role === "admin" && (
          <button className={`nav-item${activeView === "users" ? " active" : ""}`} onClick={() => onChange("users")}>
            <UsersIcon />
            Quản lý người dùng
          </button>
        )}
        {/* Tạm ẩn theo yêu cầu — bật lại bằng cách đổi SHOW_INVENTORY_NAV thành true */}
        {SHOW_INVENTORY_NAV && (
          <button className={`nav-item${activeView === "tonkho" ? " active" : ""}`} onClick={() => onChange("tonkho")}>
            <ArchiveIcon />
            Quản lý tồn kho
          </button>
        )}
      </div>
      <div className="sidebar-foot sidebar-account">
        <div className="sidebar-account-name">{displayName}</div>
        <div className="sidebar-account-role">{ROLE_LABEL[role]}</div>
        <button className="btn btn-quiet sidebar-signout" onClick={signOut}>
          Đăng xuất
        </button>
      </div>
    </nav>
  );
}

function NotificationBell({ userId, onNavigate }: { userId: string; onNavigate: (v: View) => void }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) setNotifications((data as Notification[]) ?? []);
    }
    load();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  async function markRead(n: Notification) {
    if (!n.read_at) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    }
    setOpen(false);
    if (n.link_view) onNavigate(n.link_view as View);
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).eq("recipient_id", userId).is("read_at", null);
  }

  return (
    <div className="notification-bell">
      <button className="notification-bell-trigger" onClick={() => setOpen((v) => !v)} aria-label="Thông báo">
        <BellIcon />
        {unreadCount > 0 && <span className="pill pill-danger badge notification-badge">{unreadCount}</span>}
      </button>
      {open && (
        <>
          <div className="notification-backdrop" onClick={() => setOpen(false)} />
          <div className="notification-panel">
            <div className="notification-panel-head">
              <span>Thông báo</span>
              {unreadCount > 0 && (
                <button className="btn btn-quiet" onClick={markAllRead}>
                  Đánh dấu tất cả đã đọc
                </button>
              )}
            </div>
            <div className="notification-list">
              {notifications.length === 0 && <div className="notification-empty">Chưa có thông báo nào.</div>}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  className={`notification-item${n.read_at ? "" : " unread"}`}
                  onClick={() => markRead(n)}
                >
                  <div className="notification-message">{n.message}</div>
                  <div className="notification-time">{relativeTimeVi(n.created_at)}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardView({ products, pendingCount }: { products: Product[]; pendingCount: number }) {
  const totalValue = products.reduce((sum, p) => sum + (p.gia_ban ?? 0), 0);
  const missingPrice = products.filter((p) => !p.gia_ban).length;

  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.category_sheet, (counts.get(p.category_sheet) ?? 0) + 1);
    return CATEGORY_ORDER.map((c) => ({ name: c, count: counts.get(c) ?? 0 })).sort((a, b) => b.count - a.count);
  }, [products]);
  const maxCount = Math.max(1, ...byCategory.map((c) => c.count));

  const recent = useMemo(
    () => [...products].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 8),
    [products]
  );

  return (
    <div className="app">
      <div className="view-header">
        <div>
          <h1>Báo cáo</h1>
          <p>Tổng quan nhanh về danh mục sản phẩm và tình trạng đồng bộ.</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Tổng sản phẩm</div>
          <div className="value">{products.length}</div>
          <div className="delta">{byCategory.filter((c) => c.count > 0).length} nhóm hàng</div>
        </div>
        <div className="kpi-card">
          <div className="label">Giá trị bán lẻ ước tính</div>
          <div className="value">{totalValue.toLocaleString("vi-VN")} ₫</div>
        </div>
        <div className="kpi-card">
          <div className="label">Chờ xuất file</div>
          <div className="value accent">{pendingCount}</div>
          <div className="delta warm">cần đồng bộ MISA</div>
        </div>
        <div className="kpi-card">
          <div className="label">Thiếu giá bán lẻ</div>
          <div className="value accent">{missingPrice}</div>
        </div>
      </div>

      <div className="panels">
        <div className="panel">
          <h3>Sản phẩm theo nhóm hàng</h3>
          {byCategory.map((c) => (
            <div className="bar-row" key={c.name}>
              <div className="cat-name">{c.name}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(c.count / maxCount) * 100}%` }} />
              </div>
              <div className="n">{c.count}</div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Cập nhật gần đây</h3>
          {recent.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12.5 }}>Chưa có dữ liệu.</p>}
          {recent.map((p) => (
            <div className="activity-row" key={p.id}>
              <div className="activity-dot" />
              <div>
                {p.ten_hang_hoa}
                <div className="t">{relativeTimeVi(p.updated_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PRICE_HISTORY_PAGE_SIZE = 100;

function PriceRequestsView({
  requests,
  role,
  reviewingRequestId,
  onReview,
  approvingAll,
  onApproveAll,
  historyRefreshToken,
}: {
  requests: PriceChangeRequest[];
  role: Role;
  reviewingRequestId: string | null;
  onReview: (id: string, action: "approve" | "reject") => void;
  approvingAll: boolean;
  onApproveAll: () => void;
  historyRefreshToken: number;
}) {
  const canReview = role === "accountant" || role === "admin";
  const pending = useMemo(
    () => [...requests].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [requests]
  );
  const pendingCount = pending.length;
  const pendingColCount = canReview ? 9 : 8;

  // "Chờ duyệt" (requests prop) luôn nhỏ nên không cần phân trang — chỉ
  // approved/rejected mới tự phình theo thời gian, nên phần lịch sử tự tải
  // riêng, theo trang, có "Xem thêm".
  const [history, setHistory] = useState<PriceChangeRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);

  const loadHistoryPage = useCallback(async (offset: number, replace: boolean) => {
    if (replace) setHistoryLoading(true);
    else setHistoryLoadingMore(true);
    const { data, error } = await supabase
      .from("price_change_requests")
      .select(
        "*, product:products(ten_hang_hoa, ma_noi_bo, gia_ban, gia_thung), proposer:profiles!price_change_requests_proposed_by_fkey(display_name, username)"
      )
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .range(offset, offset + PRICE_HISTORY_PAGE_SIZE - 1);
    if (!error) {
      const rows = (data ?? []) as PriceChangeRequest[];
      setHistory((prev) => (replace ? rows : [...prev, ...rows]));
      setHistoryHasMore(rows.length === PRICE_HISTORY_PAGE_SIZE);
    }
    if (replace) setHistoryLoading(false);
    else setHistoryLoadingMore(false);
  }, []);

  useEffect(() => {
    loadHistoryPage(0, true);
  }, [historyRefreshToken, loadHistoryPage]);

  return (
    <div className="app">
      <div className="view-header">
        <div>
          <h1>Chờ duyệt giá</h1>
          <p>{canReview ? "Đề xuất giá từ mọi người, chờ Kế toán/Admin duyệt." : "Đề xuất giá bạn đã gửi và trạng thái xử lý."}</p>
        </div>
        {canReview && pendingCount > 0 && (
          <button className="btn btn-primary" disabled={approvingAll} onClick={onApproveAll}>
            {approvingAll ? "Đang duyệt..." : `Duyệt tất cả (${pendingCount})`}
          </button>
        )}
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tên sản phẩm</th>
                <th>Mã sản phẩm</th>
                <th className="num">Giá lẻ cũ</th>
                <th className="num">Giá lẻ mới</th>
                <th className="num">Giá thùng cũ</th>
                <th className="num">Giá thùng mới</th>
                <th>Người đề xuất</th>
                <th>Thời điểm</th>
                {canReview && <th style={{ width: 140 }}></th>}
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr>
                  <td colSpan={pendingColCount} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Không có đề xuất nào đang chờ.
                  </td>
                </tr>
              )}
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className="col-name">{r.product?.ten_hang_hoa ?? "(sản phẩm đã xóa)"}</td>
                  <td className="code-cell">{r.product?.ma_noi_bo}</td>
                  <td className="num">{formatVnd(r.product?.gia_ban)}</td>
                  <td className="num">{r.proposed_gia_ban != null ? formatVnd(r.proposed_gia_ban) : "—"}</td>
                  <td className="num">{formatVnd(r.product?.gia_thung)}</td>
                  <td className="num">{r.proposed_gia_thung != null ? formatVnd(r.proposed_gia_thung) : "—"}</td>
                  <td>{r.proposer?.display_name ?? r.proposer?.username ?? "—"}</td>
                  <td>{formatDate(r.created_at)}</td>
                  {canReview && (
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn-quiet"
                          disabled={reviewingRequestId === r.id}
                          onClick={() => onReview(r.id, "approve")}
                        >
                          Duyệt
                        </button>
                        <button
                          className="btn btn-quiet"
                          disabled={reviewingRequestId === r.id}
                          onClick={() => onReview(r.id, "reject")}
                        >
                          Từ chối
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="view-header" style={{ marginTop: 28 }}>
        <div>
          <h1>Lịch sử duyệt giá</h1>
          <p>Các đề xuất đã được duyệt hoặc từ chối trước đây.</p>
        </div>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tên sản phẩm</th>
                <th>Mã sản phẩm</th>
                <th className="num">Giá lẻ cũ</th>
                <th className="num">Giá lẻ mới</th>
                <th className="num">Giá thùng cũ</th>
                <th className="num">Giá thùng mới</th>
                <th>Người đề xuất</th>
                <th>Thời điểm</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!historyLoading && history.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Chưa có lịch sử duyệt giá nào.
                  </td>
                </tr>
              )}
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="col-name">{r.product?.ten_hang_hoa ?? "(sản phẩm đã xóa)"}</td>
                  <td className="code-cell">{r.product?.ma_noi_bo}</td>
                  <td className="num">{formatVnd(r.product?.gia_ban)}</td>
                  <td className="num">{r.proposed_gia_ban != null ? formatVnd(r.proposed_gia_ban) : "—"}</td>
                  <td className="num">{formatVnd(r.product?.gia_thung)}</td>
                  <td className="num">{r.proposed_gia_thung != null ? formatVnd(r.proposed_gia_thung) : "—"}</td>
                  <td>{r.proposer?.display_name ?? r.proposer?.username ?? "—"}</td>
                  <td>{formatDate(r.created_at)}</td>
                  <td>
                    {r.status === "approved" && <span className="pill pill-success">Đã duyệt</span>}
                    {r.status === "rejected" && <span className="pill pill-danger">Đã từ chối</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {historyHasMore && !historyLoading && (
        <div className="pagination-bar">
          <button className="btn btn-quiet" disabled={historyLoadingMore} onClick={() => loadHistoryPage(history.length, false)}>
            {historyLoadingMore ? "Đang tải..." : "Xem thêm"}
          </button>
        </div>
      )}
    </div>
  );
}

function generateTempPassword(): string {
  const specials = "!@#$%^&*";
  const letters = "abcdefghijkmnpqrstuvwxyz";
  const rand = (s: string) => s[Math.floor(Math.random() * s.length)];
  let body = "";
  for (let i = 0; i < 5; i++) body += rand(letters);
  return (
    letters[Math.floor(Math.random() * letters.length)].toUpperCase() +
    body +
    Math.floor(10 + Math.random() * 90) +
    rand(specials)
  );
}

function UserManagementView({ currentUserId }: { currentUserId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newRole, setNewRole] = useState<Role>("sales");
  const [tempPassword, setTempPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  async function loadProfiles() {
    setLoading(true);
    const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, display_name: displayName, role: newRole, temp_password: tempPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tạo tài khoản thất bại");
      setUsername("");
      setDisplayName("");
      setTempPassword("");
      setNewRole("sales");
      await loadProfiles();
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(p: Profile, role: Role) {
    if (role === p.role) return;
    setChangingRoleId(p.id);
    try {
      const res = await fetch(`/api/users/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Đổi vai trò thất bại");
      await loadProfiles();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setChangingRoleId(null);
    }
  }

  async function deleteUser(p: Profile) {
    if (!confirm(`Xóa tài khoản "${p.username ?? p.display_name}"? Không thể hoàn tác.`)) return;
    try {
      const res = await fetch(`/api/users/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xóa tài khoản thất bại");
      await loadProfiles();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetting(true);
    try {
      const res = await fetch(`/api/users/${resetTarget.id}/reset-password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp_password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Đặt lại mật khẩu thất bại");
      setResetTarget(null);
      setResetPassword("");
      await loadProfiles();
    } catch (e: any) {
      setResetError(e.message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="app">
      <div className="view-header">
        <div>
          <h1>Quản lý người dùng</h1>
          <p>Tạo tài khoản đăng nhập bằng mật khẩu cho nhân sự không dùng Google.</p>
        </div>
      </div>

      <div className="field-group">
        <h3>Tạo tài khoản mới</h3>
        <form className="field-grid" onSubmit={submitCreate}>
          <Field label="Tên đăng nhập">
            <input
              placeholder="vd: hung"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Tên hiển thị">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Vai trò">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {(["sales", "accountant", "admin"] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mật khẩu tạm">
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ flex: 1 }}
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
              />
              <button type="button" className="btn btn-quiet" onClick={() => setTempPassword(generateTempPassword())}>
                Tạo ngẫu nhiên
              </button>
            </div>
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <PasswordChecklist password={tempPassword} />
          </div>
          {createError && (
            <p className="login-error" style={{ gridColumn: "1 / -1" }}>
              {createError}
            </p>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? "Đang tạo..." : "Tạo tài khoản"}
            </button>
          </div>
        </form>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Tên hiển thị</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading &&
                profiles.map((p) => (
                  <tr key={p.id}>
                    <td className="name-cell">
                      {p.username ?? p.email}
                      {!p.username && <span className="sub">Google</span>}
                    </td>
                    <td>{p.display_name ?? "—"}</td>
                    <td>
                      {p.id === currentUserId ? (
                        ROLE_LABEL[p.role ?? "admin"]
                      ) : (
                        <select
                          value={p.role ?? ""}
                          disabled={changingRoleId === p.id}
                          onChange={(e) => changeRole(p, e.target.value as Role)}
                        >
                          {!p.role && <option value="">Chưa cấp quyền</option>}
                          {(["sales", "accountant", "admin"] as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{p.must_change_password ? "Cần đổi mật khẩu" : "—"}</td>
                    <td>
                      <div className="row-actions">
                        {p.username && (
                          <button className="btn btn-quiet" onClick={() => setResetTarget(p)}>
                            Đặt lại mật khẩu
                          </button>
                        )}
                        {p.id !== currentUserId && (
                          <button className="icon-btn danger" title="Xóa tài khoản" aria-label="Xóa tài khoản" onClick={() => deleteUser(p)}>
                            <TrashIcon />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {resetTarget && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setResetTarget(null)}>
          <div className="modal">
            <h2>Đặt lại mật khẩu</h2>
            <p className="modal-sub">{resetTarget.username}</p>
            <form onSubmit={submitReset}>
              <div className="field-group">
                <Field label="Mật khẩu tạm mới">
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      style={{ flex: 1 }}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                    />
                    <button type="button" className="btn btn-quiet" onClick={() => setResetPassword(generateTempPassword())}>
                      Tạo ngẫu nhiên
                    </button>
                  </div>
                </Field>
                <PasswordChecklist password={resetPassword} />
                {resetError && <p className="login-error">{resetError}</p>}
              </div>
              <div className="modal-actions">
                <button className="btn" type="button" onClick={() => setResetTarget(null)}>
                  Hủy
                </button>
                <button className="btn btn-primary" type="submit" disabled={resetting}>
                  {resetting ? "Đang lưu..." : "Đặt lại"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_PAGE_SIZE = 100;

function ActivityLogView() {
  const [view, setView] = useState<"all" | "price">("all");
  const [expanded, setExpanded] = useState(false);

  // Mỗi tab tự tải + phân trang riêng, thay vì lọc "Lịch sử giá" ra từ 1 danh
  // sách "Tất cả hoạt động" giới hạn cứng 200 dòng như trước — cách cũ khiến
  // các lần duyệt giá cũ hơn dễ bị "đẩy văng" khỏi cửa sổ 200 dòng nếu gần đây
  // có nhiều hoạt động khác (sửa sản phẩm...) chen vào.
  const [allEntries, setAllEntries] = useState<ActivityLogEntry[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allLoadingMore, setAllLoadingMore] = useState(false);
  const [allHasMore, setAllHasMore] = useState(true);

  const [priceEntries, setPriceEntries] = useState<ActivityLogEntry[]>([]);
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceLoadingMore, setPriceLoadingMore] = useState(false);
  const [priceHasMore, setPriceHasMore] = useState(true);

  const loadAllPage = useCallback(async (offset: number, replace: boolean) => {
    if (replace) setAllLoading(true);
    else setAllLoadingMore(true);
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + ACTIVITY_PAGE_SIZE - 1);
    if (!error) {
      const rows = (data as ActivityLogEntry[]) ?? [];
      setAllEntries((prev) => (replace ? rows : [...prev, ...rows]));
      setAllHasMore(rows.length === ACTIVITY_PAGE_SIZE);
    }
    if (replace) setAllLoading(false);
    else setAllLoadingMore(false);
  }, []);

  // "Lịch sử giá" chỉ lấy đúng các lần duyệt (price_request.approve) — đây là
  // hành động duy nhất còn ghi giá thật vào products kể từ khi mọi role đều
  // sửa giá qua đề xuất, không ai ghi thẳng DB nữa. Thay thế hẳn panel
  // "Lịch sử thay đổi giá" trước đây ở Dashboard (nguồn price_history không
  // có tên người thực hiện, còn ở đây thì có).
  const loadPricePage = useCallback(async (offset: number, replace: boolean) => {
    if (replace) setPriceLoading(true);
    else setPriceLoadingMore(true);
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("action", "price_request.approve")
      .order("created_at", { ascending: false })
      .range(offset, offset + ACTIVITY_PAGE_SIZE - 1);
    if (!error) {
      const rows = (data as ActivityLogEntry[]) ?? [];
      setPriceEntries((prev) => (replace ? rows : [...prev, ...rows]));
      setPriceHasMore(rows.length === ACTIVITY_PAGE_SIZE);
    }
    if (replace) setPriceLoading(false);
    else setPriceLoadingMore(false);
  }, []);

  useEffect(() => {
    loadAllPage(0, true);
    loadPricePage(0, true);
  }, [loadAllPage, loadPricePage]);

  const priceColCount = expanded ? 8 : 6;

  return (
    <div className="app">
      <div className="view-header">
        <div>
          <h1>Nhật ký hoạt động</h1>
          <p>Toàn bộ thao tác quan trọng — ai làm gì, lúc nào. Mọi người đã đăng nhập đều xem được.</p>
        </div>
      </div>

      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
          Tất cả hoạt động
        </button>
        <button className={view === "price" ? "active" : ""} onClick={() => setView("price")}>
          Lịch sử giá ({priceEntries.length}
          {priceHasMore ? "+" : ""})
        </button>
      </div>

      {view === "all" && (
        <>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Người thực hiện</th>
                    <th>Hành động</th>
                    <th>Đối tượng</th>
                    <th>Thời điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {allLoading && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
                        Đang tải...
                      </td>
                    </tr>
                  )}
                  {!allLoading && allEntries.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
                        Chưa có hoạt động nào.
                      </td>
                    </tr>
                  )}
                  {allEntries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.actor_name ?? "—"}</td>
                      <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                      <td>{e.target_label ?? "—"}</td>
                      <td>{formatDate(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {allHasMore && !allLoading && (
            <div className="pagination-bar">
              <button className="btn btn-quiet" disabled={allLoadingMore} onClick={() => loadAllPage(allEntries.length, false)}>
                {allLoadingMore ? "Đang tải..." : "Xem thêm"}
              </button>
            </div>
          )}
        </>
      )}

      {view === "price" && (
        <>
          <div className="view-row" style={{ marginTop: 0, justifyContent: "flex-end" }}>
            <button className="btn btn-quiet" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Thu gọn" : "Mở rộng"}
            </button>
          </div>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th className="num">Giá lẻ cũ</th>
                    <th className="num">Giá lẻ mới</th>
                    <th className="num">Giá thùng cũ</th>
                    <th className="num">Giá thùng mới</th>
                    {expanded && <th>Người đề xuất</th>}
                    {expanded && <th>Người duyệt</th>}
                    <th>Thời điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {priceLoading && (
                    <tr>
                      <td colSpan={priceColCount} style={{ textAlign: "center", color: "var(--muted)" }}>
                        Đang tải...
                      </td>
                    </tr>
                  )}
                  {!priceLoading && priceEntries.length === 0 && (
                    <tr>
                      <td colSpan={priceColCount} style={{ textAlign: "center", color: "var(--muted)" }}>
                        Chưa có lịch sử giá nào.
                      </td>
                    </tr>
                  )}
                  {priceEntries.map((e) => {
                    const d = (e.detail ?? {}) as Record<string, number | string | null>;
                    return (
                      <tr key={e.id}>
                        <td className="col-name">{e.target_label ?? "—"}</td>
                        <td className="num">{formatVnd(d.gia_ban_old as number | null)}</td>
                        <td className="num">{formatVnd(d.gia_ban_new as number | null)}</td>
                        <td className="num">{formatVnd(d.gia_thung_old as number | null)}</td>
                        <td className="num">{formatVnd(d.gia_thung_new as number | null)}</td>
                        {expanded && <td>{(d.proposed_by_name as string) ?? "—"}</td>}
                        {expanded && <td>{e.actor_name ?? "—"}</td>}
                        <td>{formatDate(e.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {priceHasMore && !priceLoading && (
            <div className="pagination-bar">
              <button className="btn btn-quiet" disabled={priceLoadingMore} onClick={() => loadPricePage(priceEntries.length, false)}>
                {priceLoadingMore ? "Đang tải..." : "Xem thêm"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InventoryView() {
  return (
    <div className="app">
      <div className="view-header">
        <div>
          <h1>Quản lý tồn kho</h1>
          <p>Theo dõi tồn đầu kỳ / nhập / xuất / tồn cuối kỳ theo từng sản phẩm.</p>
        </div>
      </div>
      <div className="empty-state" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        Chưa có dữ liệu tồn kho trong hệ thống.
        <br />
        Các file MISA xuất-nhập-tồn bạn đang dùng có sẵn cột &quot;Đầu kỳ / Nhập kho / Xuất kho / Cuối kỳ&quot;, nhưng
        database hiện chưa lưu các cột này — cần bổ sung trước khi mục này hiển thị được số liệu thật.
      </div>
    </div>
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

function PriceInput({
  value,
  onSave,
  saving,
}: {
  value: number | null;
  onSave: (v: string) => void;
  saving: boolean;
}) {
  const [local, setLocal] = useState(value?.toString() ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setLocal(value?.toString() ?? "");
  }, [value, focused]);
  return (
    <input
      className="price-input"
      // Shown formatted ("113.000") while at rest, raw digits while being
      // typed — formatting mid-edit would fight the cursor position.
      value={focused ? local : value?.toLocaleString("vi-VN") ?? ""}
      disabled={saving}
      onFocus={() => {
        setFocused(true);
        setLocal(value?.toString() ?? "");
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (local !== (value?.toString() ?? "")) onSave(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// Ô chữ sửa nhanh trực tiếp trong bảng (Tên hàng hóa, Mã nội bộ, Tên hóa
// đơn, Mã vạch, Mã thùng) — cùng cơ chế với PriceInput (bộ đệm gõ riêng +
// lưu khi rời ô), nhưng ghi thẳng DB ngay, không qua đề xuất/duyệt.
//
// `clickToEdit`: dành cho Tên hàng hóa — input 1 dòng không tự xuống dòng
// được dù cột rộng bao nhiêu, nên mặc định hiện dạng chữ thường (xuống dòng
// tự nhiên khi dài), chỉ chuyển thành ô nhập khi bấm vào.
function InlineTextCell({
  value,
  onSave,
  saving,
  placeholder,
  disabled,
  title,
  clickToEdit,
}: {
  value: string | null;
  onSave: (v: string) => void;
  saving: boolean;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  clickToEdit?: boolean;
}) {
  const [local, setLocal] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!focused) setLocal(value ?? "");
  }, [value, focused]);

  if (disabled) return <span title={title}>{value ?? "—"}</span>;

  if (clickToEdit && !editing) {
    return (
      <span
        className="inline-cell-text"
        title={title ?? "Bấm để sửa"}
        onClick={() => {
          setLocal(value ?? "");
          setEditing(true);
        }}
      >
        {value || <span className="inline-cell-placeholder">{placeholder ?? "—"}</span>}
      </span>
    );
  }

  return (
    <input
      className="inline-cell-input"
      autoFocus={clickToEdit}
      value={focused ? local : value ?? ""}
      placeholder={placeholder}
      disabled={saving}
      title={title}
      onFocus={() => {
        setFocused(true);
        setLocal(value ?? "");
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (local !== (value ?? "")) onSave(local);
        if (clickToEdit) setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape" && clickToEdit) {
          setLocal(value ?? "");
          setEditing(false);
        }
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
      <span className="pill pill-warm" title={title}>
        <span className="dot" />
        {product.last_exported_at ? "Vừa sửa giá" : "Mới thêm"}
      </span>
    );
  }
  return (
    <span className="pill pill-success" title={title}>
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
  ma_vach: string;
  ma_thung: string;
  ma_nhom_thay_the: string;
  trang_thai: string;
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
    ma_vach: p?.ma_vach ?? "",
    ma_thung: p?.ma_thung ?? "",
    ma_nhom_thay_the: p?.ma_nhom_thay_the ?? "",
    trang_thai: p?.trang_thai ?? "",
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
    ma_vach: str(f.ma_vach),
    ma_thung: str(f.ma_thung),
    ma_nhom_thay_the: str(f.ma_nhom_thay_the),
    trang_thai: str(f.trang_thai),
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

type QuoteFormFields = {
  customerName: string;
  address: string;
  phone: string;
  note: string;
  date: string; // yyyy-mm-dd
};

function QuoteForm({
  selectedCount,
  submitting,
  onCancel,
  onSubmit,
}: {
  selectedCount: number;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (fields: QuoteFormFields) => void;
}) {
  const [form, setForm] = useState<QuoteFormFields>({
    customerName: "",
    address: "",
    phone: "",
    note: "",
    date: new Date().toISOString().slice(0, 10),
  });

  function set<K extends keyof QuoteFormFields>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h2>Xuất báo giá (PDF)</h2>
        <p className="modal-sub">{selectedCount} sản phẩm đã chọn sẽ đưa vào bảng báo giá.</p>

        <div className="field-group">
          <div className="field-grid">
            <Field label="Khách hàng">
              <input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} />
            </Field>
            <Field label="Địa chỉ">
              <input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Điện thoại">
              <input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Ghi chú">
              <input value={form.note} onChange={(e) => set("note", e.target.value)} />
            </Field>
            <Field label="Ngày báo giá">
              <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={submitting}>
            Hủy
          </button>
          <button className="btn btn-primary" disabled={submitting} onClick={() => onSubmit(form)}>
            {submitting ? "Đang xuất..." : "Xuất PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompleteDraftForm({
  product,
  brandNames,
  onCancel,
  onSubmit,
}: {
  product: Product;
  brandNames: string[];
  onCancel: () => void;
  onSubmit: (fields: {
    ma_noi_bo: string;
    ten_hoa_don: string;
    quy_cach: string;
    dvt: string;
    ty_le: string;
    brand: string;
  }) => Promise<void>;
}) {
  const [maNoiBo, setMaNoiBo] = useState("");
  const [tenHoaDon, setTenHoaDon] = useState("");
  const [quyCach, setQuyCach] = useState("");
  const [dvt, setDvt] = useState("");
  const [tyLe, setTyLe] = useState("");
  const [brand, setBrand] = useState("");
  const [saving, setSaving] = useState(false);

  function handleQuyCach(value: string) {
    const autoTyLe = tyLe.trim() === "" ? extractQuantityFromQuyCach(value) : null;
    setQuyCach(value);
    if (autoTyLe !== null) setTyLe(String(autoTyLe));
  }

  async function submit() {
    if (!maNoiBo.trim()) {
      alert("Cần nhập Mã nội bộ.");
      return;
    }
    setSaving(true);
    await onSubmit({ ma_noi_bo: maNoiBo, ten_hoa_don: tenHoaDon, quy_cach: quyCach, dvt, ty_le: tyLe, brand });
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h2>Hoàn thiện sản phẩm</h2>
        <p className="modal-sub">{product.ten_hang_hoa}</p>

        <div className="field-group">
          <div className="field-grid">
            <Field label="Mã nội bộ *">
              <input autoFocus value={maNoiBo} onChange={(e) => setMaNoiBo(e.target.value)} />
            </Field>
            <Field label="Tên trên hóa đơn">
              <input value={tenHoaDon} onChange={(e) => setTenHoaDon(e.target.value)} />
            </Field>
            <Field label="Đơn vị tính">
              <input value={dvt} onChange={(e) => setDvt(e.target.value)} />
            </Field>
            <Field label="Quy cách thùng">
              <select value={quyCach} onChange={(e) => handleQuyCach(e.target.value)}>
                <option value="">— Chọn quy cách —</option>
                {withCurrent(QUY_CACH_SUGGESTIONS, quyCach).map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </Field>
            <Field label="Tỷ lệ quy đổi">
              <select value={tyLe} onChange={(e) => setTyLe(e.target.value)}>
                <option value="">— Chọn tỷ lệ —</option>
                {withCurrent(TY_LE_SUGGESTIONS, tyLe).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Thương hiệu / NCC">
              <select value={brandNames.includes(brand) ? brand : ""} onChange={(e) => setBrand(e.target.value)}>
                <option value="">— Chọn thương hiệu —</option>
                {brandNames.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Hủy
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Đang lưu..." : "Hoàn thiện"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dòng trống ở cuối bảng "Quản lý hàng hóa" để thêm sản phẩm mới kiểu Excel —
// gõ thẳng vào các ô cùng cấu trúc cột với bảng, Enter để lưu (không lưu khi
// blur từng ô, tránh gửi dữ liệu dở dang lúc mới Tab qua ô kế tiếp). Sau khi
// lưu thành công, dòng tự trống lại để gõ tiếp dòng kế tiếp.
function NewProductRow({
  role,
  compactView,
  brandNames,
  categoryFilter,
  onCreate,
}: {
  role: Role;
  compactView: boolean;
  brandNames: string[];
  categoryFilter: string;
  onCreate: (input: ProductInput) => Promise<boolean>;
}) {
  const defaultCategory = categoryFilter !== "Tất cả" ? categoryFilter : CATEGORY_ORDER[0];
  const blank = (): FormState => ({ ...productToFormState(null), category_sheet: defaultCategory });

  const [form, setForm] = useState<FormState>(blank);
  const [brandCustom, setBrandCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const isSales = role === "sales";
  const canSubmit = isSales ? form.ten_hang_hoa.trim() !== "" : form.ma_noi_bo.trim() !== "" && form.ten_hang_hoa.trim() !== "";

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setQuyCach(value: string) {
    setForm((prev) => {
      const autoTyLe = prev.ty_le.trim() === "" ? extractQuantityFromQuyCach(value) : null;
      return { ...prev, quy_cach: value, ty_le: autoTyLe !== null ? String(autoTyLe) : prev.ty_le };
    });
  }

  async function commit() {
    if (!canSubmit) {
      alert(isSales ? "Cần nhập Tên hàng hóa trước khi lưu." : "Cần nhập Mã nội bộ và Tên hàng hóa trước khi lưu.");
      return;
    }
    setSaving(true);
    const ok = await onCreate(formStateToInput(form));
    setSaving(false);
    if (ok) {
      // Nháy nhẹ "✓ Đã thêm" 1.2s trước khi trống lại, để chắc chắn người
      // dùng thấy đã lưu thành công thay vì dòng lặng lẽ biến mất.
      setJustSaved(true);
      setTimeout(() => {
        setForm(blank());
        setBrandCustom(false);
        setJustSaved(false);
      }, 1200);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <tr className={`new-product-row${justSaved ? " just-saved" : ""}`} onKeyDown={handleKeyDown}>
      <td className="col-check">
        <PlusIcon />
      </td>
      <td className="col-name">
        <input
          placeholder="+ Tên hàng hóa mới..."
          value={form.ten_hang_hoa}
          onChange={(e) => set("ten_hang_hoa", e.target.value)}
          disabled={saving || justSaved}
        />
      </td>
      {!compactView && (
        <td>
          <select value={form.category_sheet} onChange={(e) => set("category_sheet", e.target.value)} disabled={saving || justSaved}>
            {CATEGORY_ORDER.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </td>
      )}
      {!compactView && (
        <td>
          {!isSales && (
            <input placeholder="Mã nội bộ" value={form.ma_noi_bo} onChange={(e) => set("ma_noi_bo", e.target.value)} disabled={saving || justSaved} />
          )}
        </td>
      )}
      {!compactView && (
        <td>
          {!isSales && <input value={form.ten_hoa_don} onChange={(e) => set("ten_hoa_don", e.target.value)} disabled={saving || justSaved} />}
        </td>
      )}
      {!compactView && (
        <td>
          {!isSales && (
            <select value={form.dvt} onChange={(e) => set("dvt", e.target.value)} disabled={saving || justSaved}>
              <option value="">—</option>
              {withCurrent(DVT_SUGGESTIONS, form.dvt).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          )}
        </td>
      )}
      <td className="num">
        {!isSales && (
          <input
            className="price-input"
            inputMode="numeric"
            value={form.gia_ban}
            onChange={(e) => set("gia_ban", e.target.value)}
            disabled={saving || justSaved}
          />
        )}
      </td>
      <td className="num">
        {!isSales && (
          <input
            className="price-input"
            inputMode="numeric"
            value={form.gia_thung}
            onChange={(e) => set("gia_thung", e.target.value)}
            disabled={saving || justSaved}
          />
        )}
      </td>
      {!compactView && (
        <td>
          {!isSales && (
            <select value={form.quy_cach} onChange={(e) => setQuyCach(e.target.value)} disabled={saving || justSaved}>
              <option value="">—</option>
              {withCurrent(QUY_CACH_SUGGESTIONS, form.quy_cach).map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          )}
        </td>
      )}
      {!compactView && (
        <td className="num">
          {!isSales && (
            <select value={form.ty_le} onChange={(e) => set("ty_le", e.target.value)} disabled={saving || justSaved}>
              <option value="">—</option>
              {withCurrent(TY_LE_SUGGESTIONS, form.ty_le).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </td>
      )}
      {!compactView && (
        <td>
          {!isSales &&
            (brandCustom ? (
              <input
                placeholder="Thương hiệu mới"
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                disabled={saving || justSaved}
              />
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
                disabled={saving || justSaved}
              >
                <option value="">—</option>
                {brandNames.map((b) => (
                  <option key={b}>{b}</option>
                ))}
                <option value="__new__">+ Thương hiệu mới…</option>
              </select>
            ))}
        </td>
      )}
      {!compactView && (
        <td>{!isSales && <input value={form.ma_vach} onChange={(e) => set("ma_vach", e.target.value)} disabled={saving || justSaved} />}</td>
      )}
      {!compactView && (
        <td>{!isSales && <input value={form.ma_thung} onChange={(e) => set("ma_thung", e.target.value)} disabled={saving || justSaved} />}</td>
      )}
      {!compactView && <td />}
      {!compactView && (
        <td>
          <button
            type="button"
            className={`btn btn-sm ${justSaved ? "btn-success" : "btn-primary"}`}
            disabled={saving || justSaved || !canSubmit}
            onClick={commit}
          >
            {justSaved ? "✓ Đã thêm" : saving ? "Đang lưu..." : "Thêm"}
          </button>
        </td>
      )}
    </tr>
  );
}

function ProductForm({
  initial,
  brandNames,
  role,
  onCancel,
  onSave,
}: {
  initial: Product;
  brandNames: string[];
  role: Role;
  onCancel: () => void;
  onSave: (input: ProductInput) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => productToFormState(initial));
  const [saving, setSaving] = useState(false);

  const [brandCustom, setBrandCustom] = useState(!!initial.brand?.name && !brandNames.includes(initial.brand.name));

  // Chỉ Admin mới đổi được tên hàng hóa — Kế toán vẫn sửa được các trường
  // khác, chỉ riêng tên bị khóa (app/api/products/[id]/route.ts chặn ở API).
  const nameLocked = role !== "admin";

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
        <h2>Sửa sản phẩm</h2>
        <p className="modal-sub">Điền thông tin cơ bản trước — các mục còn lại có thể bổ sung sau.</p>

        <div className="field-group">
          <h3>Thông tin cơ bản</h3>
          <div className="field-grid">
            <Field label="Mã nội bộ *">
              <input value={form.ma_noi_bo} onChange={(e) => set("ma_noi_bo", e.target.value)} />
            </Field>
            <Field label="Nhóm hàng *">
              <select value={form.category_sheet} onChange={(e) => set("category_sheet", e.target.value)}>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={nameLocked ? "Tên hàng hóa (gốc) — chỉ Admin đổi được" : "Tên hàng hóa (gốc) *"}>
              <input
                value={form.ten_hang_hoa}
                onChange={(e) => set("ten_hang_hoa", e.target.value)}
                disabled={nameLocked}
                title={nameLocked ? "Chỉ Admin mới đổi được tên hàng hóa" : undefined}
              />
            </Field>
            <Field label="Tên trên hóa đơn">
              <input value={form.ten_hoa_don} onChange={(e) => set("ten_hoa_don", e.target.value)} />
            </Field>
            <Field label="Đơn vị tính">
              <select value={form.dvt} onChange={(e) => set("dvt", e.target.value)}>
                <option value="">— Chọn ĐVT —</option>
                {withCurrent(DVT_SUGGESTIONS, form.dvt).map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
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

// Sub-line under the product name in the table: mã vạch + mã thùng (the
// scannable codes staff actually use day-to-day) instead of mã nội bộ, which
// is still shown as a tooltip on hover.
function formatVnd(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("vi-VN");
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

function TagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L3 13v-3a2 2 0 0 1 2-2h4l7.59 7.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="9.5" r="1" />
      <path d="M13 21 21.03 12.97" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LogIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="5" rx="1.2" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 15v3" />
      <path d="M12 10v8" />
      <path d="M17 6v12" />
    </svg>
  );
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
function QuoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M8 13h5M8 17h3" />
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
