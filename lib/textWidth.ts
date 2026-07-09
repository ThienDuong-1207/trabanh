// Approximate Arial Bold glyph widths (1/1000 em — standard published AFM
// metrics), used to size text precisely instead of the unreliable
// "count characters" approach: M/W are ~3x wider than I/l despite being a
// single character each. Vietnamese diacritics are stripped before lookup
// (via Unicode NFD) since the base Latin letter's advance width dominates.
const WIDTHS_1000: Record<string, number> = {
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278,
  j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389,
  s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556,
  "7": 556, "8": 556, "9": 556,
  " ": 278, ".": 333, ",": 333, ":": 333, ";": 333, "-": 333, "'": 333,
  "(": 333, ")": 333, "/": 278, "%": 944, "&": 722, "_": 556, "đ": 611, "Đ": 722,
};
const DEFAULT_WIDTH_1000 = 650;

function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

// Returns the estimated rendered width, in points, of `text` set in `sizePt`.
export function estimateTextWidthPt(text: string, sizePt: number): number {
  const normalized = stripDiacritics(text);
  let units = 0;
  for (const ch of normalized) units += WIDTHS_1000[ch] ?? DEFAULT_WIDTH_1000;
  return (units / 1000) * sizePt;
}
