import sharp from "sharp";
import path from "path";

// Overlay cố định (viền bo góc + logo TRÀ & BÁNH + cụm 3 icon "Hàng chính
// hãng/Giao hỏa tốc/Tư vấn miễn phí") — tách 1 lần từ ảnh mẫu thật
// ("Bột Cacao Lúa Mạch MILO (1KG) - Khung.webp") bằng cách xoá vùng ảnh sản
// phẩm + nền trắng, chỉ giữ lại phần viền/logo/icon dạng PNG nền trong suốt.
// Canvas vuông 1080x1080, vùng đặt ảnh sản phẩm là ô (250,209)-(641,996) đo
// trực tiếp từ ảnh mẫu đó.
const OVERLAY_PATH = path.join(process.cwd(), "public", "templates", "khung_overlay.png");
const CANVAS_SIZE = 1080;
const PRODUCT_BOX = { left: 250, top: 209, width: 391, height: 787 };

// Hậu tố dùng để nhận biết ảnh đã có khung ("Tên.webp" -> "Tên - Khung.webp")
// và để suy ra tên file output — theo đúng quy ước đặt tên trong ảnh mẫu.
export const KHUNG_SUFFIX = " - Khung";

export function parseImageFilename(filename: string): { baseName: string; isFramed: boolean } {
  const dot = filename.lastIndexOf(".");
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  if (stem.endsWith(KHUNG_SUFFIX)) {
    return { baseName: stem.slice(0, -KHUNG_SUFFIX.length), isFramed: true };
  }
  return { baseName: stem, isFramed: false };
}

// Cắt ảnh sản phẩm gốc vào đúng khung mẫu: trim khoảng trắng thừa quanh sản
// phẩm trước (ảnh gốc có thể có nhiều/ít lề khác nhau), co giãn vừa khít ô
// PRODUCT_BOX (giữ nguyên tỉ lệ, không méo — "contain" chứ không "cover"),
// căn giữa ô đó, dán lên nền trắng 1080x1080 rồi phủ overlay cố định lên trên.
export async function buildFramedProductImage(inputBuffer: Buffer): Promise<Buffer> {
  const trimmed = await sharp(inputBuffer).flatten({ background: "#ffffff" }).trim().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? PRODUCT_BOX.width;
  const srcH = meta.height ?? PRODUCT_BOX.height;

  const scale = Math.min(PRODUCT_BOX.width / srcW, PRODUCT_BOX.height / srcH);
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const resized = await sharp(trimmed).resize(targetW, targetH).toBuffer();

  const left = PRODUCT_BOX.left + Math.round((PRODUCT_BOX.width - targetW) / 2);
  const top = PRODUCT_BOX.top + Math.round((PRODUCT_BOX.height - targetH) / 2);

  return sharp({
    create: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 3, background: "#ffffff" },
  })
    .composite([
      { input: resized, left, top },
      { input: OVERLAY_PATH, left: 0, top: 0 },
    ])
    .webp({ quality: 92 })
    .toBuffer();
}
