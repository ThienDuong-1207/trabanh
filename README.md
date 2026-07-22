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

## Đồng bộ tự động từ Google Sheet

Thay vì bấm "Nhập từ Excel" thủ công, có thể sửa giá trực tiếp trên 1 Google Sheet (cùng cấu trúc:
1 tab theo mỗi nhóm hàng trong `CATEGORY_ORDER`, cùng tên cột) — web sẽ tự đọc và cập nhật vào
database mỗi giờ (`.github/workflows/sync-sheet.yml`, có thể đổi lịch bằng cách sửa dòng `cron` trong
file đó). Đây là kiểu **ghi đè** (Sheet luôn là nguồn đúng, ghi đè giá/tên trong database theo `Mã nội
bộ`) — không tự xóa sản phẩm nào dù bị xóa khỏi Sheet.

### Việc cần tự làm (không thể làm hộ vì cần tài khoản Google của bạn)

Dùng **API key** (không dùng Service Account) — vì Google Cloud mặc định chặn tạo Service Account
key ở hầu hết project mới (kể cả tài khoản cá nhân), API key không bị chặn bởi chính sách đó.
Đánh đổi: Sheet phải để chế độ chia sẻ **"Anyone with the link: Viewer"** — ai có link (hoặc đoán
được ID) cũng đọc được dữ liệu giá/sản phẩm (không sửa được), thay vì chỉ 1 tài khoản cụ thể mới
xem được.

1. Mở Google Sheet cần đồng bộ → **Share** → đổi sang **"Anyone with the link"**, quyền **Viewer**.
2. Vào https://console.cloud.google.com → tạo (hoặc chọn) 1 project → **APIs & Services → Library**
   → tìm bật **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → API key** → copy chuỗi key vừa tạo.
   (Khuyến khích bấm **Restrict Key** → **API restrictions** → chỉ chọn **Google Sheets API**, để
   key này không dùng được cho việc khác nếu lỡ lộ.)
4. Điền `GOOGLE_API_KEY` (key vừa tạo) và `GOOGLE_SHEET_ID` (đoạn giữa `/d/` và `/edit` trên URL
   Sheet, ví dụ `.../d/12BWeIZuYHPE1ZsM-TNNQ9KXsPZobB_VZ/edit...` thì ID là
   `12BWeIZuYHPE1ZsM-TNNQ9KXsPZobB_VZ`) vào `.env.local` (xem `.env.local.example`) để test ở máy
   bạn, và vào **Vercel → Project Settings → Environment Variables** để dùng khi deploy.
5. Nghĩ ra 1 chuỗi bất kỳ làm `SYNC_SECRET`, điền vào **cả 2 nơi**: biến môi trường ở Vercel, và
   **GitHub repo → Settings → Secrets and variables → Actions → New repository secret** (tên
   `SYNC_SECRET`).
6. Thêm 1 GitHub repo secret nữa tên `SYNC_ENDPOINT_URL`, giá trị là
   `https://<domain-vercel-cua-ban>/api/sync-sheet`.

Test thử ngay (không cần đợi lịch giờ): vào tab **Actions** trên GitHub → chọn workflow
"Sync products from Google Sheet" → **Run workflow**.

> Lưu ý: GitHub tự tắt lịch chạy tự động nếu repo không có commit nào suốt 60 ngày — thấy đồng bộ
> ngừng thì vào tab Actions bật lại là được.

## Đăng nhập & phân quyền

Web yêu cầu đăng nhập trước khi vào được — 3 vai trò: `sales` (thêm sản phẩm), `accountant`
(sửa giá trực tiếp), `admin` (toàn quyền). Ai đăng nhập lần đầu mà chưa được gán vai trò sẽ thấy màn
"Tài khoản chưa được cấp quyền" thay vì vào được app. Có 2 cách đăng nhập song song:

