-- IP 내부 ID 자동 발급과 미사용 초안 삭제 (S36-003 · S36-004 · 0901-X03, 원장 재작업 묶음 12 · ADR-0039).
--
-- 1. 공개 이력 원장 — private.ip_public_history. IP가 한 번이라도 공개된 적이 있으면 한 줄이 남는다.
--    published_at이 비어 있지 않게 되는 모든 쓰기(RPC·직접 SQL·seed)를 트리거가 기록하고, 이 migration이
--    기존 IP를 백필한다. 게시 상태 seam(#452, 2026-09-09 main) 전에는 저장하는 즉시 공개됐으므로 그 전에
--    만든 IP는 기록이 없어도 공개 이력이 있는 것으로 본다(기준 시각은 seam 뒤 첫 공개·비공개 감사 기록과
--    2026-09-10 00:00 KST 중 늦은 쪽 — 실제 배포 시각보다 이르면 공개됐던 IP를 지울 수 있게 되므로 늦은 쪽).
-- 2. 퇴역 ID — private.retired_ip_ids. 지운 초안의 내부 ID는 다시 발급하지 않는다. 감사·분석·쿠폰처럼 FK 없이
--    IP ID를 담은 기록이 새 IP를 가리키는 일이 없게 한다. 공개 URL은 공개된 적이 없으므로 다시 쓸 수 있다.
-- 3. public.admin_create_ip — 새 IP는 사람이 이름·공개 URL만 넣고, 내부 ID는 시스템이 공개 URL로 만든다.
--    다른 IP의 공개 URL·이전 URL·내부 ID와 같은 공개 URL은 거절한다(ip_public_slug_taken). 그래서 내부 ID에
--    -2·-3이 붙는 것은 공개 URL이 지운 IP의 내부 ID(퇴역 ID)와 같을 때뿐이다(다음 번호도 기존 ID·공개 URL·
--    이전 URL·퇴역 ID를 피한다). 이후 내부 ID는 바뀌지 않는다.
--    admin_upsert_ip의 신규 등록 경로(ID 직접 지정)는 기존 스크립트·테스트 호환용으로 남기되, 퇴역 ID는
--    삽입 트리거가 막는다(catalog_id_retired). 어드민 화면은 admin_create_ip만 쓴다.
-- 4. admin_update_ip_identity — 다른 IP의 내부 ID와 같은 공개 URL도 거절한다(링크 정규화가 ID와 공개
--    URL을 같은 이름 공간으로 읽기 때문). 기존 IP는 내부 ID가 언제나 자기 공개 URL이나 이전 URL이라
--    동작이 바뀌지 않는다.
-- 5. public.admin_ip_delete_readiness / public.admin_delete_draft_ip — 공개된 적 없는 초안이고, IP를 가리키는
--    모든 FK(굿즈·카드·카드풀·발급 정책·이벤트·홈 전시·팔로우·커뮤니티 글, 앞으로 생길 FK 포함)와 FK 없는
--    참조(쿠폰 대상 IP·주문 품목 IP 스냅샷·홈 전시 링크)가 0건일 때만 admin이 지운다. 같은 transaction에서
--    삭제 행 스냅샷·이전 URL·판단 근거를 감사 기록(catalog.ip.deleted)으로 남기고 ID를 퇴역시킨다.
--    공개된 적 없는 초안의 이전 URL 별칭은 공개 경로로 쓰인 적이 없어(익명 RLS·공개 해석기 모두 공개 IP만
--    본다) IP와 함께 지운다.
-- 6. 쿠폰 대상 IP — 쿠폰 저장 RPC는 대상 IP를 잠그지 않고 읽어(웨이브 1 T09가 고친 함수라 재정의하지 않는다),
--    삭제와 겹치면 지운 IP를 가리키는 쿠폰이 남을 수 있었다. coupons의 새 트리거가 이번 쓰기로 추가되는 대상
--    IP 행을 ID 순서로 FOR KEY SHARE 잠그고 모두 있는지 다시 확인한다. 삭제의 FOR UPDATE와 충돌하므로 어느
--    순서로 겹쳐도 한쪽이 다른 쪽의 커밋을 기다린 뒤 거절된다(coupon_target_ip_unavailable / ip_has_references).
begin;

-- 1. 공개 이력 원장 ---------------------------------------------------------------------------------
create table private.ip_public_history (
  ip_id text primary key references public.ips (id) on delete cascade,
  first_public_at timestamptz not null,
  evidence text not null check (evidence in ('published', 'publish_audit', 'legacy_default_public')),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
comment on table private.ip_public_history is
  'IP가 한 번이라도 공개된 적이 있다는 기록. admin_delete_draft_ip는 이 기록이 있는 IP를 지우지 않는다.';
alter table private.ip_public_history enable row level security;
revoke all on table private.ip_public_history from public, anon, authenticated, service_role;

with cutoff as (
  select greatest(
    timestamptz '2026-09-10 00:00:00+09',
    coalesce(pg_catalog.min(audit.created_at), timestamptz '2026-09-10 00:00:00+09')
  ) as at
  from public.audit_log as audit
  where audit.action in ('admin.ip.published', 'admin.ip.unpublished')
),
audit_first as (
  select pg_catalog.substr(audit.target, 5) as ip_id, pg_catalog.min(audit.created_at) as first_at
  from public.audit_log as audit
  where audit.action in ('admin.ip.published', 'admin.ip.unpublished')
    and audit.target like 'ips:%'
  group by 1
)
insert into private.ip_public_history (ip_id, first_public_at, evidence)
select
  ip.id,
  case
    when ip.created_at < cutoff.at then ip.created_at
    else least(ip.published_at, audit_first.first_at)
  end,
  case
    when ip.created_at < cutoff.at then 'legacy_default_public'
    when audit_first.first_at is not null
      and (ip.published_at is null or audit_first.first_at <= ip.published_at) then 'publish_audit'
    else 'published'
  end
from public.ips as ip
cross join cutoff
left join audit_first on audit_first.ip_id = ip.id
where ip.created_at < cutoff.at
   or ip.published_at is not null
   or audit_first.first_at is not null;

create function private.record_ip_public_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.ip_public_history (ip_id, first_public_at, evidence)
  values (new.id, new.published_at, 'published')
  on conflict (ip_id) do nothing;
  return null;
end;
$$;
revoke all on function private.record_ip_public_history() from public, anon, authenticated, service_role;

create trigger ips_record_public_history
after insert or update of published_at on public.ips
for each row when (new.published_at is not null)
execute function private.record_ip_public_history();

-- 2. 퇴역 ID ----------------------------------------------------------------------------------------
create table private.retired_ip_ids (
  id text primary key check (pg_catalog.btrim(id) <> ''),
  public_slug text not null,
  retired_at timestamptz not null default pg_catalog.clock_timestamp(),
  retired_by uuid,
  audit_log_id uuid not null
);
comment on table private.retired_ip_ids is
  'admin_delete_draft_ip로 지운 IP의 내부 ID. 다시 발급하지 않는다(삭제 감사 기록은 audit_log_id).';
alter table private.retired_ip_ids enable row level security;
revoke all on table private.retired_ip_ids from public, anon, authenticated, service_role;

-- 3. 새 IP 삽입 트리거: 생성 RPC만 내부 ID와 다른 공개 URL을 정할 수 있고, 퇴역 ID는 누구도 다시 쓰지 못한다 ---
create or replace function private.default_ip_public_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_public_slug text;
begin
  -- `admin_upsert_ip` uses INSERT ... ON CONFLICT(id) DO UPDATE. Its
  -- pre-existing call shape has no public_slug argument, so an update of a
  -- renamed IP must retain the current canonical value instead of treating
  -- the immutable id as a fresh slug candidate.
  select ip.public_slug
    into existing_public_slug
  from public.ips as ip
  where ip.id = new.id;
  if found then
    if new.public_slug is null then
      new.public_slug := existing_public_slug;
      return new;
    end if;
    if new.public_slug is distinct from existing_public_slug then
      raise insufficient_privilege using message = 'ip_public_slug_write_requires_rpc';
    end if;
    return new;
  end if;

  -- A direct INSERT may only derive public_slug from the new internal ID.
  -- admin_create_ip issues the internal ID from the requested public slug and
  -- marks its own insert, so only that RPC may store a different public slug.
  if new.public_slug is null then
    new.public_slug := new.id;
  elsif new.public_slug is distinct from new.id
    and coalesce(pg_catalog.current_setting('app.ip_public_slug_write', true), '') <> 'admin_create_ip'
  then
    raise insufficient_privilege using message = 'ip_public_slug_write_requires_rpc';
  end if;

  -- Only the namespace check for a genuinely new ID needs the global lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ip_public_slug_identity', 0)
  );
  -- A deleted draft's internal ID is never issued again (audit and FK-less
  -- references keep pointing at the deleted record, not at a new IP).
  if exists (
    select 1 from private.retired_ip_ids as retired where retired.id = new.id
  ) then
    raise unique_violation using message = 'catalog_id_retired';
  end if;
  if exists (
    select 1 from public.ips as ip where ip.public_slug = new.public_slug
  ) or exists (
    select 1 from public.ip_public_slug_aliases as alias where alias.slug = new.public_slug
  ) then
    raise unique_violation using message = 'ip_public_slug_taken';
  end if;
  return new;
