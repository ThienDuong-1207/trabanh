import { supabaseAdmin } from "./lib/supabaseServer";
import { upsertProductRows, ProductRow } from "./lib/excelImport";
import { applyFieldRequestDecision } from "./lib/productFieldRequests";

async function main() {
  const supabase = supabaseAdmin();
  const MA_A = "TEST-FIELDREQ-A";
  const MA_B = "TEST-FIELDREQ-B";

  // cleanup leftovers from a previous failed run, if any
  await supabase.from("products").delete().in("ma_noi_bo", [MA_A, MA_B]);

  const { error: insertErr } = await supabase.from("products").insert([
    { ma_noi_bo: MA_A, ten_hang_hoa: "Test Field Request A", category_sheet: "Mặt hàng khác", ma_vach: "TESTVACH-OLD-A" },
    { ma_noi_bo: MA_B, ten_hang_hoa: "Test Field Request B", category_sheet: "Mặt hàng khác", ma_vach: "TESTVACH-SHARED" },
  ]);
  if (insertErr) throw insertErr;
  console.log("Đã tạo 2 sản phẩm test.");

  // Import: A đề xuất đổi ma_vach thành đúng giá trị mà B đang giữ.
  const rows: ProductRow[] = [
    { category_sheet: "Mặt hàng khác", row_number: 2, ma_noi_bo: MA_A, ten_hang_hoa: "Test Field Request A", ma_vach: "TESTVACH-SHARED" },
  ];
  const summary = await upsertProductRows(rows, "update-all", null);
  console.log("fieldRequests trong summary:", JSON.stringify(summary.fieldRequests, null, 2));

  const { data: productA1 } = await supabase.from("products").select("ma_vach").eq("ma_noi_bo", MA_A).single();
  console.log("Mã vạch của A ngay sau import (phải VẪN LÀ giá trị cũ, chưa đổi):", productA1?.ma_vach);
  if (productA1?.ma_vach !== "TESTVACH-OLD-A") throw new Error("SAI: mã vạch A đã bị ghi đè ngay dù đang trùng!");

  const { data: pendingReq, error: fetchErr } = await supabase
    .from("product_field_requests")
    .select("*, product:products(ten_hang_hoa, ma_noi_bo)")
    .eq("status", "pending")
    .eq("field", "ma_vach")
    .eq("proposed_value", "TESTVACH-SHARED")
    .single();
  if (fetchErr) throw fetchErr;
  console.log("Yêu cầu chờ duyệt:", JSON.stringify(pendingReq, null, 2));
  if (pendingReq.conflict_ma_noi_bo !== MA_B) throw new Error("SAI: conflict_ma_noi_bo không đúng");
  if (pendingReq.old_value !== "TESTVACH-OLD-A") throw new Error("SAI: old_value không đúng");

  // Duyệt thử — B vẫn đang giữ TESTVACH-SHARED nên phải bị chặn lại đúng như thiết kế.
  try {
    await applyFieldRequestDecision(supabase, pendingReq, "approve", { userId: "00000000-0000-0000-0000-000000000000", displayName: "Test" }, null);
    throw new Error("SAI: lẽ ra phải báo lỗi vì B vẫn đang giữ giá trị này");
  } catch (e: any) {
    if (e.message.includes("lẽ ra")) throw e;
    console.log("Duyệt khi vẫn còn trùng bị chặn đúng như kỳ vọng:", e.message);
  }

  // Đổi mã vạch của B đi chỗ khác (mô phỏng việc đã giải quyết trùng), rồi duyệt lại — lần này phải thành công.
  await supabase.from("products").update({ ma_vach: "TESTVACH-B-MOVED" }).eq("ma_noi_bo", MA_B);
  const decided = await applyFieldRequestDecision(
    supabase,
    pendingReq,
    "approve",
    { userId: "00000000-0000-0000-0000-000000000000", displayName: "Test" },
    null
  );
  console.log("Duyệt thành công, status:", decided.status);

  const { data: productA2 } = await supabase.from("products").select("ma_vach").eq("ma_noi_bo", MA_A).single();
  console.log("Mã vạch của A sau khi duyệt (phải là TESTVACH-SHARED):", productA2?.ma_vach);
  if (productA2?.ma_vach !== "TESTVACH-SHARED") throw new Error("SAI: mã vạch A không được cập nhật sau khi duyệt");

  console.log("\n✅ TẤT CẢ KIỂM TRA ĐỀU ĐÚNG");

  await supabase.from("products").delete().in("ma_noi_bo", [MA_A, MA_B]);
  console.log("Đã dọn dẹp 2 sản phẩm test.");
}

main().then(() => process.exit(0)).catch((e) => { console.error("THẤT BẠI:", e); process.exit(1); });
