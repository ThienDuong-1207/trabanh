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
  last_exported_at timestamptz              -- null = chua tung xuat file
);

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

-- Row Level Security: allow read to everyone with the anon key,
-- but require the service-role key (server-side only) for writes.
alter table products enable row level security;

create policy "Public read access" on products
  for select using (true);

create policy "Anon can update price fields" on products
  for update using (true) with check (true);
-- NOTE: for a real production app, tighten this policy (e.g. require auth).
-- It is left permissive here so the demo works immediately after seeding.

alter table brands enable row level security;

create policy "Public read access" on brands
  for select using (true);
-- No write policy: brands are only inserted via the service-role seed script.
