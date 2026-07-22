// Curated option lists from "Misa hàng hóa/1. Quản lý hàng hóa hợp nhất.xlsx",
// sheet "HUONG DAN" — the shop's own reference lists for these two fields.
// Kept verbatim (including inconsistent spacing/casing) since it's their data.
export const QUY_CACH_SUGGESTIONS = [
  "Thùng (2 hộp)", "Thùng (6 chai)", "Thùng (6 hộp)", "Thùng (6 túi)", "Thùng (8 túi)",
  "Hộp (10 gói)", "Thùng (10 bịch)", "Thùng (10 hộp)", "Thùng (10 túi)", "Hộp (12 gói)",
  "Thùng (12 chai)", "Thùng (12 gói)", "Thùng (12 hộp)", "Thùng (12 lon)", "Thùng (12 túi)",
  "Thùng (12lon)", "Thùng (15 hộp)", "Thùng (16 túi)", "Thùng (20 gói)", "Thùng (20 túi)",
  "Hộp (24 miếng)", "Thùng (24 hộp)", "Thùng (24 lon)", "Thùng (24 túi)", "thùng (24 lon 1kg)",
  "Thùng (28 hộp)", "Thùng (30 gói)", "Thùng (30 hộp )", "Thùng (30 túi)", "Thùng ( 36 hộp)",
  "Thùng (36 hộp)", "Thùng (50 túi)", "Thùng (100 gói)",
];

export const TY_LE_SUGGESTIONS = [2, 6, 8, 10, 12, 15, 16, 20, 24, 28, 30, 36, 50, 100];

// Same "HUONG DAN" sheet, cột "Đơn vị tính" (A21:A31).
export const DVT_SUGGESTIONS = ["Hộp", "Túi", "Chai", "Lon", "Gói", "Cái", "Thùng", "Bao", "Can", "Kg", "Cây"];

// Pulls the first number out of a "Thùng (12 hộp)"-style label, for
// auto-filling Tỷ lệ quy đổi when the user picks a Quy cách thùng.
export function extractQuantityFromQuyCach(quyCach: string): number | null {
  const match = quyCach.match(/\(\s*(\d+)/);
  return match ? Number(match[1]) : null;
}
