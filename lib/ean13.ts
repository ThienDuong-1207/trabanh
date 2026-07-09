// GS1 EAN-13 check-digit math + generator for internal-use codes.
// Prefix "200"-"299" is GS1's reserved "restricted circulation number"
// range — meant exactly for in-store/internal codes like these, so it
// never collides with a real manufacturer barcode.
const INTERNAL_PREFIX = "200";

export function ean13CheckDigit(code12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(code12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

// sequence is the 9-digit internal counter (0-999999999).
export function generateInternalEan13(sequence: number): string {
  const seqStr = String(sequence).padStart(12 - INTERNAL_PREFIX.length, "0");
  if (seqStr.length !== 12 - INTERNAL_PREFIX.length) throw new Error("Sequence quá lớn cho mã EAN-13 nội bộ");
  const code12 = INTERNAL_PREFIX + seqStr;
  return code12 + ean13CheckDigit(code12);
}
