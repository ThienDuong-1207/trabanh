-- Run this in the Supabase SQL editor once, before seeding data.

-- Brand and supplier are treated as the same entity for now (this shop buys
-- directly from the brand) — see products.brand_id below.
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  ma_noi_bo text unique not null,          -- Ma noi bo, format [Nhom]-[Thuong hieu]-[Ma NCC]
  ten_hang_hoa text not null,               -- Ten hang hoa (goc)
  ten_hoa_don text,                         -- Ten tren hoa don
  dvt text,                                 -- Don vi tinh
  gia_ban numeric,                          -- Gia ban le
  gia_thung numeric,                        -- Gia thung
  quy_cach text,                            -- Quy cach thung
  ty_le integer,                            -- Ty le quy doi
  brand_id uuid references brands(id),
  ma_hang_hoa text,                         -- Ma hang NCC — ma SKU rieng cua nha cung cap, doi chieu voi ho (khac ma_noi_bo, dung de dinh danh san pham trong he thong)
  ma_vach text,
  ma_thung text,
  ma_nhom_thay_the text,
  trang_thai text,
  ten_shopee text,
  ten_tiktok text,
  xuat_xu text,
  category_sheet text not null,             -- Tra, Sua tuoi, Sua dac, ... (nhom hang / sheet)
  updated_at timestamptz not null default now(),
  last_exported_at timestamptz,             -- null = chua tung xuat file
  is_draft boolean not null default false   -- true = Sales vua them, cho Ke toan hoan thien
);

alter table products add column if not exists is_draft boolean not null default false;

-- Cấp đóng gói trung gian (Hộp) cho số ít sản phẩm bán theo 3 cấp thay vì 2
-- (Gói/Túi → Hộp → Thùng, ví dụ Bột Rau Câu) — luôn để trống với sản phẩm
-- thường. dvt/gia_ban vẫn là cấp bán lẻ, quy_cach/ty_le/gia_thung vẫn là cấp
-- ngoài cùng (Thùng) như trước giờ, không đổi ý nghĩa.
alter table products add column if not exists dvt_cap_2 text;      -- Don vi cap 2 (Hop)
alter table products add column if not exists ty_le_cap_2 numeric; -- Ty le quy doi cap 2 (Goi/Tui -> Hop)
alter table products add column if not exists gia_hop numeric;     -- Gia Hop

-- Nha cung cap (ten) — doc tu file Excel truoc day bi bo qua truoc khi ghi DB,
-- gio luu that su theo yeu cau.
alter table products add column if not exists nha_cung_cap text;

-- Ngay tao san pham that su (khong phai updated_at, von bi ghi de moi lan sua).
-- Khong dat default now() o day: ALTER TABLE ADD COLUMN voi default lay gio
-- hien tai se stamp CUNG 1 gio chay migration cho toan bo hang cu co san, lam
-- sai lech thong ke "san pham moi trong thang" ngay hom chay. De null cho
-- hang cu (khong biet chinh xac ngay tao), code ung dung tu dat gia tri khi
-- them san pham moi (ca form tay lan nhap Excel/Google Sheet).
alter table products add column if not exists created_at timestamptz;

create index if not exists idx_products_created_at on products (created_at);

-- Speeds up the "pending export" query (updated_at > last_exported_at)
create index if not exists idx_products_pending
  on products (updated_at, last_exported_at);

create index if not exists idx_products_category
  on products (category_sheet);

create index if not exists idx_products_brand
  on products (brand_id);

create index if not exists idx_products_search
  on products using gin (to_tsvector('simple', coalesce(ten_hang_hoa,'') || ' ' || coalesce(ten_hoa_don,'')));

-- Mã vạch/Mã thùng KHÔNG còn bắt buộc duy nhất nữa — Mã nội bộ (ma_noi_bo,
-- ràng buộc unique ở cột products.ma_noi_bo phía trên) mới là định danh duy
-- nhất thật sự. Đã bỏ 2 unique index bên dưới theo yêu cầu (trước đây từng
-- bắt buộc duy nhất, dẫn tới cả cơ chế "Chờ duyệt Mã vạch/Mã thùng" — nay
-- không còn cần nữa, xem phần DROP TABLE product_field_requests bên dưới).
drop index if exists idx_products_ma_vach_unique;
drop index if exists idx_products_ma_thung_unique;

