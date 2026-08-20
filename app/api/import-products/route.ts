import { NextRequest, NextResponse } from "next/server";
import { importProductsFromWorkbook, ImportMode } from "@/lib/excelImport";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Giới hạn số dòng liệt kê chi tiết trong 1 dòng Nhật ký hoạt động — số đếm
// (newCount/priceChanges.length) vẫn luôn chính xác dù danh sách bị cắt bớt,
// tránh 1 lần import lớn (hàng trăm dòng) làm phình to cột detail jsonb.
const LOG_DETAIL_CAP = 50;

function capList<T>(list: T[]): { items: T[]; more: number } {
  return { items: list.slice(0, LOG_DETAIL_CAP), more: Math.max(0, list.length - LOG_DETAIL_CAP) };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn file Excel" }, { status: 400 });
    }
    const mode: ImportMode = form.get("mode") === "update-all" ? "update-all" : "new-only";
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await importProductsFromWorkbook(buffer, mode);

    // Chỉ ghi Nhật ký hoạt động khi thực sự có thay đổi (sản phẩm mới hoặc
    // đổi giá) — import không đổi gì thì bỏ qua, không tạo dòng log nào.
    const hasChanges = summary.newCount > 0 || summary.priceChanges.length > 0;
    if (hasChanges) {
      const actor = await getCurrentUserRole();
      if (actor) {
        const parts: string[] = [];
        if (summary.newCount > 0) parts.push(`${summary.newCount} sản phẩm mới`);
        if (summary.priceChanges.length > 0) parts.push(`${summary.priceChanges.length} đổi giá`);
        const targetLabel = `Nhập file "${file.name}" — ${parts.join(", ")}`;

        await logActivity({
          actorId: actor.userId,
          actorName: actor.displayName,
          action: "product.import",
          targetType: "import",
          targetLabel,
          detail: {
            fileName: file.name,
            mode,
            newCount: summary.newCount,
            priceChangedCount: summary.priceChanges.length,
            newProducts: capList(summary.newProducts),
            priceChanges: capList(summary.priceChanges),
          },
        });
      }
    }

    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
