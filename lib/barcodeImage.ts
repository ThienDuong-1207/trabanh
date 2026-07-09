import bwipjs from "bwip-js/node";

// Generates a real scannable barcode PNG from a product's mã vạch: EAN-13
// for a standard 13-digit retail code (the format actually used in this
// shop's data), Code128 for anything else (internal codes, wrong lengths,
// letters) since it can encode arbitrary text. Returns null if the code is
// empty or can't be encoded (e.g. a non-numeric string under EAN-13 rules).
export async function generateBarcodePng(code: string): Promise<Buffer | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const bcid = /^\d{13}$/.test(trimmed) ? "ean13" : "code128";
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
