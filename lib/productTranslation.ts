import { supabaseAdmin } from "./supabaseServer";
import { Product } from "./types";

// Dịch tên sản phẩm + quy cách đóng gói (tiếng Việt) sang tiếng Anh/Trung cho
// bảng báo giá (lib/quoteBuilder.ts) bằng Claude API — gộp cả 2 trường vào
// chung 1 lượt dịch mỗi sản phẩm (đỡ tốn thêm 1 lượt gọi riêng cho quy cách),
// kết quả cache lại vào products.ten_en/ten_zh + quy_cach_en/quy_cach_zh.
// Không dùng model nặng — text ngắn, Haiku là đủ.
export type TranslateLang = "en" | "zh";

type TranslateItem = { id: string; name: string; quyCach: string };
type Translated = { name: string; quyCach: string };

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8192;
// Dịch theo lô nhỏ thay vì gửi hết 1 lần — thực tế gặp lỗi thật: gửi 300 sản
// phẩm 1 lần bị cắt cụt giữa chừng (stop_reason "max_tokens", dù đã tăng
// max_tokens lên 8192 vẫn không đủ cho danh mục lớn), JSON trả về dở dang
// không đọc được. 40 sản phẩm/lô luôn nằm rất xa giới hạn output, đồng thời
// lô nào lỗi cũng không làm hỏng các lô khác đã dịch xong.
const BATCH_SIZE = 40;

async function translateBatch(items: TranslateItem[], lang: TranslateLang): Promise<Record<string, Translated>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Thiếu biến môi trường ANTHROPIC_API_KEY");

  const langLabel = lang === "en" ? "English" : "Simplified Chinese";
  const list = items.map((it, i) => `${i + 1}. name: "${it.name}" | specification: "${it.quyCach}"`).join("\n");

  const prompt =
    `Translate the following Vietnamese retail product names and packaging specifications (from a tea/bakery ` +
    `supply shop) to ${langLabel}.\n` +
    "Rules:\n" +
    "- Keep brand names exactly as written — do NOT translate or transliterate proper nouns/brand names.\n" +
    "- Keep numbers and packaging sizes as-is (e.g. \"500G\", \"1KG\"); only translate unit/descriptor words " +
    "(e.g. \"Thùng\" -> case/box, \"gói\" -> pack, \"hộp\" -> box).\n" +
    "- Loanwords like \"Syrup\" should be translated too when translating to Chinese (e.g. \"糖浆\"), not left as-is.\n" +
    "- If a specification is an empty string, return it as an empty string too.\n" +
    "- Return ONLY a JSON array of objects, each shaped exactly as {\"name\": \"...\", \"quyCach\": \"...\"}, in the " +
    "same order and with the same count as the input list below — no explanation, no markdown code fence, no extra text.\n\n" +
    `Items:\n${list}`;

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
  if (!Array.isArray(translations) || translations.length !== items.length) {
    throw new Error("Kết quả dịch không khớp số lượng sản phẩm đã gửi");
  }

  const result: Record<string, Translated> = {};
  items.forEach((it, i) => {
    const t = translations[i] as { name?: unknown; quyCach?: unknown };
    result[it.id] = { name: String(t?.name ?? it.name), quyCach: String(t?.quyCach ?? "") };
  });
  return result;
}

async function translateItems(items: TranslateItem[], lang: TranslateLang): Promise<Record<string, Translated>> {
  if (items.length === 0) return {};

  // Chạy song song thay vì tuần tự — thực tế đo được 300 sản phẩm (8 lô) mất
  // ~48s nếu chạy tuần tự, đủ để vượt quá thời gian chờ tối đa của 1 request
  // API route trên Vercel. Chạy song song rút thời gian chờ về gần bằng đúng
  // 1 lô duy nhất (các lô độc lập hoàn toàn, không cần thứ tự).
  const batches: TranslateItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  const batchResults = await Promise.all(batches.map((batch) => translateBatch(batch, lang)));

  const result: Record<string, Translated> = {};
  for (const batchResult of batchResults) Object.assign(result, batchResult);
  return result;
}

// Dùng cho báo giá (app/api/export-quote*/route.ts): sản phẩm nào đã có đủ
// ten_en/ten_zh + quy_cach_en/quy_cach_zh (dịch tay hoặc cache từ lần dịch
// trước) thì dùng lại luôn, không gọi API; sản phẩm nào thiếu (tên hoặc quy
// cách hiển thị chưa dịch) mới dịch lại cả 2, rồi lưu cache vào products để
// lần sau không dịch lại. Trả về mảng Product mới với ten_hang_hoa/quy_cach
// đã thay bằng bản dịch — quoteBuilder.ts/quoteExcelBuilder.ts không cần
// biết gì về ten_en/ten_zh/quy_cach_en/quy_cach_zh, chỉ đọc ten_hang_hoa/
// quy_cach như bình thường.
export async function resolveQuoteItemNames(
  items: Product[],
  lang: TranslateLang,
  quyCachTextOf: (p: Product) => string
): Promise<Product[]> {
  const nameField: "ten_en" | "ten_zh" = lang === "en" ? "ten_en" : "ten_zh";
  const quyCachField: "quy_cach_en" | "quy_cach_zh" = lang === "en" ? "quy_cach_en" : "quy_cach_zh";

  const missing = items.filter((p) => {
    const quyCachText = quyCachTextOf(p);
    return !p[nameField] || (quyCachText && !p[quyCachField]);
  });

  const translatedById = new Map<string, Translated>();
  if (missing.length > 0) {
    const translations = await translateItems(
      missing.map((p) => ({ id: p.id, name: p.ten_hang_hoa, quyCach: quyCachTextOf(p) })),
      lang
    );
    const supabase = supabaseAdmin();
    await Promise.all(
      Object.entries(translations).map(async ([id, t]) => {
        translatedById.set(id, t);
        const { error } = await supabase
          .from("products")
          .update({ [nameField]: t.name, [quyCachField]: t.quyCach || null })
          .eq("id", id);
        if (error) console.error(`Lưu cache dịch thất bại cho sản phẩm ${id}:`, error.message);
      })
    );
  }

  return items.map((p) => {
    const cached = translatedById.get(p.id);
    return {
      ...p,
      ten_hang_hoa: p[nameField] ?? cached?.name ?? p.ten_hang_hoa,
      [quyCachField]: p[quyCachField] ?? cached?.quyCach ?? p[quyCachField],
    };
  });
}