-- Auto-update updated_at whenever a row is modified — except when the only
-- change is last_exported_at (marking a product exported/synced isn't a data
-- edit; if updated_at also moved forward here, it would race ahead of the
-- last_exported_at value we just set and the product would look "pending"
-- again immediately).
create or replace function set_updated_at()
returns trigger as $$
begin
  if new.last_exported_at is distinct from old.last_exported_at then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row
  execute function set_updated_at();

-- Google-login users + role (Giai đoạn 1: đăng nhập + phân quyền).
-- role = null means "đã đăng nhập nhưng chưa được cấp quyền" — chặn ở
-- app/page.tsx (Server Component) và ở các policy dưới đây.
do $$ begin
  create type user_role as enum ('sales', 'accountant', 'admin');
exception
  when duplicate_object then null;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role user_role,
  created_at timestamptz not null default now()
);

-- Đăng nhập tài khoản/mật khẩu (song song Google) — username do Admin đặt
-- khi tạo tài khoản (xem app/api/users/route.ts); must_change_password bắt
-- buộc người dùng tự đặt mật khẩu mới ngay sau lần đăng nhập đầu bằng mật
-- khẩu tạm (xem app/page.tsx / app/set-password/page.tsx).
alter table profiles add column if not exists username text unique;
alter table profiles add column if not exists must_change_password boolean not null default false;

-- Tự tạo 1 profile (role = null) ngay khi ai đó đăng nhập Google lần đầu —
-- security definer vì thao tác insert này chạy trong ngữ cảnh chưa có role
-- gì cả, không thể tự thêm chính mình nếu bị RLS chặn.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles enable row level security;

drop policy if exists "Người đã đăng nhập đọc được danh sách profiles" on profiles;
create policy "Người đã đăng nhập đọc được danh sách profiles" on profiles
  for select using (auth.role() = 'authenticated');
-- Chưa có policy insert/update/delete từ client — gán quyền ban đầu làm thủ
-- công qua SQL Editor (xem README "Đăng nhập & phân quyền"); màn "Quản lý
-- người dùng" cho Admin tự gán quyền sẽ làm ở giai đoạn sau.

-- Row Level Security: chỉ người đã được cấp quyền (role khác null) mới đọc
-- được sản phẩm; sửa/thêm theo đúng vai trò.
alter table products enable row level security;

-- Xóa 2 policy cũ cho phép ai cũng đọc/sửa (nếu chạy lại script này trên
-- database đã có sẵn dữ liệu) — bắt buộc phải xóa, nếu không policy cũ
-- "using (true)" vẫn còn tồn tại song song và vô hiệu hóa hoàn toàn phân
-- quyền mới bên dưới (Postgres OR các permissive policy lại với nhau).
drop policy if exists "Public read access" on products;
drop policy if exists "Anon can update price fields" on products;
drop policy if exists "Người đã được cấp quyền đọc được sản phẩm" on products;
drop policy if exists "Kế toán/Admin sửa được sản phẩm" on products;
drop policy if exists "Sales/Admin thêm được sản phẩm mới" on products;

create policy "Người đã được cấp quyền đọc được sản phẩm" on products
  for select using (exists (select 1 from profiles where id = auth.uid() and role is not null));

create policy "Kế toán/Admin sửa được sản phẩm" on products
  for update
  using (exists (select 1 from profiles where id = auth.uid() and role in ('accountant', 'admin')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('accountant', 'admin')));

create policy "Sales/Admin thêm được sản phẩm mới" on products
  for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('sales', 'admin')));

alter table brands enable row level security;

drop policy if exists "Public read access" on brands;
create policy "Public read access" on brands
  for select using (true);
-- No write policy: brands are only inserted via the service-role seed script.

-- Price change history: captured automatically at the DB level (trigger,
-- not app code) so every price change is logged regardless of source —
-- manual web edit, "Cập nhật toàn bộ" Excel import, or any future write
-- path — without having to remember to log it in each one.
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  gia_ban_old numeric,
  gia_ban_new numeric,
  gia_thung_old numeric,
  gia_thung_new numeric,
  changed_at timestamptz not null default now()
);

create index if not exists idx_price_history_product
  on price_history (product_id);

create index if not exists idx_price_history_changed_at
  on price_history (changed_at desc);

