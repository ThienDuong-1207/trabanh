import { supabaseAdmin } from "./supabaseServer";
import { Category } from "./types";

// Nguồn sự thật duy nhất cho danh sách nhóm hàng — thay cho CATEGORY_ORDER/
// QUOTE_CATEGORY_ORDER/CATEGORY_TRANSLATIONS/CATEGORY_TO_NHH trước đây (mỗi
// cái 1 hằng số cố định trong code, phải sửa tay 4 chỗ mỗi khi thêm nhóm
// hàng mới). Server-only (dùng supabaseAdmin) — phía client đọc thẳng bảng
// `categories` qua RLS (select công khai cho người đã đăng nhập), không cần
// hàm riêng.

export async function getCategories(): Promise<Category[]> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
  if (error) throw new Error(`Không đọc được danh sách nhóm hàng: ${error.message}`);
  return (data ?? []) as Category[];
}

// Dùng lúc import Excel (lib/excelImport.ts): sheet nào có tên (đã cắt hậu
// tố số/mã) chưa khớp nhóm hàng nào có sẵn thì tự thêm 1 dòng mới — chèn
// ngay TRƯỚC "Công cụ dụng cụ" (sort_order/quote_sort_order cố định 999) ở
// cả 2 thứ tự, để nhóm mới luôn nằm trước nhóm luôn-đứng-cuối đó. Tên dịch
// Anh/Trung để trống (tự dịch khi xuất báo giá lần đầu, xem
// resolveCategoryTranslations), mã MISA để trống (phải điền tay sau khi tạo
// nhóm tương ứng bên MISA).
export async function ensureCategory(name: string, existing: Category[]): Promise<Category> {
  const found = existing.find((c) => c.name === name);
  if (found) return found;

  const supabase = supabaseAdmin();
  const nextOrder = (field: "sort_order" | "quote_sort_order") => {
    const belowLast = existing.filter((c) => c[field] < 999).map((c) => c[field]);
    return (belowLast.length > 0 ? Math.max(...belowLast) : 0) + 10;
  };

  const { data, error } = await supabase
    .from("categories")
    .insert({ name, sort_order: nextOrder("sort_order"), quote_sort_order: nextOrder("quote_sort_order") })
    .select()
    .single();
  if (error) throw new Error(`Không tạo được nhóm hàng mới "${name}": ${error.message}`);

  const category = data as Category;
  existing.push(category); // để các sheet tiếp theo trong cùng lượt import thấy nhóm vừa tạo
  return category;
}

// Thứ tự nhóm hàng RIÊNG cho bảng báo giá (lib/quoteBuilder.ts) — khác thứ
// tự chung của app (sort_order dùng cho dropdown/lọc/báo cáo). "Combo" không
// nằm trong bảng `categories` (không phải nhóm nhập từ Excel) nên chèn tay
// vào ngay trước "Công cụ dụng cụ" (luôn đứng cuối cùng tuyệt đối).
export function buildQuoteCategoryOrder(categories: Category[]): string[] {
  const CCDC = "Công cụ dụng cụ";
  const ordered = categories
    .slice()
    .sort((a, b) => a.quote_sort_order - b.quote_sort_order)
    .map((c) => c.name);
  const withoutCcdc = ordered.filter((n) => n !== CCDC);
  return ordered.includes(CCDC) ? [...withoutCcdc, "Combo", CCDC] : [...withoutCcdc, "Combo"];
}
