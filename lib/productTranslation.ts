import { supabaseAdmin } from "./supabaseServer";
import { Product } from "./types";

// Dịch tên sản phẩm (tiếng Việt) sang tiếng Anh/Trung cho bảng báo giá
// (lib/quoteBuilder.ts) bằng Claude API — gọi 1 lần duy nhất cho cả lô sản
// phẩm chưa có bản dịch trong 1 request (rẻ + nhanh hơn nhiều so với gọi
// riêng từng sản phẩm), kết quả được cache lại vào products.ten_en/ten_zh.
// Không dùng model nặng — tên sản phẩm ngắn, Haiku là đủ.
export type TranslateLang = "en" | "zh";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8192;
// Dịch theo lô nhỏ thay vì gửi hết 1 lần — thực tế gặp lỗi thật: gửi 300 sản
// phẩm 1 lần bị cắt cụt giữa chừng (stop_reason "max_tokens", dù đã tăng
// max_tokens lên 8192 vẫn không đủ cho danh mục lớn), JSON trả về dở dang
// không đọc được. 40 sản phẩm/lô luôn nằm rất xa giới hạn output, đồng thời
// lô nào lỗi cũng không làm hỏng các lô khác đã dịch xong.
const BATCH_SIZE = 40;

async function translateBatch(names: { id: string; name: string }[], lang: TranslateLang): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Thiếu biến môi trường ANTHROPIC_API_KEY");

  const langLabel = lang === "en" ? "English" : "Simplified Chinese";
  const list = names.map((n, i) => `${i + 1}. ${n.name}`).join("\n");

  const prompt =
    `Translate the following Vietnamese retail product names (from a tea/bakery supply shop) to ${langLabel}.\n` +
    "Rules:\n" +
    "- Keep brand names exactly as written — do NOT translate or transliterate proper nouns/brand names.\n" +
    "- Keep numbers and packaging sizes as-is (e.g. \"500G\", \"1KG\"); only translate unit/descriptor words.\n" +
    "- Return ONLY a JSON array of strings, in the same order and with the same count as the input list below — no explanation, no markdown code fence, no extra text.\n\n" +
    `Product names:\n${list}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Dịch tự động thất bại (mã lỗi ${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const rawText: string = data.content?.[0]?.text ?? "";
  // Phòng trường hợp model vẫn bọc kết quả trong ```json ... ``` dù đã dặn không làm vậy.
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");

  let translations: unknown;
  try {
    translations = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Không đọc được kết quả dịch (định dạng JSON không hợp lệ${data.stop_reason === "max_tokens" ? ", có thể bị cắt cụt giữa chừng" : ""})`
    );
  }
  if (!Array.isArray(translations) || translations.length !== names.length) {
    throw new Error("Kết quả dịch không khớp số lượng sản phẩm đã gửi");
  }

  const result: Record<string, string> = {};
  names.forEach((n, i) => {
    result[n.id] = String(translations[i]);
  });
  return result;
}

export async function translateProductNames(
  names: { id: string; name: string }[],
  lang: TranslateLang
): Promise<Record<string, string>> {
  if (names.length === 0) return {};

  // Chạy song song thay vì tuần tự — thực tế đo được 300 sản phẩm (8 lô) mất
  // ~48s nếu chạy tuần tự, đủ để vượt quá thời gian chờ tối đa của 1 request
  // API route trên Vercel. Chạy song song rút thời gian chờ về gần bằng đúng
  // 1 lô duy nhất (các lô độc lập hoàn toàn, không cần thứ tự).
  const batches: { id: string; name: string }[][] = [];
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    batches.push(names.slice(i, i + BATCH_SIZE));
  }
  const batchResults = await Promise.all(batches.map((batch) => translateBatch(batch, lang)));

  const result: Record<string, string> = {};
  for (const batchResult of batchResults) Object.assign(result, batchResult);
  return result;
}

// Dùng cho báo giá (app/api/export-quote*/route.ts): sản phẩm nào đã có
// ten_en/ten_zh (dịch tay hoặc cache từ lần dịch trước) thì dùng lại luôn,
// không gọi API; sản phẩm nào chưa có mới dịch, rồi lưu lại vào products để
// lần sau không dịch lại. Trả về mảng Product mới với ten_hang_hoa đã thay
// bằng tên đã dịch — quoteBuilder.ts/quoteExcelBuilder.ts không cần biết gì
// về ten_en/ten_zh, chỉ đọc ten_hang_hoa như bình thường.
export async function resolveQuoteItemNames(items: Product[], lang: TranslateLang): Promise<Product[]> {
  const field: "ten_en" | "ten_zh" = lang === "en" ? "ten_en" : "ten_zh";
  const missing = items.filter((p) => !p[field]);

  const translatedById = new Map<string, string>();
  if (missing.length > 0) {
    const translations = await translateProductNames(
      missing.map((p) => ({ id: p.id, name: p.ten_hang_hoa })),
      lang
    );
    const supabase = supabaseAdmin();
    await Promise.all(
      Object.entries(translations).map(async ([id, name]) => {
        translatedById.set(id, name);
        const { error } = await supabase.from("products").update({ [field]: name }).eq("id", id);
        if (error) console.error(`Lưu cache ${field} thất bại cho sản phẩm ${id}:`, error.message);
      })
    );
  }

  return items.map((p) => ({ ...p, ten_hang_hoa: p[field] ?? translatedById.get(p.id) ?? p.ten_hang_hoa }));
}
