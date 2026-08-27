import { NextRequest, NextResponse } from "next/server";
import { buildTransferKhoFromTonKho, parseTonKhoWorkbook } from "@/lib/transferKhoBuilder";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn file Tổng hợp tồn kho" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tonKhoRows = await parseTonKhoWorkbook(buffer);
    if (tonKhoRows.length === 0) {
      return NextResponse.json(
        { error: 'Không đọc được dòng nào — kiểm tra lại đúng file "Tổng hợp tồn kho" export từ MISA (lọc theo Kho: SHOPEE)' },
        { status: 400 }
      );
    }

    const result = await buildTransferKhoFromTonKho(tonKhoRows);

    if (result.rows.length > 0) {
      const actor = await getCurrentUserRole();
      if (actor) {
        await logActivity({
          actorId: actor.userId,
          actorName: actor.displayName,
          action: "transfer_kho.export_ton_kho",
          targetType: "transfer_kho",
          targetLabel: `Xuất phiếu chuyển kho từ Tổng hợp tồn kho "${file.name}" — ${result.rows.length} mã hàng hóa`,
          detail: {
            fileName: file.name,
            maCount: result.rows.length,
            skippedNonNegativeCount: result.skippedNonNegativeCount,
          },
        });
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      file: result.file.toString("base64"),
      filename: `Nhap_khau_chi_tiet_hang_hoa_chuyen_kho_${today}.xlsx`,
      rows: result.rows,
      skippedNonNegativeCount: result.skippedNonNegativeCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
