import fs from "fs";
const items = JSON.parse(fs.readFileSync("/tmp/tra_products.json", "utf-8"));
function label(ten) {
  const name = ten.toLowerCase();
  if (name.includes("hòa tan")) return "Trà Icetea";
  if (name.includes("túi lọc")) return "Trà gói";
  return "Trà rời";
}
const groups = {};
for (const p of items) {
  const g = label(p.ten_hang_hoa);
  (groups[g] ??= []).push(p.ten_hang_hoa);
}
for (const g of ["Trà rời", "Trà Icetea", "Trà gói"]) {
  console.log(`\n=== ${g} (${groups[g]?.length ?? 0}) ===`);
  (groups[g] ?? []).forEach(t => console.log(" ", t));
}
