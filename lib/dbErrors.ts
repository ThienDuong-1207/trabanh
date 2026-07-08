const UNIQUE_FIELD_LABELS: Record<string, string> = {
  ma_noi_bo: "Mã nội bộ",
  ma_vach: "Mã vạch",
  ma_thung: "Mã thùng",
};

// Turns a Postgres unique-violation (23505) on ma_noi_bo/ma_vach/ma_thung into
// a Vietnamese message naming the field and value that collided, instead of
// surfacing the raw constraint/index name. Returns null for any other error.
export function friendlyDbError(error: { code?: string; message?: string; details?: string } | null | undefined): string | null {
  if (!error || error.code !== "23505") return null;
  for (const [field, label] of Object.entries(UNIQUE_FIELD_LABELS)) {
    if (error.message?.includes(field) || error.details?.includes(field)) {
      const match = error.details?.match(/=\(([^)]+)\)/);
      const value = match ? match[1] : "";
      return `${label}${value ? ` "${value}"` : ""} đã được dùng cho sản phẩm khác — vui lòng chọn giá trị khác.`;
    }
  }
  return null;
}