end;
$$;
revoke all on function private.default_ip_public_slug() from public, anon, authenticated, service_role;

-- 4. 공개 URL 변경: 다른 IP의 내부 ID와 같은 주소도 거절한다(앵커 치환 — 권한·잠금·감사는 그대로) ------------
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('public.admin_update_ip_identity(text,text,text)'::regprocedure);
  anchor constant text := $anchor$    where ip.public_slug = target_public_slug
      and ip.id <> target_id$anchor$;
  replacement constant text := $replacement$    where (ip.public_slug = target_public_slug or ip.id = target_public_slug)
      and ip.id <> target_id$replacement$;
begin
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, anchor, '')))
     / pg_catalog.length(anchor) <> 1 then
    raise exception 'admin_update_ip_identity anchor must occur exactly once';
  end if;
  execute pg_catalog.replace(definition, anchor, replacement);
end;
$migration$;

-- 5. 새 IP 등록: 내부 ID 자동 발급 ------------------------------------------------------------------
create function public.admin_create_ip(
  target_public_slug text,
  target_title text,
  target_sub text,
  target_vertical_key text,
  target_tagline text,
  target_synopsis text,
  target_glyph text,
  target_bg text,
  target_image_path text,
  target_publish boolean default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  requested_slug text := pg_catalog.btrim(coalesce(target_public_slug, ''));
  requested_title text := pg_catalog.btrim(coalesce(target_title, ''));
  issued_id text;
  suffix integer := 1;
begin
  actor_id := private.require_operator_capability('platform.manage', false);

  if requested_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$' or requested_slug = 'aouad' then
    raise invalid_parameter_value using message = 'invalid_ip_public_slug';
  end if;
  if requested_title = '' then
    raise invalid_parameter_value using message = 'invalid_ip_title';
  end if;
  if target_vertical_key is null
     or not exists (select 1 from public.verticals as vertical where vertical.key = target_vertical_key)
  then
    raise invalid_parameter_value using message = 'invalid_ip_vertical';
  end if;

  -- Slug, alias and ID checks share the identity lock with admin_update_ip_identity,
  -- the insert trigger and admin_delete_draft_ip.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ip_public_slug_identity', 0)
  );
  if exists (
    select 1 from public.ips as ip
    where ip.public_slug = requested_slug or ip.id = requested_slug
  ) or exists (
    select 1 from public.ip_public_slug_aliases as alias where alias.slug = requested_slug
  ) then
    raise unique_violation using message = 'ip_public_slug_taken';
  end if;

  issued_id := requested_slug;
  while exists (
    select 1 from public.ips as ip where ip.id = issued_id or ip.public_slug = issued_id
  ) or exists (
    select 1 from public.ip_public_slug_aliases as alias where alias.slug = issued_id
  ) or exists (
    select 1 from private.retired_ip_ids as retired where retired.id = issued_id
  ) loop
    suffix := suffix + 1;
    issued_id := requested_slug || '-' || suffix::text;
  end loop;

  perform pg_catalog.set_config('app.ip_public_slug_write', 'admin_create_ip', true);
  insert into public.ips (
    id, public_slug, title, sub, vertical_key, tagline, synopsis, glyph, bg, image_path, featured
  )
  values (
    issued_id, requested_slug, requested_title, target_sub, target_vertical_key,
    target_tagline, target_synopsis, target_glyph, target_bg, target_image_path, false
  );
  perform pg_catalog.set_config('app.ip_public_slug_write', '', true);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.ip.upsert',
    'ips:' || issued_id,
    pg_catalog.jsonb_build_object(
      'id', issued_id,
      'title', requested_title,
      'vertical_key', target_vertical_key,
      'mode', 'create',
      'public_slug', requested_slug,
      'id_issued', true
    )
  );

  -- 게시 상태는 저장과 같은 transaction 에서 한 번만 전환하고 별도로 감사한다(admin_upsert_ip와 같다).
  if target_publish is not null then
    perform private.set_ip_published(issued_id, target_publish);
  end if;

  return issued_id;
