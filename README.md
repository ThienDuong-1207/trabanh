# Quản lý giá sản phẩm — Tiệm Trà Bánh

Web app quản lý toàn bộ thông tin sản phẩm (không chỉ giá), tự đánh dấu sản phẩm nào vừa đổi giá,
và xuất file MISA / bảng giá 7.7×4cm (Word) **chỉ cho đúng những sản phẩm đã đổi**, cùng 2 file
tham khảo "theo loại" / "theo thương hiệu" cho toàn bộ danh mục.

## Kiến trúc

- **Next.js 14** (App Router) — deploy trên Vercel
- **Supabase** — database Postgres, lưu toàn bộ sản phẩm + bảng `brands` (thương hiệu/NCC được coi là 1)
- **docx** (npm) — dựng file Word bảng giá, giữ nguyên công thức tính cỡ chữ đã tinh chỉnh
- **jszip** — vá trực tiếp file mẫu MISA gốc (giữ nguyên byte, không bị lỗi "not a valid template" khi mở lại)
- **exceljs** — đọc file Excel khi nhập hàng loạt, và dựng 2 file xuất "theo loại"/"theo thương hiệu"

## Cài đặt (chạy thử ở máy bạn trước khi deploy)

### 1. Tạo project Supabase
1. Vào https://supabase.com → New Project.
2. Vào **SQL Editor**, dán toàn bộ nội dung file `supabase/schema.sql` → Run.
3. Vào **Project Settings → API**, copy 3 giá trị: `Project URL`, `anon public key`, `service_role key`.

### 2. Cấu hình project
```bash
cp .env.local.example .env.local
# rồi mở .env.local, dán 3 giá trị vừa copy ở trên vào
```

### 3. Cài đặt & nạp dữ liệu ban đầu
```bash
npm install
npm run dev       # chạy thử ở http://localhost:3000
```
Mở web → bấm **"Nhập từ Excel"** → chọn file `Misa hàng hóa/1. Quản lý hàng hóa hợp nhất.xlsx`
(hoặc bất kỳ file nào cùng cấu trúc: 1 sheet theo mỗi nhóm hàng trong `CATEGORY_ORDER`) để nạp
toàn bộ sản phẩm + thương hiệu vào Supabase. Có thể bấm lại bất cứ lúc nào để nhập bổ sung/cập nhật
hàng loạt — sản phẩm trùng `Mã nội bộ` sẽ được cập nhật thay vì tạo trùng.

## Deploy lên Vercel

Cách nhanh nhất — dùng Claude Code (hoặc terminal bất kỳ):

```bash
# đẩy code lên GitHub
git init
git add .
git commit -m "Initial commit"
gh repo create ten-repo-cua-ban --private --source=. --push
# (hoặc tạo repo thủ công trên github.com rồi git remote add + push)

# deploy Vercel
npx vercel
# làm theo hướng dẫn, khi hỏi Environment Variables thì dán đúng 3 biến
# trong .env.local vào (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY)
```

Sau khi deploy xong, mọi lần đổi giá bạn chỉ cần mở đúng link Vercel đó —
không cần chat lại với Claude nữa.

## Cách dùng hằng ngày

**Sửa giá sản phẩm đã có:**
1. Mở web → tìm sản phẩm cần đổi giá → gõ giá mới, tự lưu ngay khi rời khỏi ô nhập.
2. Sản phẩm vừa đổi tự hiện ở tab **"Chờ xuất file"**.
3. Chọn các sản phẩm muốn xuất (hoặc bấm "Chọn tất cả đang hiện").
4. Bấm **"Xuất MISA"** để tải file .xlsx import thẳng lên MISA,
   hoặc **"Xuất bảng giá 7.7×4cm"** để tải file Word in tem giá — chỉ đúng các sản phẩm đã chọn.
5. Sau khi xuất, các sản phẩm đó tự chuyển khỏi tab "Chờ xuất file" (đến khi bạn đổi giá lần nữa).

