-- D-4 ① — 엑셀 양식 · 비동기 내보내기 원장 (설계서 v2 §1-7, 리서치 보고서 G §6)
--
-- 카페24의 「양식 저장 → 요청 → 큐 → 파일 다운로드」를 우리 스택으로 옮긴다. 화면이 파일을 직접 만들지 않고
-- 요청을 원장에 남기면 워커가 만든다 — 10만 행을 요청한 운영자의 브라우저가 기다리지 않아도 되고,
-- 무엇을 누가 왜 받아 갔는지가 남는다(고시 제2025-9호 §8 취급자 접속기록).
--
-- 시스템 양식 2종의 열 정의는 ERP 실화면에서 확인한 이름을 쓴다(2026-09-04):
--   `쇼핑몰주문내역출고처리`(44320006) 41열 · `쇼핑몰주문정산현황`(44320047) 29열.
--   사방넷·ERP 코드 열(품번코드(사방넷)·ERP 품번)은 저쪽이 채우는 열이라 우리는 몰 식별자만 싣는다.
--
-- 롤백: 표·enum drop(추가 전용). 앱 롤백만으로 읽기 경로 무손상.

create type public.export_target as enum ('orders', 'order_items', 'goods', 'stock', 'members');
create type public.export_status as enum ('queued', 'running', 'done', 'failed', 'expired', 'canceled');
create type public.export_security_level as enum ('normal', 'pii');

-- ---------------------------------------------------------------------------
-- 1. 권한 — 개인정보가 든 양식을 뽑을 수 있는 사람
-- ---------------------------------------------------------------------------
create table public.admin_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null check (permission in ('secure_export')),
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, permission)
);
comment on table public.admin_permissions is '스태프 위에 얹는 세부 권한. 지금은 개인정보 포함 내보내기 하나뿐이다.';

create or replace function private.is_admin_actor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'admin'
      and profile.suspended_at is null
  );
$$;
revoke all on function private.is_admin_actor() from public;
grant execute on function private.is_admin_actor() to authenticated;

create or replace function public.is_secure_exporter()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_permissions as permission
    where permission.user_id = (select auth.uid())
      and permission.permission = 'secure_export'
      and permission.revoked_at is null
  ) and public.is_staff();
$$;
revoke all on function public.is_secure_exporter() from public;
grant execute on function public.is_secure_exporter() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 양식 · 요청 · 다운로드 기록
-- ---------------------------------------------------------------------------
create table public.export_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 300),
  target public.export_target not null,
  columns jsonb not null,
  sort jsonb not null default '[]'::jsonb,
  default_filters jsonb not null default '{}'::jsonb,
  security_level public.export_security_level not null default 'normal',
  file_format text not null default 'csv' check (file_format in ('csv', 'xlsx')),
  is_system boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 100)
);
comment on column public.export_templates.columns is '[{key, header, mask, format}] — key 는 렌더러가 아는 열이어야 한다(앱 lib/admin/exports.ts 의 열 사전).';
comment on column public.export_templates.is_system is '시스템 양식은 고칠 수 없고 복제만 된다 — 창고·ERP 가 이 열 순서를 기대한다.';
create trigger trg_export_templates_updated before update on public.export_templates
  for each row execute function public.set_updated_at();

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  template_id uuid not null references public.export_templates (id),
  filters jsonb not null default '{}'::jsonb,
  status public.export_status not null default 'queued',
  requested_by uuid not null references public.profiles (id),
  reason text,
  attempts integer not null default 0,
  locked_at timestamptz,
  worker_id text,
  row_count integer,
  file_path text,
  file_bytes bigint,
  file_sha256 text,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.export_jobs is '내보내기 요청 원장. client_key 로 서버 액션 재시도가 같은 잡을 가리킨다.';
create index export_jobs_queue_idx on public.export_jobs (status, created_at) where status in ('queued', 'running');
create index export_jobs_requester_idx on public.export_jobs (requested_by, created_at desc);

create table public.export_download_logs (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.export_jobs (id),
  template_id uuid not null references public.export_templates (id),
  actor_id uuid not null references public.profiles (id),
  reason text not null,
  row_count integer,
  file_sha256 text,
  issued_at timestamptz not null default now(),
  url_expires_at timestamptz not null
);
comment on table public.export_download_logs is '누가 언제 무엇을 왜 받아 갔는지. 고시 제2025-9호 §8 취급자 접속기록(2년 보관) 대상.';
create index export_download_logs_actor_idx on public.export_download_logs (actor_id, issued_at desc);
create index export_download_logs_job_idx on public.export_download_logs (job_id);

-- 원장은 고치지도 지우지도 않는다(재고 이동 기록과 같은 규율).
create or replace function private.reject_download_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'export_download_logs_append_only' using errcode = '55000';
end;
$$;
create trigger export_download_logs_append_only before update or delete on public.export_download_logs
  for each row execute function private.reject_download_log_change();

-- ---------------------------------------------------------------------------
-- 3. RLS · 권한
-- ---------------------------------------------------------------------------
alter table public.admin_permissions enable row level security;
alter table public.export_templates enable row level security;
alter table public.export_jobs enable row level security;
alter table public.export_download_logs enable row level security;