end;
$$;
revoke all on function public.admin_create_ip(text, text, text, text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_create_ip(text, text, text, text, text, text, text, text, text, boolean)
  to authenticated;

-- 6. 삭제 가능 여부 ---------------------------------------------------------------------------------
-- 참조 수는 항상 같은 키로 돌려준다(0건도 근거로 보여 준다). IP를 가리키는 FK는 카탈로그에서 읽어 앞으로
-- 생기는 FK도 빠짐없이 센다 — 아는 표는 이름이 있는 키로, 모르는 표는 other로.
create function private.ip_delete_readiness(target_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  ip_row public.ips;
  alias_slugs text[];
  names text[];
  counts jsonb := pg_catalog.jsonb_build_object(
    'goods', 0, 'cards', 0, 'card_pools', 0, 'reward_policies', 0, 'events', 0,
    'home_curations', 0, 'coupons', 0, 'order_items', 0, 'ip_follows', 0, 'posts', 0, 'other', 0
  );
  reference record;
  reference_key text;
  reference_count bigint;
  reference_total bigint;
  public_history boolean;
  state text;
begin
  select * into ip_row from public.ips as ip where ip.id = target_id;
  if not found then
    return null;
  end if;

  state := case
    when ip_row.archived_at is not null then 'archived'
    when ip_row.published_at is not null then 'published'
    else 'draft'
  end;
  public_history := ip_row.published_at is not null
    or exists (select 1 from private.ip_public_history as history where history.ip_id = target_id)
    or exists (
      select 1 from public.audit_log as audit
      where audit.target = 'ips:' || target_id
        and audit.action in ('admin.ip.published', 'admin.ip.unpublished')
    );

  select coalesce(pg_catalog.array_agg(alias.slug order by alias.slug), '{}')
    into alias_slugs
  from public.ip_public_slug_aliases as alias
  where alias.ip_id = target_id;
  names := alias_slugs || array[target_id, ip_row.public_slug];

  for reference in
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      column_row.attname as column_name,
      referenced.attname as referenced_column
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    cross join lateral unnest(constraint_row.conkey, constraint_row.confkey) as pair(conkey, confkey)
    join pg_catalog.pg_attribute as column_row
      on column_row.attrelid = constraint_row.conrelid and column_row.attnum = pair.conkey
    join pg_catalog.pg_attribute as referenced
      on referenced.attrelid = constraint_row.confrelid and referenced.attnum = pair.confkey
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.ips'::regclass
      and referenced.attname in ('id', 'public_slug')
    order by 1, 2, 3
  loop
    reference_key := case reference.schema_name || '.' || reference.table_name
      when 'public.goods' then 'goods'
      when 'public.cards' then 'cards'
      when 'public.card_pools' then 'card_pools'
      when 'public.reward_policies' then 'reward_policies'
      when 'public.events' then 'events'
      when 'public.home_curations' then 'home_curations'
      when 'public.ip_follows' then 'ip_follows'
      when 'public.posts' then 'posts'
      -- The IP's own evidence and former URLs are not references to it.
      when 'private.ip_public_history' then null
      when 'public.ip_public_slug_aliases' then null
      else 'other'
    end;
    continue when reference_key is null;
    execute pg_catalog.format(
      'select pg_catalog.count(*) from %I.%I where %I = $1',
      reference.schema_name, reference.table_name, reference.column_name
    )
      into reference_count
      using case when reference.referenced_column = 'public_slug' then ip_row.public_slug else target_id end;
    counts := pg_catalog.jsonb_set(
      counts, array[reference_key],
      pg_catalog.to_jsonb((counts ->> reference_key)::bigint + reference_count)
    );
  end loop;

  select pg_catalog.count(*) into reference_count
  from public.coupons as coupon
  where target_id = any(coupon.target_ip_ids);
  counts := pg_catalog.jsonb_set(counts, '{coupons}', pg_catalog.to_jsonb(reference_count));

  select pg_catalog.count(*) into reference_count
  from public.order_items as item
  where item.good_ip_id_snapshot = target_id;
  counts := pg_catalog.jsonb_set(counts, '{order_items}', pg_catalog.to_jsonb(reference_count));

  -- Banners and curations that link to the IP page by path (rows bound by FK were counted above).
  select pg_catalog.count(*) into reference_count
  from public.home_curations as curation
  where curation.ip_id is distinct from target_id
    and curation.link_path is not null
    and (
      pg_catalog.substring(curation.link_path, '^/ip/([^/?#]+)') = any(names)
      or pg_catalog.substring(curation.link_path, '^/ip[?](?:[^#]*&)?ip=([^&#]+)') = any(names)
    );
  counts := pg_catalog.jsonb_set(
    counts, '{home_curations}',
    pg_catalog.to_jsonb((counts ->> 'home_curations')::bigint + reference_count)
  );

  select coalesce(pg_catalog.sum(entry.value::bigint), 0) into reference_total
  from pg_catalog.jsonb_each_text(counts) as entry;

  return pg_catalog.jsonb_build_object(
    'id', ip_row.id,
    'title', ip_row.title,
    'publicSlug', ip_row.public_slug,
    'state', state,
    'publicHistory', public_history,
    'aliases', pg_catalog.to_jsonb(alias_slugs),
    'references', counts,
    'referenceTotal', reference_total,
    'deletable', state = 'draft' and not public_history and reference_total = 0
  );
end;
$$;
revoke all on function private.ip_delete_readiness(text) from public, anon, authenticated, service_role;

create function public.admin_ip_delete_readiness(target_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if target_id is null or target_id !~ '^[a-z0-9][a-z0-9-]*$' then
    raise invalid_parameter_value using message = 'invalid_ip_id';
  end if;
  return private.ip_delete_readiness(target_id);
end;
$$;
revoke all on function public.admin_ip_delete_readiness(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_ip_delete_readiness(text) to authenticated;

-- 7. 미사용 초안 삭제 -------------------------------------------------------------------------------
create function public.admin_delete_draft_ip(target_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  ip_row public.ips;
  readiness jsonb;
  deletion_audit_id uuid;
begin
  -- 되돌릴 수 없는 물리 삭제라 legacy 운영에서는 admin만, 설정된 운영자 권한에서는 platform.manage만 연다.
  actor_id := private.require_operator_capability('platform.manage', true);
  if target_id is null or target_id !~ '^[a-z0-9][a-z0-9-]*$' then
    raise invalid_parameter_value using message = 'invalid_ip_id';
  end if;

  -- Identity lock first, then the row lock (same order as admin_update_ip_identity).
  -- The row lock blocks concurrent FK inserts (FOR KEY SHARE) and publish/archive writers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ip_public_slug_identity', 0)
  );
  select * into ip_row from public.ips as ip where ip.id = target_id for update of ip;
  if not found then
    -- A replay after a successful delete is a no-op, not a new audit event.
    if exists (select 1 from private.retired_ip_ids as retired where retired.id = target_id) then
      return false;
    end if;
    raise no_data_found using message = 'catalog_not_found';
  end if;

  readiness := private.ip_delete_readiness(target_id);
  if readiness ->> 'state' <> 'draft' then
    raise check_violation using message = 'ip_not_draft';
  end if;
  if (readiness ->> 'publicHistory')::boolean then
    raise check_violation using message = 'ip_has_public_history';
  end if;
  if (readiness ->> 'referenceTotal')::bigint <> 0 then
    raise check_violation using message = 'ip_has_references';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.ip.deleted',
    'ips:' || target_id,
    pg_catalog.jsonb_build_object(
      'snapshot', pg_catalog.to_jsonb(ip_row),
      'aliases', readiness -> 'aliases',
      'references', readiness -> 'references',
      'public_history', false,
      'retired_id', target_id
    )
  )
  returning id into deletion_audit_id;

  insert into private.retired_ip_ids (id, public_slug, retired_by, audit_log_id)
  values (target_id, ip_row.public_slug, actor_id, deletion_audit_id);

  delete from public.ip_public_slug_aliases where ip_id = target_id;
  delete from public.ips where id = target_id;
  return true;
end;
$$;
revoke all on function public.admin_delete_draft_ip(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_draft_ip(text) to authenticated;

-- 8. 쿠폰 대상 IP 잠금 ---------------------------------------------------------------------------------
-- 이번 쓰기로 추가되는 대상만 본다 — 기존 정의는 이미 가리키던 IP(보관 IP 포함)를 그대로 둘 수 있다(쿠폰 RPC와 같은 규칙).
create function private.lock_coupon_target_ips()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_ids text[] := '{}';
  added_ids text[];
  locked_count integer;
begin
  if tg_op = 'UPDATE' then
    previous_ids := coalesce(old.target_ip_ids, '{}');
  end if;
  select coalesce(pg_catalog.array_agg(distinct target.id order by target.id), '{}')
    into added_ids
  from pg_catalog.unnest(coalesce(new.target_ip_ids, '{}')) as target(id)
  where not target.id = any(previous_ids);
  if pg_catalog.cardinality(added_ids) = 0 then
    return new;
  end if;

  -- FOR KEY SHARE in ID order: an IP deletion (FOR UPDATE) either waits for this coupon to commit
  -- and then counts it as a reference, or commits first so that this write no longer finds the IP.
  select pg_catalog.count(*) into locked_count
  from (
    select ip.id
    from public.ips as ip
    where ip.id = any(added_ids)
    order by ip.id
    for key share of ip
  ) as kept;
  if locked_count <> pg_catalog.cardinality(added_ids) then
    raise check_violation using message = 'coupon_target_ip_unavailable';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_coupon_target_ips() from public, anon, authenticated, service_role;

create trigger coupons_lock_target_ips
before insert or update of target_ip_ids on public.coupons
for each row execute function private.lock_coupon_target_ips();

-- 운영자 RPC 계약(본문·실행 메타데이터 지문)은 권한을 정리한 뒤 등록한다.
select private.register_operator_rpc_contract('public.admin_update_ip_identity(text,text,text)'::regprocedure, 'platform.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_create_ip(text,text,text,text,text,text,text,text,text,boolean)'::regprocedure, 'platform.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_ip_delete_readiness(text)'::regprocedure, 'platform.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_delete_draft_ip(text)'::regprocedure, 'platform.manage', 'write', true);

commit;
