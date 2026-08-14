# Kế hoạch triển khai Website E-commerce — Trà & Bánh

> Tài liệu triển khai kỹ thuật, đi kèm với brief thiết kế UI/UX ở
> `documents/prompt_thiet_ke_uiux_website_ecommerce.md`. File đó trả lời
> "giao diện trông như thế nào", file này trả lời "xây bằng cách nào, theo
> thứ tự gì, dữ liệu nằm ở đâu".

## 1. Quyết định đã chốt

| Câu hỏi | Quyết định |
|---|---|
| Web bán hàng thật hay chỉ trưng bày? | **Bán hàng đầy đủ** — có giỏ hàng + thanh toán online |
| Domain | Dùng domain mặc định của Vercel trước, gắn domain riêng (`trabanh.com`) sau |
| Trang quản trị đơn hàng | **Dùng lại app misa-price-manager hiện tại** làm back-office — không xây hệ quản trị riêng |
| Tồn kho | **Phương án A** — bỏ qua tồn kho thời gian thực ở các phase đầu, xử lý thủ công nếu hết hàng. Có thể đổi sang phương án B (bổ sung tồn kho thật) nếu thấy cần trước khi bắt đầu Phase 2 |
| Cổng thanh toán | Bắt đầu bằng **chuyển khoản QR (VietQR)**, admin xác nhận thủ công — chưa đăng ký VNPay/MoMo ngay |
| Khách hàng cần đăng nhập để đặt hàng? | Không — **guest checkout** (chỉ nhập tên/SĐT/địa chỉ), tài khoản khách hàng để sau |

## 2. Kiến trúc tổng thể

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Website bán hàng (MỚI)      │        │  misa-price-manager (ĐÃ CÓ)    │
│  Next.js — dự án riêng       │        │  = trang quản trị/back-office │
│  Public, không cần đăng nhập │        │  Cần đăng nhập, phân quyền     │
│  để xem/mua hàng              │        │  Admin/Kế toán/Sales           │
└───────────────┬───────────────┘        └───────────────┬────────────────┘
                │ đọc products/brands (RLS public)         │ đọc/ghi đầy đủ
                │ ghi orders/order_items (RLS public insert)│ (đã có sẵn)
                ▼                                           ▼
         ┌─────────────────────────────────────────────────────────┐
         │              CÙNG 1 Supabase project (đã có)              │
         │  products, brands (đã có) — nguồn giá/sản phẩm duy nhất    │
         │  orders, order_items (MỚI) — đơn hàng từ website           │
         └─────────────────────────────────────────────────────────┘
