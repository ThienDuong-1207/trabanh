import { supabaseAdmin } from "./supabaseServer";
import { Product } from "./types";

// Dịch tên sản phẩm + quy cách đóng gói (tiếng Việt) sang tiếng Anh/Trung cho
// bảng báo giá (lib/quoteBuilder.ts) bằng Claude API — gộp cả 2 trường vào
// chung 1 lượt dịch mỗi sản phẩm (đỡ tốn thêm 1 lượt gọi riêng cho quy cách),
// kết quả cache lại vào products.ten_en/ten_zh + quy_cach_en/quy_cach_zh.
// Không dùng model nặng — text ngắn, Haiku là đủ.
export type TranslateLang = "en" | "zh";

type TranslateItem = { id: string; name: string; quyCach: string };
type Translated = { name: string; quyCach: string; nameOk: boolean; quyCachOk: boolean };

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8192;
// Dịch theo lô nhỏ thay vì gửi hết 1 lần — thực tế gặp lỗi thật: gửi 300 sản
// phẩm 1 lần bị cắt cụt giữa chừng (stop_reason "max_tokens", dù đã tăng
// max_tokens lên 8192 vẫn không đủ cho danh mục lớn), JSON trả về dở dang
// không đọc được. 40 sản phẩm/lô luôn nằm rất xa giới hạn output, đồng thời
// lô nào lỗi cũng không làm hỏng các lô khác đã dịch xong.
const BATCH_SIZE = 40;

// Phát hiện văn bản còn dấu tiếng Việt — dùng để nhận ra model "quên" dịch
// (trả nguyên văn tiếng Việt) chứ không phải do input vốn đã toàn tiếng Anh.
// Thực tế gặp lỗi thật: ~13% sản phẩm bị cache "bản dịch" giống hệt tên gốc
// (model bỏ sót không dịch tên dài/nhiều từ mô tả trong 1 lô lớn dù quy cách
// cùng dòng vẫn dịch đúng) — nếu không lọc, lỗi này bị cache VĨNH VIỄN vì
// logic "đã có ten_en thì không dịch lại" không phân biệt được "dịch đúng"
// với "dịch y hệt bản gốc".
const VIETNAMESE_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function looksUntranslated(original: string, translated: string): boolean {
  return original.trim() !== "" && translated.trim() === original.trim() && VIETNAMESE_DIACRITICS.test(original);
}

async function callClaude(prompt: string): Promise<{ text: string; stopReason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Thiếu biến môi trường ANTHROPIC_API_KEY");

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
  return { text: data.content?.[0]?.text ?? "", stopReason: data.stop_reason };
}

