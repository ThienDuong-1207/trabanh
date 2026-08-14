import { NextRequest, NextResponse } from "next/server";
import { buildTransferKhoFile, parseShopeeOrderWorkbook } from "@/lib/transferKhoBuilder";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn file đơn hàng" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const orderRows = await parseShopeeOrderWorkbook(buffer);
    if (orderRows.length === 0) {
      return NextResponse.json(
        { error: 'Không đọc được dòng đơn hàng nào — kiểm tra lại đúng file "đơn hàng giao" export từ Shopee' },
        { status: 400 }
      );
    }

    const result = await buildTransferKhoFile(orderRows);

    if (result.rows.length > 0) {
      const actor = await getCurrentUserRole();
      if (actor) {
        await logActivity({
          actorId: actor.userId,
          actorName: actor.displayName,
          action: "transfer_kho.export",
          targetType: "transfer_kho",
          targetLabel: `Xuất phiếu chuyển kho Shopee từ "${file.name}" — ${result.rows.length} mã hàng hóa`,
          detail: {
            fileName: file.name,
            maCount: result.rows.length,
            unmatchedCount: result.unmatched.length,
          },
        });
      }
    }

    return NextResponse.json({
      file: result.file.toString("base64"),
      filename: `Nhap_khau_chi_tiet_hang_hoa_chuyen_kho_${todayStamp()}.xlsx`,
      rows: result.rows,
      unmatched: result.unmatched,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
