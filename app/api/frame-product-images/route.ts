import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { buildFramedProductImage, parseImageFilename } from "@/lib/productFrameBuilder";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "Chưa chọn ảnh nào" }, { status: 400 });
    }

    // 1 lượt duyệt để biết ảnh nào trong chính batch này đã có sẵn bản khung
    // (Tên.webp có kèm Tên - Khung.webp) — không đụng gì tới file đã có khung.
    const framedBaseNames = new Set<string>();
    for (const file of files) {
      const { baseName, isFramed } = parseImageFilename(file.name);
      if (isFramed) framedBaseNames.add(baseName);
    }

    const toProcess: File[] = [];
    const skippedNames: string[] = [];
    for (const file of files) {
      const { baseName, isFramed } = parseImageFilename(file.name);
      if (isFramed) continue; // bản thân đã là ảnh khung, không xử lý lại
      if (framedBaseNames.has(baseName)) {
        skippedNames.push(file.name);
        continue;
      }
      toProcess.push(file);
    }

    const zip = new JSZip();
    const createdNames: string[] = [];
    const failedNames: string[] = [];
    for (const file of toProcess) {
      const { baseName } = parseImageFilename(file.name);
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const framed = await buildFramedProductImage(buffer);
        const outName = `${baseName} - Khung.webp`;
        zip.file(outName, framed);
        createdNames.push(outName);
      } catch (e: any) {
        failedNames.push(`${file.name} (${e.message})`);
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    if (createdNames.length > 0) {
      const actor = await getCurrentUserRole();
      if (actor) {
        await logActivity({
          actorId: actor.userId,
          actorName: actor.displayName,
          action: "product_images.frame",
          targetType: "product_images",
          targetLabel: `Tạo khung ${createdNames.length} ảnh sản phẩm`,
          detail: { createdCount: createdNames.length, skippedCount: skippedNames.length, failedCount: failedNames.length },
        });
      }
    }

    return NextResponse.json({
      file: zipBuffer.toString("base64"),
      filename: "Anh_san_pham_da_tao_khung.zip",
      createdCount: createdNames.length,
      skippedCount: skippedNames.length,
      createdNames,
      skippedNames,
      failedNames,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