```

**Vì sao dùng chung Supabase thay vì tách database riêng:** giá cập nhật ở
"Quản lý hàng hóa" phản ánh lên web ngay lập tức, không phải nhập liệu 2 lần,
không có nguy cơ 2 nguồn giá lệch nhau.

**Vì sao 2 dự án Next.js riêng (không gộp code):** mục đích và đối tượng
người dùng khác hẳn nhau (nội bộ có đăng nhập vs công khai cho khách) — gộp
chung sẽ làm phình to app hiện tại và tăng rủi ro khi deploy.

## 3. Ngăn xếp công nghệ

- **Next.js (App Router)** — cùng framework với app hiện tại, tái dùng kinh nghiệm/pattern đã quen.
- **Tailwind CSS** — hợp phong cách bo góc lớn, nhiều khoảng trắng trong brief thiết kế.
- **Supabase** — dùng chung project hiện có (Postgres + Auth + Storage cho ảnh sản phẩm nếu cần).
- **next/font** — nạp font Be Vietnam Pro theo đúng mục 3 của brief thiết kế.
- **Vercel** — hosting, domain mặc định `*.vercel.app` ở giai đoạn đầu.
- **VietQR API** (miễn phí, không cần đăng ký merchant) — sinh mã QR chuyển khoản kèm số tiền + nội dung đơn hàng.

## 4. Dữ liệu mới cần thêm vào Supabase

Không đụng vào bảng `products`/`brands` hiện có — chỉ thêm bảng mới:

```sql
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,        -- mã đơn hiển thị cho khách, vd DH20260812-001
  customer_name text not null,
  customer_phone text not null,
  customer_address text,
  note text,
  status text not null default 'cho_thanh_toan',
    -- cho_thanh_toan | da_thanh_toan | dang_xu_ly | dang_giao | hoan_thanh | huy
  payment_method text not null default 'chuyen_khoan', -- chuyen_khoan | cod
  total_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(id)
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  ten_hang_hoa text not null,   -- lưu lại tên tại thời điểm đặt, đề phòng sau này đổi tên sản phẩm
  don_vi text not null,         -- "lẻ" hoặc "thùng"
  don_gia numeric not null,     -- giá tại thời điểm đặt, không tham chiếu sống tới products.gia_ban
  so_luong int not null,
  thanh_tien numeric not null
);
```

**Chính sách RLS cần thêm:**
- `products`/`brands`: thêm 1 policy SELECT công khai (không cần đăng nhập), giới hạn qua 1 **view riêng** (vd `public_products`) chỉ lộ đúng các cột cần cho khách xem (tên, giá, đơn vị, nhóm hàng, ảnh) — không lộ cột nội bộ (mã NCC, ghi chú, giá vốn nếu có).
- `orders`/`order_items`: cho phép **INSERT công khai** (khách đặt hàng không cần đăng nhập), nhưng **SELECT chỉ cho phép** với người dùng đã đăng nhập có `role` hợp lệ trong `profiles` (dùng lại đúng điều kiện RLS đang áp cho các bảng nội bộ khác) — khách đặt xong không tự xem lại đơn của người khác được.

## 5. Các phase triển khai

### Phase 0 — Nền móng
- Khởi tạo dự án Next.js mới, kết nối Supabase hiện có.
- Tạo bảng `orders`, `order_items` + policy RLS ở mục 4.
- Tạo view `public_products` cho phép đọc công khai an toàn.
- Dựng token màu/font theo brief thiết kế (Tailwind config).
- Deploy khung trống lên Vercel, xác nhận build/deploy chạy được.

### Phase 1 — Trưng bày sản phẩm
- Trang chủ: header, hero, danh mục nhanh (dùng đúng `category_sheet` đã có), lưới sản phẩm nổi bật.
- Trang danh mục / lọc sản phẩm.
- Trang chi tiết sản phẩm.
- Chưa đặt hàng được — chỉ xem giá và thông tin.

### Phase 2 — Giỏ hàng + đặt hàng
- Giỏ hàng phía client (localStorage), không cần đăng nhập.
- Trang checkout: nhập tên/SĐT/địa chỉ/ghi chú → tạo bản ghi `orders` + `order_items`.
- Sinh mã QR VietQR kèm đúng số tiền + nội dung chuyển khoản theo mã đơn.
- Trang "Đặt hàng thành công" hiển thị mã đơn + QR để khách lưu lại.

### Phase 3 — Quản trị đơn hàng (trong app misa-price-manager hiện tại)
- Thêm mục "Đơn hàng website" vào sidebar, giới hạn theo role Admin/Kế toán (giống các mục nội bộ khác).
- Danh sách đơn mới nhất trước, xem chi tiết từng đơn.
- Nút xác nhận đã nhận thanh toán → đổi trạng thái, ghi `confirmed_by`/`confirmed_at`.
- Cập nhật trạng thái xử lý/giao hàng.
- Tận dụng hệ thống `activity_log`/`notifications` đã có để báo "có đơn hàng mới" cho Kế toán/Admin.

### Phase 4 — Hoàn thiện trải nghiệm
- Testimonial khách hàng (quán trà sữa/cà phê đã mua).
- Banner khuyến mãi/combo theo mùa.
- Rà lại responsive di động toàn site.
- SEO cơ bản (title/meta/sitemap, ảnh có alt text).

### Phase 5 — Sau này, khi có nhu cầu thật
- Gắn domain riêng (`trabanh.com`) thay domain Vercel mặc định.
- Tài khoản khách hàng — lưu lịch sử đơn, đặt lại nhanh.
- Nâng cấp cổng thanh toán tự động (VNPay/MoMo) nếu khối lượng đơn đủ lớn để đáng đăng ký merchant.
- Bổ sung tồn kho thật (nếu vẫn đang dùng phương án A) — thêm cột số lượng + UI cập nhật trong app quản trị.

## 6. Rủi ro / điều cần lưu ý khi triển khai

- Vì tồn kho chưa quản lý thời gian thực (phương án A), có khả năng khách đặt sản phẩm đã hết hàng — Phase 3 cần quy trình xử lý rõ ràng (gọi khách xác nhận đổi/hoàn) trước khi giao.
- Giá trong `order_items.don_gia` phải **lưu lại tại thời điểm đặt hàng**, không tham chiếu sống tới `products.gia_ban` — tránh trường hợp giá đổi sau khi khách đã đặt làm sai lệch số tiền đơn cũ.
- Cần ảnh sản phẩm thật (nền trắng, tỉ lệ vuông theo brief) trước khi làm Phase 1 — hiện chỉ có `logo.png` và 1 `banner.webp`, chưa có ảnh từng sản phẩm.
- Chính sách RLS cho phép ghi công khai vào `orders`/`order_items` cần kiểm tra kỹ để tránh bị lợi dụng gửi đơn rác (có thể cân nhắc thêm rate-limit hoặc xác minh SĐT ở phase sau).