-- security definer: without it, this runs as whichever role fired the
-- UPDATE — including the anon (browser) role for inline web edits — and its
-- insert into price_history gets blocked by RLS since that table has no
-- insert policy (deliberately, so only this trigger can write to it). With
-- security definer it always runs as the function's owner, bypassing RLS,
-- regardless of who edited the price.
create or replace function log_price_change()
returns trigger as $$
begin
  if new.gia_ban is distinct from old.gia_ban or new.gia_thung is distinct from old.gia_thung then
    insert into price_history (product_id, gia_ban_old, gia_ban_new, gia_thung_old, gia_thung_new)
    values (new.id, old.gia_ban, new.gia_ban, old.gia_thung, new.gia_thung);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_log_price_change on products;
create trigger trg_log_price_change
  after update on products
  for each row
  execute function log_price_change();

alter table price_history enable row level security;

drop policy if exists "Public read access" on price_history;
create policy "Public read access" on price_history
  for select using (true);
-- No write policy: rows are only ever inserted by the trigger above (which
-- runs with the privileges of the triggering statement), never by direct
-- client writes.

-- Giai đoạn 2: Sales (Hưng) không sửa giá trực tiếp — chỉ đề xuất, Kế toán/
-- Admin duyệt hoặc từ chối. Áp dụng đề xuất (ghi vào products.gia_ban/
-- gia_thung) luôn làm ở tầng API route (supabaseAdmin), không qua policy
-- update ở đây — bảng này chỉ cần insert (Sales tạo) + update trạng thái
-- (Kế toán/Admin duyệt), không cần policy update products thêm.
do $$ begin
  create type request_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

create table if not exists price_change_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  proposed_gia_ban numeric,
  proposed_gia_thung numeric,
  proposed_by uuid not null references profiles(id),
  status request_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_price_requests_status on price_change_requests(status);
create index if not exists idx_price_requests_product on price_change_requests(product_id);

-- Cho phép Admin xóa hẳn 1 tài khoản (app/api/users/[id]/route.ts DELETE) kể
-- cả khi tài khoản đó từng đề xuất/duyệt giá — mặc định "references profiles(id)"
-- không có "on delete" sẽ chặn xóa (foreign key violation) nếu còn dòng nào
-- tham chiếu tới. Đổi sang set null để giữ lại lịch sử đề xuất, chỉ mất liên
-- kết tới người đã bị xóa (giống cách activity_log.actor_id đã làm).
alter table price_change_requests alter column proposed_by drop not null;
alter table price_change_requests drop constraint if exists price_change_requests_proposed_by_fkey;
alter table price_change_requests add constraint price_change_requests_proposed_by_fkey
  foreign key (proposed_by) references profiles(id) on delete set null;
alter table price_change_requests drop constraint if exists price_change_requests_reviewed_by_fkey;
alter table price_change_requests add constraint price_change_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table price_change_requests enable row level security;

-- Mọi role (Sales/Kế toán/Admin) đều sửa giá qua đề xuất, không ai ghi thẳng
-- products nữa — nên bất kỳ ai đã được cấp quyền đều tạo được đề xuất của
-- chính mình (không riêng Sales như trước).
drop policy if exists "Sales tạo đề xuất của mình" on price_change_requests;
drop policy if exists "Người dùng tạo đề xuất của mình" on price_change_requests;
create policy "Người dùng tạo đề xuất của mình" on price_change_requests
  for insert
  with check (
    proposed_by = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role is not null)
  );

drop policy if exists "Xem đề xuất theo quyền" on price_change_requests;
create policy "Xem đề xuất theo quyền" on price_change_requests
  for select using (
    proposed_by = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role in ('accountant', 'admin'))
  );

-- Giai đoạn 3: Nhật ký hoạt động + thông báo. Ghi log làm ở tầng API route
-- (lib/activityLog.ts), không phải trigger DB — phần lớn write ở app này đi
-- qua supabaseAdmin() (service-role), nơi auth.uid() luôn null nên trigger
-- không thể biết ai là người thao tác.
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  action text not null,
  target_type text,
  target_id uuid,
  target_label text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_log_created_at on activity_log (created_at desc);

alter table activity_log enable row level security;

-- "Ai cũng xem được logs" — mọi người đã đăng nhập (không phân biệt vai trò)
-- đều đọc được toàn bộ nhật ký hoạt động.
drop policy if exists "Người đã đăng nhập xem được nhật ký hoạt động" on activity_log;
create policy "Người đã đăng nhập xem được nhật ký hoạt động" on activity_log
  for select using (auth.role() = 'authenticated');
-- Không có policy insert/update/delete — chỉ ghi qua supabaseAdmin().

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  activity_id uuid references activity_log(id) on delete cascade,
  message text not null,
  link_view text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on notifications (recipient_id, created_at desc);

alter table notifications enable row level security;

