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
  brand_id: string | null;
  brand?: { name: string } | null; // populated only when a query joins brand:brands(name)
  ma_vach: string | null;
  ma_thung: string | null;
  ma_nhom_thay_the: string | null;
  trang_thai: string | null;
  xuat_xu: string | null;
  category_sheet: string;
  updated_at: string;
  last_exported_at: string | null;
  is_draft: boolean;
};

// Shape sent from the product create/edit form: same editable fields as
// Product, minus server-assigned ones, with `brand` as a plain name instead
// of `brand_id` (the API resolves-or-creates the brand row by name).
export type ProductInput = Omit<Product, "id" | "brand_id" | "brand" | "updated_at" | "last_exported_at" | "is_draft"> & {
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
