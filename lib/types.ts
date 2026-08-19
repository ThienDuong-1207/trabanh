export type Product = {
  id: string;
  ma_noi_bo: string;
  ten_hang_hoa: string;
  ten_hoa_don: string | null;
  dvt: string | null;
  gia_ban: number | null;
  gia_thung: number | null;
  quy_cach: string | null;
  ty_le: number | null;
  dvt_cap_2: string | null;   // Đơn vị cấp 2 (Hộp) — chỉ dùng cho sản phẩm bán 3 cấp Gói/Túi → Hộp → Thùng
  ty_le_cap_2: number | null; // Tỷ lệ quy đổi cấp 2 (Gói/Túi → Hộp)
  gia_hop: number | null;    // Giá Hộp
  brand_id: string | null;
  brand?: { name: string } | null; // populated only when a query joins brand:brands(name)
  nha_cung_cap: string | null;
  ma_hang_hoa: string | null; // Mã hàng NCC — mã SKU riêng của nhà cung cấp, dùng để đối chiếu (khác ma_noi_bo, vốn dùng để định danh sản phẩm trong hệ thống)
  ma_vach: string | null;
  ma_thung: string | null;
  ma_nhom_thay_the: string | null;
  trang_thai: string | null;
  // Nhiều dòng tương ứng nhiều biến thể Shopee (bán lẻ + trong combo) — phân
  // tách bằng dấu ";" hoặc xuống dòng. Mỗi dòng dạng "Tên sản phẩm Shopee[,Hương vị]",
  // KHÔNG kèm cụm số lượng ("Combo N...") — số lượng đọc riêng từ đơn hàng lúc
  // đối chiếu. Dùng để đối chiếu file đơn hàng Shopee ra phiếu chuyển kho.
  ten_shopee: string | null;
  xuat_xu: string | null;
  category_sheet: string;
  updated_at: string;
  last_exported_at: string | null;
  is_draft: boolean;
  created_at: string | null; // null = sản phẩm cũ, thêm trước khi có cột này
};

// Shape sent from the product create/edit form: same editable fields as
// Product, minus server-assigned ones, with `brand` as a plain name instead
// of `brand_id` (the API resolves-or-creates the brand row by name).
export type ProductInput = Omit<Product, "id" | "brand_id" | "brand" | "updated_at" | "last_exported_at" | "is_draft" | "created_at"> & {
  brand: string | null;
};

export type RequestStatus = "pending" | "approved" | "rejected";

export type PriceChangeRequest = {
  id: string;
  product_id: string;
  proposed_gia_ban: number | null;
  proposed_gia_thung: number | null;
  proposed_by: string;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  note: string | null;
  created_at: string;
  product?: { ten_hang_hoa: string; ma_noi_bo: string; gia_ban: number | null; gia_thung: number | null } | null;
  proposer?: { display_name: string | null; username: string | null } | null;
};

export type ProductFieldRequest = {
  id: string;
  product_id: string;
  field: "ma_vach" | "ma_thung";
  old_value: string | null;
  proposed_value: string;
  conflict_ma_noi_bo: string | null;
  conflict_ten_hang_hoa: string | null;
  proposed_by: string | null;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  note: string | null;
  created_at: string;
  product?: { ten_hang_hoa: string; ma_noi_bo: string } | null;
  proposer?: { display_name: string | null; username: string | null } | null;
};

export type PriceHistoryEntry = {
  id: string;
  product_id: string;
  gia_ban_old: number | null;
  gia_ban_new: number | null;
  gia_thung_old: number | null;
  gia_thung_new: number | null;
  changed_at: string;
  product?: { ten_hang_hoa: string; ma_noi_bo: string } | null;
};

export type Profile = {
  id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  role: "sales" | "accountant" | "admin" | null;
  must_change_password: boolean;
  created_at: string;
};

export type ActivityLogEntry = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type Notification = {
  id: string;
  recipient_id: string;
  activity_id: string | null;
  message: string;
  link_view: string | null;
  read_at: string | null;
  created_at: string;
};

export const CATEGORY_ORDER = [
  "Trà", "Sữa tươi", "Sữa đặc", "Kem đông lạnh", "Syrup", "Bột",
  "Trân châu", "Mứt", "Đồ lon", "Mặt hàng khác", "Công cụ dụng cụ",
];