drop policy if exists "Nhận thông báo của chính mình" on notifications;
create policy "Nhận thông báo của chính mình" on notifications
  for select using (recipient_id = auth.uid());

-- Cho phép tự đánh dấu đã đọc trực tiếp từ client (update read_at) — cùng
-- kiểu "tự sửa trực tiếp qua Supabase client" đã dùng cho profiles/price_history.
drop policy if exists "Tự đánh dấu đã đọc thông báo của mình" on notifications;
create policy "Tự đánh dấu đã đọc thông báo của mình" on notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
-- Insert chỉ qua supabaseAdmin() (lib/activityLog.ts).

-- Bật Realtime (Postgres Changes) cho bảng notifications để chuông thông báo
-- nhận được ngay lập tức. Không idempotent theo cú pháp chuẩn (ALTER
-- PUBLICATION ... ADD TABLE báo lỗi nếu bảng đã là thành viên) — SQLSTATE
-- chính xác cho lỗi đó không cố định giữa các phiên bản Postgres nên bọc
-- "when others" thay vì chỉ bắt 1 mã lỗi cụ thể.
do $$ begin
  alter publication supabase_realtime add table notifications;
exception
  when others then null;
end $$;

-- Giai đoạn 4 (ĐÃ HUỶ): từng thêm bảng "chờ duyệt Mã vạch/Mã thùng" vì lúc đó
-- 2 trường này bắt buộc duy nhất. Nay Mã hàng hóa (ma_noi_bo) đã là định danh
-- duy nhất thật sự, Mã vạch/Mã thùng không cần duy nhất nữa — bỏ hẳn cơ chế
-- chờ duyệt này, không dùng lại. CẢNH BÁO: DROP TABLE bên dưới xoá vĩnh viễn
-- mọi lịch sử yêu cầu duyệt Mã vạch/Mã thùng đã có (nếu còn muốn giữ lại để
-- tra cứu, đừng chạy dòng này — comment lại và bỏ qua).
drop table if exists product_field_requests;

-- Giai đoạn 5 (bản sửa — combo giờ là 1 dòng products thật, không còn bảng
-- combos riêng): gói nhiều sản phẩm có sẵn lại với 1 tên + 1 giá bán riêng,
-- quản lý CHUNG với sản phẩm thường trong "Quản lý hàng hóa" (chọn, xuất báo
-- giá/bảng giá dùng thẳng các hàm build file đã có cho products, không cần
-- code riêng) — chỉ khác ở cờ is_combo=true. Không đồng bộ lên MISA: các
-- route xuất Nhập khẩu/Cập nhật MISA tự lọc bỏ is_combo=true trước khi build.
drop table if exists combos cascade;

alter table products add column if not exists is_combo boolean not null default false;

-- Giá gốc (tham khảo, để hiển thị gạch ngang) của combo — riêng combo mới có
-- ý nghĩa (giá gốc so với giá bán combo thực tế), không dùng cho sản phẩm
-- thường (không thuộc ProductInput, chỉ /api/combos* ghi cột này).
alter table products add column if not exists gia_goc numeric;

create table if not exists combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references products(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity numeric not null default 1
);

create index if not exists idx_combo_items_combo on combo_items(combo_id);
create index if not exists idx_combo_items_product on combo_items(product_id);

-- Combo được tạo/sửa/xóa qua các route /api/combos* (supabaseAdmin, bỏ qua
-- RLS) — bật RLS + 1 policy đọc chung cho combo_items chỉ để phòng sau này
-- có chỗ đọc thẳng từ client, không phải đường ghi chính.
alter table combo_items enable row level security;

drop policy if exists "Người đã được cấp quyền dùng combo_items" on combo_items;
create policy "Người đã được cấp quyền dùng combo_items" on combo_items
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role is not null))
  with check (exists (select 1 from profiles where id = auth.uid() and role is not null));

-- Giai đoạn 6: tên sản phẩm dịch sẵn (tiếng Anh/Trung) cho bảng báo giá
-- (lib/quoteBuilder.ts) — dịch tự động qua Claude API lúc xuất báo giá lần
-- đầu (lib/productTranslation.ts), lưu cache lại đây để lần sau không dịch
-- lại; vẫn sửa tay được bình thường qua form Sửa sản phẩm nếu máy dịch sai
-- tên thương hiệu/đơn vị, sửa xong sẽ không bị ghi đè lại nữa.
alter table products add column if not exists ten_en text;
alter table products add column if not exists ten_zh text;