create policy admin_permissions_read on public.admin_permissions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin_actor()));
create policy export_templates_read on public.export_templates for select to authenticated
  using ((select public.is_staff()));
-- 요청 목록은 본인 것과, 관리자에게 전부. 개인정보 양식의 존재 자체는 스태프에게 숨기지 않는다(사유·권한이 이미 게이트다).
create policy export_jobs_read on public.export_jobs for select to authenticated
  using (requested_by = (select auth.uid()) or (select private.is_admin_actor()));
create policy export_download_logs_read on public.export_download_logs for select to authenticated
  using ((select private.is_admin_actor()));

grant select on public.admin_permissions, public.export_templates, public.export_jobs, public.export_download_logs to authenticated;
revoke insert, update, delete, truncate on
  public.admin_permissions, public.export_templates, public.export_jobs, public.export_download_logs
from anon, authenticated;
revoke all on public.admin_permissions, public.export_templates, public.export_jobs, public.export_download_logs from anon;

-- ---------------------------------------------------------------------------
-- 4. 파일 보관함 — 비공개 버킷. 정책 0건(서명 URL·service role 만 닿는다).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-exports', 'admin-exports', false, 104857600,
  array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 5. 시스템 양식 2종 — 열 이름은 ERP 실화면에서 확인한 것(2026-09-04)
-- ---------------------------------------------------------------------------
insert into public.export_templates (key, name, description, target, columns, sort, security_level, file_format, is_system)
values
  (
    'picking_list',
    '출고지별 발주서',
    '창고가 물건을 꺼내는 순서로 만든 피킹 리스트. 택배사·송장번호 열을 비워 두고 그대로 되돌려 올리면 송장 회신이 된다.',
    'order_items',
    '[
      {"key": "location_name", "header": "출고지"},
      {"key": "shipment_group", "header": "배송번호"},
      {"key": "order_no", "header": "주문번호"},
      {"key": "item_no", "header": "품목주문번호"},
      {"key": "variant_code", "header": "자체 품목코드"},
      {"key": "good_name", "header": "상품명"},
      {"key": "option_summary", "header": "옵션"},
      {"key": "qty", "header": "수량", "format": "number"},
      {"key": "recipient_name", "header": "수취인명", "mask": "name"},
      {"key": "recipient_phone", "header": "연락처", "mask": "phone"},
      {"key": "recipient_postal_code", "header": "우편번호", "format": "text"},
      {"key": "recipient_address", "header": "주소", "mask": "address"},
      {"key": "delivery_note", "header": "배송메시지"},
      {"key": "box_kind", "header": "박스 구분"},
      {"key": "ship_by", "header": "발송예정일"},
      {"key": "carrier_label", "header": "택배사"},
      {"key": "tracking_number", "header": "송장번호"}
    ]'::jsonb,
    '[{"key": "location_name", "dir": "asc"}, {"key": "variant_code", "dir": "asc"}, {"key": "shipment_group", "dir": "asc"}, {"key": "order_no", "dir": "asc"}]'::jsonb,
    'pii',
    'csv',
    true
  ),
  (
    'sabangnet_orders',
    '사방넷 호환 주문 내보내기',
    'ERP 「쇼핑몰주문내역연동」이 읽는 자리에 넣는 양식. 사방넷·ERP 코드 열은 저쪽이 채우므로 우리는 몰 식별자와 배송 정보만 싣는다.',
    'order_items',
    '[
      {"key": "mall_name", "header": "쇼핑몰명"},
      {"key": "order_no", "header": "주문번호(쇼핑몰)"},
      {"key": "order_no", "header": "원주문번호(쇼핑몰)"},
      {"key": "item_no", "header": "부주문번호"},
      {"key": "ordered_at", "header": "주문일"},
      {"key": "order_kind", "header": "주문구분"},
      {"key": "good_id", "header": "상품코드(쇼핑몰)"},
      {"key": "good_name", "header": "ERP 품명"},
      {"key": "option_summary", "header": "규격"},
      {"key": "qty", "header": "주문수량", "format": "number"},
      {"key": "line_total", "header": "주문금액", "format": "number"},
      {"key": "paid_total", "header": "결제금액", "format": "number"},
      {"key": "orderer_name", "header": "주문자명", "mask": "name"},
      {"key": "orderer_phone", "header": "주문자핸드폰번호", "mask": "phone"},
      {"key": "recipient_name", "header": "수취인명", "mask": "name"},
      {"key": "recipient_postal_code", "header": "수취인우편번호", "format": "text"},
      {"key": "recipient_address", "header": "수취인주소", "mask": "address"},
      {"key": "recipient_phone", "header": "수취인핸드폰번호", "mask": "phone"},
      {"key": "delivery_note", "header": "배송메시지"},
      {"key": "carrier_label", "header": "택배사"},
      {"key": "tracking_number", "header": "송장번호"},
      {"key": "location_name", "header": "출고창고"}
    ]'::jsonb,
    '[{"key": "ordered_at", "dir": "asc"}, {"key": "order_no", "dir": "asc"}, {"key": "item_no", "dir": "asc"}]'::jsonb,
    'pii',
    'csv',
    true
  );