- **Google** — như trước, tự bootstrap qua SQL Editor (xem bên dưới).
- **Tài khoản/mật khẩu** — do Admin tạo trực tiếp trong web (mục "Quản lý người dùng" ở sidebar, chỉ Admin
  thấy). Admin đặt Tên đăng nhập + Tên hiển thị + Vai trò + 1 mật khẩu tạm (nút "Tạo ngẫu nhiên" tự sinh
  mật khẩu đạt quy tắc), rồi báo tên đăng nhập + mật khẩu tạm cho người đó qua kênh khác (chat/nói trực
  tiếp — không có email thật để gửi). Lần đăng nhập đầu tiên bằng mật khẩu tạm sẽ tự chuyển sang màn
  "Đặt mật khẩu mới", bắt buộc đặt mật khẩu mới trước khi vào app (mật khẩu cần: tối thiểu 8 ký tự, ký tự
  đầu viết hoa, có cả chữ và số, có ít nhất 1 ký tự đặc biệt). Nếu người dùng quên mật khẩu tạm, Admin bấm
  "Đặt lại mật khẩu" ngay ở dòng người đó.
  Lưu ý: tên đăng nhập được map ngầm sang 1 email nội bộ dạng `<username>@tiembanh.local` để tương thích
  với Supabase Auth (không phải email thật, không gửi mail đi) — thấy email này trong Supabase Dashboard
  là bình thường.
- **Phiên đăng nhập giữ vĩnh viễn** tới khi bấm "Đăng xuất" (hành vi mặc định của Supabase Auth, tự làm mới
  token ở `middleware.ts`) — nếu muốn giới hạn thêm, kiểm tra Supabase Dashboard → Authentication →
  Sessions.

### Việc cần tự làm (Google Cloud + Supabase Dashboard)

1. Google Cloud Console (dùng lại project đã tạo cho Sheets API) → **APIs & Services → Credentials
   → Create Credentials → OAuth client ID** → Application type: **Web application**.
2. Supabase Dashboard → **Authentication → Providers → Google** → bật lên, copy đúng **Callback URL**
   hiện ở đó (dạng `https://<project-ref>.supabase.co/auth/v1/callback`).
3. Quay lại Google Cloud, dán URL đó vào **Authorized redirect URIs** của OAuth client → Save → copy
   **Client ID** + **Client Secret** → dán ngược lại vào Supabase (bước 2) → Save.
4. Chạy lại `supabase/schema.sql` trong SQL Editor (đã thêm bảng `profiles` + chính sách phân quyền —
   an toàn chạy lại trên database đã có dữ liệu, không mất dữ liệu cũ).
5. **Bootstrap tài khoản Admin đầu tiên**: mở web, đăng nhập Google 1 lần (sẽ vào màn "chưa được cấp
   quyền") → vào Supabase SQL Editor chạy:
   ```sql
   update profiles set role = 'admin' where email = 'email-cua-ban@gmail.com';
   ```
   → tải lại trang là vào được với quyền admin. Gán quyền cho người khác tương tự, đổi
   `'admin'` thành `'sales'` hoặc `'accountant'`.

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
  api/sync-sheet/route.ts         - API đồng bộ từ Google Sheet (gọi định kỳ bởi GitHub Actions)
  api/products/route.ts           - API tạo sản phẩm mới
  api/products/[id]/route.ts      - API sửa / xóa 1 sản phẩm
lib/
  misaBuilder.ts          - Logic vá file MISA giữ nguyên byte gốc
  wordBuilder.ts          - Logic dựng file Word (3 vùng: tiêu đề/giá/mã vạch, đúng 7.7x4cm)
  categoryExportBuilder.ts - Dựng file Excel "theo loại", 1 sheet/nhóm hàng
  brandExportBuilder.ts   - Dựng file Excel "theo thương hiệu", 1 sheet/brand + sheet tổng quan
  excelImport.ts          - Đọc file Excel nhập hàng loạt, map cột → field, upsertProductRows() dùng chung
  googleSheetSync.ts      - Đọc Google Sheet (cùng map cột với excelImport.ts), gọi lại upsertProductRows()
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