-- Quy cách đóng gói dịch sẵn (chuỗi hiển thị hoàn chỉnh, vd "Case (10 packs)")
-- cho cột SPECIFICATION của báo giá tiếng Anh/Trung — cache tự động cùng lúc
-- với ten_en/ten_zh, không có ô sửa tay riêng (suy ra từ nhiều trường gốc
-- nên sửa 1 trường gốc không tự cập nhật lại bản dịch này).
alter table products add column if not exists quy_cach_en text;
alter table products add column if not exists quy_cach_zh text;

-- Giai đoạn 7: nhóm hàng chuyển từ danh sách cố định trong code (CATEGORY_ORDER
-- cũ) sang bảng riêng — import Excel gặp sheet chưa từng biết sẽ tự thêm 1
-- dòng vào đây (lib/categories.ts) thay vì bỏ qua sheet như trước, không cần
-- sửa code/deploy lại mỗi khi có nhóm hàng mới.
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  sort_order integer not null,       -- thứ tự dropdown/lọc/báo cáo chung
  quote_sort_order integer not null, -- thứ tự riêng cho bảng báo giá
  name_en text,                      -- cache dịch tiếng Anh cho báo giá — tự dịch lần đầu dùng
  name_zh text,                      -- cache dịch tiếng Trung
  misa_nhh_code text,                -- mã "Nhóm hàng hóa" bên MISA — null nếu chưa tạo bên MISA, điền tay sau
  created_at timestamptz not null default now()
);

create index if not exists idx_categories_sort_order on categories(sort_order);
create index if not exists idx_categories_quote_sort_order on categories(quote_sort_order);

alter table categories enable row level security;

drop policy if exists "Người đã đăng nhập đọc được nhóm hàng" on categories;
create policy "Người đã đăng nhập đọc được nhóm hàng" on categories
  for select using (auth.role() = 'authenticated');
-- Ghi (tự thêm nhóm mới lúc import, sửa mã MISA...) chỉ qua supabaseAdmin()
-- hoặc SQL Editor — không cần policy insert/update từ client.

-- Khởi tạo 12 nhóm hiện có, đúng thứ tự + bản dịch + mã MISA đang dùng trong
-- code trước khi chuyển sang bảng này. "Sốt" chưa có mã MISA (chưa tạo bên
-- MISA) — để trống, điền tay sau. "Công cụ dụng cụ" cố định sort_order cao
-- nhất (999) để luôn đứng cuối ở cả 2 thứ tự.
insert into categories (name, sort_order, quote_sort_order, name_en, name_zh, misa_nhh_code) values
  ('Trà', 10, 60, 'Tea', '茶', 'NHH000002'),
  ('Sữa tươi', 20, 20, 'Fresh Milk', '鲜奶', 'NHH000001'),
  ('Sữa đặc', 30, 30, 'Condensed Milk', '炼奶', 'NHH000003'),
  ('Kem đông lạnh', 40, 10, 'Ice Cream', '冰淇淋', 'NHH000009'),
  ('Syrup', 50, 70, 'Syrup', '糖浆', 'NHH000007'),
  ('Bột', 60, 40, 'Powder', '粉类', 'NHH000004'),
  ('Trân châu', 70, 50, 'Tapioca Pearls', '珍珠', 'NHH000008'),
  ('Mứt', 80, 80, 'Jam', '果酱', 'NHH000006'),
  ('Đồ lon', 90, 100, 'Canned Goods', '罐头食品', 'NHH000005'),
  ('Mặt hàng khác', 100, 110, 'Others', '其他商品', 'NHH000011'),
  ('Sốt', 110, 90, 'Sauce', '酱料', null),
  ('Công cụ dụng cụ', 999, 999, 'Tools & Equipment', '工具用具', 'NHH000010')
on conflict (name) do nothing;

-- Giai đoạn 8: ảnh sản phẩm — lưu URL ảnh trên Supabase Storage (bucket
-- product-photos, public đọc). Upload/xóa đi qua /api/products/[id]/photo bằng
-- service role (đã kiểm tra role ở tầng route), nên không cần policy ghi cho client.
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'image_url') then
    alter table products rename column image_url to photo_url;
  end if;
end $$;
alter table products add column if not exists photo_url text;

insert into storage.buckets (id, name, public) values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

drop policy if exists "Công khai đọc ảnh sản phẩm" on storage.objects;
create policy "Công khai đọc ảnh sản phẩm" on storage.objects
  for select using (bucket_id = 'product-photos');