function parseTranslationJson(rawText: string, expectedCount: number, stopReason: string): { name: string; quyCach: string }[] {
  // Phòng trường hợp model vẫn bọc kết quả trong ```json ... ``` dù đã dặn không làm vậy.
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Không đọc được kết quả dịch (định dạng JSON không hợp lệ${stopReason === "max_tokens" ? ", có thể bị cắt cụt giữa chừng" : ""})`
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    throw new Error("Kết quả dịch không khớp số lượng sản phẩm đã gửi");
  }
  return parsed as { name: string; quyCach: string }[];
}

function buildPrompt(items: TranslateItem[], lang: TranslateLang, strict: boolean): string {
  const langLabel = lang === "en" ? "English" : "Simplified Chinese";
  const list = items.map((it, i) => `${i + 1}. name: "${it.name}" | specification: "${it.quyCach}"`).join("\n");

  return (
    `Translate the following Vietnamese retail product names and packaging specifications (from a tea/bakery ` +
    `supply shop) to ${langLabel}.\n` +
    "Rules:\n" +
    "- Keep brand names exactly as written — do NOT translate or transliterate proper nouns/brand names.\n" +
    "- Keep numbers and packaging sizes as-is (e.g. \"500G\", \"1KG\"); only translate unit/descriptor words " +
    "(e.g. \"Thùng\" -> case/box, \"gói\" -> pack, \"hộp\" -> box).\n" +
    "- Loanwords like \"Syrup\" should be translated too when translating to Chinese (e.g. \"糖浆\"), not left as-is.\n" +
    "- If a specification is an empty string, return it as an empty string too.\n" +
    (strict
      ? "- IMPORTANT: every \"name\" you were given still contains untranslated Vietnamese words — you MUST " +
        "actually translate the descriptive Vietnamese words in each one. Do NOT return the Vietnamese text " +
        "unchanged (only brand names/numbers may stay as-is).\n"
      : "") +
    "- Return ONLY a JSON array of objects, each shaped exactly as {\"name\": \"...\", \"quyCach\": \"...\"}, in the " +
    "same order and with the same count as the input list below — no explanation, no markdown code fence, no extra text.\n\n" +
    `Items:\n${list}`
  );
}

async function translateBatch(items: TranslateItem[], lang: TranslateLang): Promise<Record<string, Translated>> {
  const { text, stopReason } = await callClaude(buildPrompt(items, lang, false));
  const parsed = parseTranslationJson(text, items.length, stopReason);

  const result: Record<string, Translated> = {};
  const retryItems: TranslateItem[] = [];
  items.forEach((it, i) => {
    const t: Partial<{ name: string; quyCach: string }> = parsed[i] ?? {};
    const name = String(t.name ?? it.name);
    const quyCach = String(t.quyCach ?? "");
    const nameOk = !looksUntranslated(it.name, name);
    const quyCachOk = !looksUntranslated(it.quyCach, quyCach);
    result[it.id] = { name, quyCach, nameOk, quyCachOk };
    if (!nameOk || !quyCachOk) retryItems.push(it);
  });

  // Thử lại đúng 1 lần cho các mục model "quên" dịch — chỉ gửi lại đúng số ít
  // này (thường vài mục trong lô 40), kèm nhắc thẳng là input còn tiếng Việt
  // chưa dịch, tỉ lệ thành công cao hơn hẳn lần đầu.
  if (retryItems.length > 0) {
    try {
      const retry = await callClaude(buildPrompt(retryItems, lang, true));
      const retryParsed = parseTranslationJson(retry.text, retryItems.length, retry.stopReason);
      retryItems.forEach((it, i) => {
        const t: Partial<{ name: string; quyCach: string }> = retryParsed[i] ?? {};
        const prev = result[it.id];
        const name = prev.nameOk ? prev.name : String(t.name ?? prev.name);
        const quyCach = prev.quyCachOk ? prev.quyCach : String(t.quyCach ?? "");
        result[it.id] = {
          name,
          quyCach,
          nameOk: prev.nameOk || !looksUntranslated(it.name, name),
          quyCachOk: prev.quyCachOk || !looksUntranslated(it.quyCach, quyCach),
        };
      });
    } catch (e) {
      // Lần thử lại lỗi thì giữ nguyên kết quả lần đầu (nameOk/quyCachOk=false
      // cho các mục chưa dịch được) — không làm hỏng cả lô chỉ vì vài mục.
      console.error("Dịch lại (retry) thất bại:", e);
    }
  }

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
//
// Mục nào dịch "y hệt bản gốc" (model bỏ sót, xem looksUntranslated) sẽ
// KHÔNG được cache — vẫn dùng tạm cho đợt xuất này (không để trống), nhưng
// lần xuất báo giá sau sẽ tự dịch lại (không bị kẹt vĩnh viễn với bản dịch
// sai vì cột đã có giá trị).
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
        const update: Record<string, string | null> = {};
        if (t.nameOk) update[nameField] = t.name;
        if (t.quyCachOk) update[quyCachField] = t.quyCach || null;
        if (Object.keys(update).length === 0) return;
        const { error } = await supabase.from("products").update(update).eq("id", id);
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
