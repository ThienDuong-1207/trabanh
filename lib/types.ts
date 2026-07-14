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
};

// Shape sent from the product create/edit form: same editable fields as
// Product, minus server-assigned ones, with `brand` as a plain name instead
// of `brand_id` (the API resolves-or-creates the brand row by name).
export type ProductInput = Omit<Product, "id" | "brand_id" | "brand" | "updated_at" | "last_exported_at"> & {
  brand: string | null;
};

export const CATEGORY_ORDER = [
  "Trà", "Sữa tươi", "Sữa đặc", "Kem đông lạnh", "Syrup", "Bột",
  "Trân châu", "Mứt", "Đồ lon", "Mặt hàng khác", "Công cụ dụng cụ",
];
