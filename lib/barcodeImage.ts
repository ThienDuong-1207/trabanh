import bwipjs from "bwip-js/node";
import { isValidEan13 } from "./ean13";

// Generates a real scannable barcode PNG from a product's mã vạch: EAN-13
// for a code that's genuinely a valid 13-digit GS1 barcode (correct check
// digit), Code128 for anything else (internal codes, wrong lengths, letters,
// or a 13-digit code that's just coincidentally that long but isn't a real
// EAN-13 — bwip-js rejects those with a bad-check-digit error, and Code128
// encodes arbitrary digit strings without needing one). Returns null only if
// the code is empty or Code128 itself can't encode it.
export async function generateBarcodePng(code: string): Promise<Buffer | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const bcid = isValidEan13(trimmed) ? "ean13" : "code128";
  try {
    return await bwipjs.toBuffer({
      bcid,
      text: trimmed,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: "center",
    });
  } catch {
    return null;
  }
}

// Reads width/height straight out of the PNG IHDR chunk (bytes 16-23), so a
// caller can scale a barcode image to a target width while preserving its
// real aspect ratio instead of guessing a fixed height.
export function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
