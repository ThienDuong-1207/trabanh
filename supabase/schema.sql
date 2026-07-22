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
  ma_hang_hoa text,                         -- Ma hang hoa goc (NCC/POS)
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

-- Speeds up the "pending export" query (updated_at > last_exported_at)
create index if not exists idx_products_pending
  on products (updated_at, last_exported_at);

create index if not exists idx_products_category
  on products (category_sheet);

create index if not exists idx_products_brand
  on products (brand_id);

create index if not exists idx_products_search
  on products using gin (to_tsvector('simple', coalesce(ten_hang_hoa,'') || ' ' || coalesce(ten_hoa_don,'')));

-- Mã vạch / mã thùng must each be unique when present (many products don't
-- have one yet, so NULLs are excluded rather than enforced not-null).
create unique index if not exists idx_products_ma_vach_unique
  on products (ma_vach) where ma_vach is not null;

create unique index if not exists idx_products_ma_thung_unique
  on products (ma_thung) where ma_thung is not null;

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