**Thêm sản phẩm mới:** bấm **"+ Thêm sản phẩm"**, điền thông tin → Lưu. Sản phẩm mới tự hiện ở tab
"Chờ xuất file" giống như khi đổi giá — xuất MISA/Word cho riêng nó y hệt quy trình trên.

**Sửa/xóa thông tin đầy đủ:** bấm **"Sửa"**/**"Xóa"** ở cuối mỗi dòng trong bảng.

**Xuất báo cáo tham khảo toàn bộ danh mục:** bấm **"Xuất theo loại"** hoặc **"Xuất theo thương hiệu"**
ở đầu trang — luôn xuất toàn bộ sản phẩm hiện có (không phụ thuộc tab/lựa chọn), thay cho việc tự
làm tay các file `2. Danh sách theo loại sản phẩm.xlsx` / `3. Danh sách SP theo thương hiệu.xlsx`.

## Cấu trúc thư mục

```
app/
  page.tsx                       - Giao diện chính (bảng, tìm kiếm, thêm/sửa/xóa, nhập Excel, xuất file)
  api/export-misa/route.ts       - API xuất file MISA (chỉ sản phẩm đã chọn)
  api/export-word/route.ts       - API xuất file Word tem giá (chỉ sản phẩm đã chọn)
  api/export-by-category/route.ts - API xuất Excel theo nhóm hàng (toàn bộ danh mục)
  api/export-by-brand/route.ts    - API xuất Excel theo thương hiệu (toàn bộ danh mục)
  api/import-products/route.ts    - API nhập Excel hàng loạt (tạo mới + cập nhật theo Mã nội bộ)
  api/products/route.ts           - API tạo sản phẩm mới
  api/products/[id]/route.ts      - API sửa / xóa 1 sản phẩm
lib/
  misaBuilder.ts          - Logic vá file MISA giữ nguyên byte gốc
  wordBuilder.ts          - Logic dựng file Word (3 vùng: tiêu đề/giá/mã vạch, đúng 7.7x4cm)
  categoryExportBuilder.ts - Dựng file Excel "theo loại", 1 sheet/nhóm hàng
  brandExportBuilder.ts   - Dựng file Excel "theo thương hiệu", 1 sheet/brand + sheet tổng quan
  excelImport.ts          - Đọc file Excel nhập hàng loạt, map cột → field, upsert brands + products
  brands.ts               - Resolve-or-create 1 thương hiệu theo tên
  row6_template.json      - Style của từng cột trong file mẫu MISA (không tự sửa tay)
  types.ts                - Kiểu dữ liệu Product/ProductInput dùng chung
supabase/
  schema.sql - Câu lệnh tạo bảng (products + brands), chạy 1 lần trong Supabase SQL Editor
public/templates/
  Nhap_khau_hang_hoa_MISA.xlsx - File mẫu MISA gốc (không sửa file này)
  logo.png                     - Logo Trà & Bánh, dùng cho file Word
```

## Lưu ý quan trọng

- **Không sửa** `public/templates/Nhap_khau_hang_hoa_MISA.xlsx` hay `lib/row6_template.json` —
  đây là file mẫu gốc + bản đồ style, sửa sai sẽ làm hỏng cấu trúc byte khiến MISA từ chối import.
- Policy Supabase (`schema.sql`) hiện đang **cho phép sửa tự do** để chạy thử ngay được —
  nếu triển khai thật cho nhiều nhân viên dùng, nên thêm xác thực đăng nhập (Supabase Auth)
  và giới hạn quyền sửa lại.
- File Word xuất ra dùng đúng công thức tính cỡ chữ đã chốt qua nhiều lần chỉnh trong phiên làm việc
  (giá chiếm ~90% bề ngang khung, tiêu đề luôn dành 2 dòng, khối luôn đúng 7.7×4cm).
