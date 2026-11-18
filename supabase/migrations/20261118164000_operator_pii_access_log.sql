-- 개인정보 접속기록(CUS-084·OPS-014·OPS-015).
--
-- 개인정보의 안전성 확보조치 기준 제8조: 개인정보취급자가 개인정보처리시스템에 접속한 기록(계정·접속일시·접속지·처리한
-- 정보주체·수행업무)을 보관하고 정기적으로 점검한다. 보관은 1년 이상, 5만 명 이상이거나 고유식별·민감정보를 처리하면
-- 2년 이상이다. 보수적으로 2년을 쓴다(ERP 읽기 접근 기록과 같은 기준, 20261109120000).
--
-- 무엇을 남기나: 어드민 고객 상세·주문 상세·주문 검색(이름·연락처·이메일 검색)·클레임 상세·클레임 연락처 원문·환불계좌
-- 원문 열람과 개인정보가 담긴 엑셀·출고지시 파일 내려받기, 그리고 이 기록 자체의 점검 열람·내려받기.
-- 개인정보 원문(이름·전화·주소·검색어)은 남기지 않는다. 대상은 회원·주문·클레임·배송 건·선물·리뷰 ID와 건수로 남긴다
-- (대량 내려받기는 ID 없이 건수와 기존 내려받기 감사 기록 번호만 남길 수 있다 — 조건은 그 감사 기록에 있다).
-- 접속지(IP)는 DB가 알 수 없다(PostgREST 앞단은 Next 서버다). 서버가 Vercel이 덮어쓰는 요청 헤더에서 읽어 넘긴다.
--
-- 쓰기: service_role만 부르는 public.service_record_operator_pii_access 하나. 행위자는 서버가 확인한 로그인 계정이다.
-- 운영자(owner 포함)·authenticated·service_role 모두 표를 직접 읽거나 고칠 수 없다(RLS + 권한 회수).
-- append-only: 트리거가 UPDATE·TRUNCATE를 막고, DELETE는 보관 기간이 지난 행만 허용한다(정리 cron이 그 길로 지운다).
--
-- 점검: 매니저 관리 권한(operators.manage — 통합·주매니저, 호환 단계 admin)만 public.admin_pii_access_log로 읽는다.
-- 읽기 RPC는 STABLE이라 PostgREST가 READ ONLY 트랜잭션으로 부른다 — 잠그는 private.require_operator_capability 대신
-- 잠금 없는 public.has_operator_capability(...)로 판정한다(cs_reply_read_transaction_mode). 점검 화면 열람·내려받기의
-- 기록은 서버가 같은 service 경로로 남긴다(IP가 필요해서).
--
-- 같은 화면을 다시 그리는 것(조회 조건 유지 새로고침·처리 후 재검증)은 10분 안에 같은 운영자·같은 화면·같은 대상·같은 접속지면
-- 한 번만 남긴다(열람·검색만. 내려받기·원문 확인·정정은 매번 남긴다). 상담 구매이력 열람 감사와 같은 원칙이다.
--
-- 이상 징후(단순 규칙, 점검 화면의 표시): 근무시간 외(KST 평일 08~21시 밖·주말), 대량(한 기록의 대상 1,000건 이상),
-- 몰아보기(같은 운영자가 같은 1시간에 상세·원문 50건 이상).

create table private.operator_pii_access_log (
  id bigint generated always as identity primary key,
  accessed_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  -- 기록 시점의 운영자 접근(통합·주·부매니저 등 역할, 호환 단계 legacy_admin·legacy_staff, 없으면 none).
  actor_access text not null check (actor_access ~ '^[a-z_]{1,32}$'),
  client_ip inet,
  action text not null check (action in ('view', 'search', 'export', 'reveal', 'correct')),
  surface text not null check (surface ~ '^[a-z][a-z_]{0,31}([.][a-z][a-z_]{0,31}){0,2}$'),
  -- 화면·경로만. 쿼리 문자열(검색어가 들어간다)은 받지 않는다.
  path text not null check (length(path) <= 300 and path ~ '^/(admin|api/admin)(/[A-Za-z0-9._~%-]+)*$'),
  subject_kind text not null check (subject_kind in ('member', 'order', 'claim', 'shipment', 'gift', 'review', 'none')),
  subject_ids uuid[] not null default '{}' check (cardinality(subject_ids) <= 1000 and array_position(subject_ids, null) is null),
  subject_count integer not null check (subject_count >= cardinality(subject_ids) and subject_count <= 1000000),
  -- 대상의 회원(주문·클레임·배송 건의 구매자와 선물 받는 사람, 선물의 보낸·받는 사람, 리뷰 작성자). '이 회원의 정보를 누가 봤나'를 한 번에 찾는다.
  member_ids uuid[] not null default '{}' check (cardinality(member_ids) <= 2000 and array_position(member_ids, null) is null),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2000),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  check (subject_kind <> 'none' or (cardinality(subject_ids) = 0 and subject_count = 0))
);
comment on table private.operator_pii_access_log is
  '개인정보 접속기록(안전성 확보조치 기준 제8조). append-only, 2년 보관. 개인정보 원문은 저장하지 않는다.';

create index operator_pii_access_log_at_idx on private.operator_pii_access_log (accessed_at desc, id desc);
create index operator_pii_access_log_actor_idx on private.operator_pii_access_log (actor_id, accessed_at desc);
create index operator_pii_access_log_subject_idx on private.operator_pii_access_log using gin (subject_ids);
create index operator_pii_access_log_member_idx on private.operator_pii_access_log using gin (member_ids);

alter table private.operator_pii_access_log enable row level security;
revoke all on private.operator_pii_access_log from public, anon, authenticated, service_role;

-- 보관 기간의 단일 진실원. 정리 cron과 삭제 트리거가 같은 값을 본다. 앱 상수(PII_ACCESS_LOG_RETENTION_YEARS)와 같다.
create function private.pii_access_log_retention()
returns interval language sql immutable set search_path = '' as $$ select interval '2 years' $$;

create function private.guard_pii_access_log_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.accessed_at < now() - private.pii_access_log_retention() then
    return old;
  end if;
  raise insufficient_privilege using message = 'pii_access_log_append_only';
end $$;

create function private.guard_pii_access_log_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise insufficient_privilege using message = 'pii_access_log_append_only';
end $$;

create trigger operator_pii_access_log_append_only
  before update or delete on private.operator_pii_access_log
  for each row execute function private.guard_pii_access_log_change();
create trigger operator_pii_access_log_no_truncate
  before truncate on private.operator_pii_access_log
  for each statement execute function private.guard_pii_access_log_truncate();

revoke all on function private.pii_access_log_retention() from public, anon, authenticated, service_role;
revoke all on function private.guard_pii_access_log_change() from public, anon, authenticated, service_role;
revoke all on function private.guard_pii_access_log_truncate() from public, anon, authenticated, service_role;

-- 기록. 서버(서비스 키)만 부른다. 행위자는 서버가 확인한 로그인 계정이고, 열람이 이미 일어난 뒤의 기록이라 권한을 다시
-- 판정해 거절하지 않는다(권한이 바뀐 직후의 열람도 남아야 한다). 계정이 실제로 있는지만 본다.
create function public.service_record_operator_pii_access(
  p_actor_id uuid,
  p_action text,
  p_surface text,
  p_path text,
  p_client_ip inet,
  p_subject_kind text,
  p_subject_ids uuid[],
  p_subject_count integer,
  p_detail jsonb
) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor public.profiles;
  access jsonb;
  access_label text;
  ids uuid[];
  members uuid[] := '{}';
  order_ids uuid[] := '{}';
  print text;
  existing bigint;
  recorded bigint;
begin
  select * into actor from public.profiles where id = p_actor_id;
  if p_actor_id is null or not found then
    raise insufficient_privilege using message = 'pii_access_actor_invalid';
  end if;
  if p_action is null or p_action not in ('view', 'search', 'export', 'reveal', 'correct') then
    raise invalid_parameter_value using message = 'pii_access_action_invalid';
  end if;
  if p_surface is null or p_surface !~ '^[a-z][a-z_]{0,31}([.][a-z][a-z_]{0,31}){0,2}$' then
    raise invalid_parameter_value using message = 'pii_access_surface_invalid';
  end if;
  if p_path is null or length(p_path) > 300 or p_path !~ '^/(admin|api/admin)(/[A-Za-z0-9._~%-]+)*$' then
    raise invalid_parameter_value using message = 'pii_access_path_invalid';
  end if;
  if p_subject_kind is null or p_subject_kind not in ('member', 'order', 'claim', 'shipment', 'gift', 'review', 'none') then
    raise invalid_parameter_value using message = 'pii_access_subject_invalid';
  end if;
  if p_subject_ids is not null and array_position(p_subject_ids, null) is not null then
    raise invalid_parameter_value using message = 'pii_access_subject_invalid';
  end if;
  select coalesce(array_agg(distinct s order by s), '{}') into ids from unnest(coalesce(p_subject_ids, '{}')) s;
  if cardinality(ids) > 1000 or p_subject_count is null or p_subject_count < cardinality(ids) or p_subject_count > 1000000
    or (p_subject_kind = 'none' and (cardinality(ids) > 0 or p_subject_count > 0)) then
    raise invalid_parameter_value using message = 'pii_access_subject_invalid';
  end if;
  -- 상세 값은 짧은 코드·숫자·참값만(화면 id·검색 유형·건수·감사 ID). 개인정보 원문이 들어올 길을 좁힌다.
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' or octet_length(p_detail::text) > 2000
    or exists (
      select 1 from jsonb_each(p_detail) d
      where d.key !~ '^[a-z][A-Za-z0-9]{0,39}$'
        or jsonb_typeof(d.value) not in ('string', 'number', 'boolean', 'null')
        or (jsonb_typeof(d.value) = 'string' and length(d.value #>> '{}') > 120)
    ) then
    raise invalid_parameter_value using message = 'pii_access_detail_invalid';
  end if;

  -- 대상의 회원: 주문·클레임·배송 건은 그 주문의 구매자와 선물 주문이면 받는 사람(배송지·연락처의 주인), 선물은 보낸 사람·받는 사람,
  -- 리뷰는 작성자. '이 회원의 정보를 누가 봤나'를 member_ids 하나로 찾는다(대상 1,000개에서 최대 2,000명).
  order_ids := case p_subject_kind
    when 'order' then ids
    when 'claim' then (select coalesce(array_agg(distinct c.order_id), '{}') from public.order_cancellation_requests c where c.id = any(ids))
    when 'shipment' then (select coalesce(array_agg(distinct s.order_id), '{}') from public.order_shipments s where s.id = any(ids))
    else '{}'::uuid[] end;
  members := case p_subject_kind
    when 'member' then ids
    when 'gift' then (select coalesce(array_agg(distinct m.id order by m.id), '{}')
      from private.gift_intents g cross join lateral unnest(array[g.sender_id, g.recipient_id]) as m(id)
      where g.id = any(ids) and m.id is not null)
    when 'review' then (select coalesce(array_agg(distinct r.user_id order by r.user_id), '{}') from public.reviews r
      where r.id = any(ids) and r.user_id is not null)
    else (select coalesce(array_agg(distinct x.id order by x.id), '{}') from (
        select o.user_id as id from public.orders o where o.id = any(order_ids)
        union select g.recipient_id from private.gift_intents g where g.order_id = any(order_ids)
      ) as x where x.id is not null)
    end;
  members := members[1:2000];

  access := private.operator_access_for(p_actor_id);
  access_label := case access->>'mode'
    when 'configured' then coalesce(access->>'managerRole', 'none')
    when 'legacy' then 'legacy_' || actor.role::text
    else 'none' end;

  print := md5(concat_ws('|', p_action, p_surface, p_path, p_subject_kind, ids::text, p_subject_count::text,
    p_detail::text, coalesce(host(p_client_ip), '')));
  if p_action in ('view', 'search') then
    select l.id into existing from private.operator_pii_access_log l
    where l.actor_id = p_actor_id and l.fingerprint = print and l.accessed_at > clock_timestamp() - interval '10 minutes'
    order by l.accessed_at desc, l.id desc limit 1;
    if found then
      return existing;
    end if;
  end if;

  insert into private.operator_pii_access_log (actor_id, actor_access, client_ip, action, surface, path, subject_kind,
    subject_ids, subject_count, member_ids, detail, fingerprint)
  values (p_actor_id, access_label, p_client_ip, p_action, p_surface, p_path, p_subject_kind,
    ids, p_subject_count, members, p_detail, print)
  returning id into recorded;
  return recorded;
end $$;

revoke all on function public.service_record_operator_pii_access(uuid, text, text, text, inet, text, uuid[], integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.service_record_operator_pii_access(uuid, text, text, text, inet, text, uuid[], integer, jsonb)
  to service_role;

-- 점검용 행 + 이상 징후. 몰아보기는 거르기 전에 그 기간의 같은 운영자·같은 KST 시간의 상세·원문 열람 수로 판정한다.
create function private.pii_access_log_entries(
  p_from date, p_to date, p_actor uuid, p_action text, p_surface text, p_subject uuid, p_flag text
) returns table (
  id bigint, accessed_at timestamptz, actor_id uuid, actor_access text, client_ip inet, action text, surface text,
  path text, subject_kind text, subject_ids uuid[], subject_count integer, member_ids uuid[], detail jsonb,
  off_hours boolean, bulk boolean, burst boolean
)
language sql stable security definer set search_path = '' as $$
  with ranged as (
    select l.*, (l.accessed_at at time zone 'Asia/Seoul') as local_at
    from private.operator_pii_access_log l
    where l.accessed_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and l.accessed_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  ), flagged as (
    select r.*,
      (extract(isodow from r.local_at) in (6, 7) or extract(hour from r.local_at) < 8 or extract(hour from r.local_at) >= 21) as is_off_hours,
      (r.subject_count >= 1000) as is_bulk,
      (r.action in ('view', 'reveal') and count(*) filter (where r.action in ('view', 'reveal'))
        over (partition by r.actor_id, date_trunc('hour', r.local_at)) >= 50) as is_burst
    from ranged r
  )
  select f.id, f.accessed_at, f.actor_id, f.actor_access, f.client_ip, f.action, f.surface, f.path, f.subject_kind,
    f.subject_ids, f.subject_count, f.member_ids, f.detail, f.is_off_hours, f.is_bulk, f.is_burst
  from flagged f
  where (p_actor is null or f.actor_id = p_actor)
    and (p_action is null or f.action = p_action)
    and (p_surface is null or f.surface = p_surface)
    and (p_subject is null or f.subject_ids @> array[p_subject] or f.member_ids @> array[p_subject])
    and (p_flag is null
      or (p_flag = 'any' and (f.is_off_hours or f.is_bulk or f.is_burst))
      or (p_flag = 'off_hours' and f.is_off_hours)
      or (p_flag = 'bulk' and f.is_bulk)
      or (p_flag = 'burst' and f.is_burst));
$$;
revoke all on function private.pii_access_log_entries(date, date, uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;

create function private.validate_pii_access_log_filters(
  p_from date, p_to date, p_action text, p_surface text, p_flag text
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise invalid_parameter_value using message = 'pii_access_log_range_invalid';
  end if;
  if (p_action is not null and p_action not in ('view', 'search', 'export', 'reveal', 'correct'))
    or (p_surface is not null and p_surface !~ '^[a-z][a-z_]{0,31}([.][a-z][a-z_]{0,31}){0,2}$')
    or (p_flag is not null and p_flag not in ('any', 'off_hours', 'bulk', 'burst')) then
    raise invalid_parameter_value using message = 'pii_access_log_filter_invalid';
  end if;
end $$;
revoke all on function private.validate_pii_access_log_filters(date, date, text, text, text)
  from public, anon, authenticated, service_role;

create function private.pii_access_log_actor_name(p_actor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(p.nickname), '') from public.profiles p where p.id = p_actor), '운영자_' || left(p_actor::text, 6));
$$;
revoke all on function private.pii_access_log_actor_name(uuid) from public, anon, authenticated, service_role;

-- 점검 화면 목록(50건씩, 최신순)과 같은 조건의 이상 징후 건수, 그 기간에 기록이 있는 운영자 목록.
create function public.admin_pii_access_log(
  p_from date, p_to date, p_actor uuid default null, p_action text default null, p_surface text default null,
  p_subject uuid default null, p_flag text default null, p_page integer default 1
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  page_size constant integer := 50;
  total bigint;
  page integer;
  items jsonb;
  summary jsonb;
  actors jsonb;
begin
  if not public.has_operator_capability('operators.manage', true) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  perform private.validate_pii_access_log_filters(p_from, p_to, p_action, p_surface, p_flag);

  select jsonb_build_object(
      'total', count(*),
      'offHours', count(*) filter (where e.off_hours),
      'bulk', count(*) filter (where e.bulk),
      'burst', count(*) filter (where e.burst),
      'flagged', count(*) filter (where e.off_hours or e.bulk or e.burst))
  into summary
  from private.pii_access_log_entries(p_from, p_to, p_actor, p_action, p_surface, p_subject, null) e;

  select count(*) into total from private.pii_access_log_entries(p_from, p_to, p_actor, p_action, p_surface, p_subject, p_flag);
  page := least(greatest(coalesce(p_page, 1), 1), greatest(1, ((total + page_size - 1) / page_size))::integer);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id::text,
      'at', e.accessed_at,
      'actorId', e.actor_id,
      'actorName', private.pii_access_log_actor_name(e.actor_id),
      'actorAccess', e.actor_access,
      'ip', host(e.client_ip),
      'action', e.action,
      'surface', e.surface,
      'path', e.path,
      'subjectKind', e.subject_kind,
      'subjectIds', to_jsonb(e.subject_ids[1:5]),
      'subjectCount', e.subject_count,
      'memberIds', to_jsonb(e.member_ids[1:5]),
      'memberCount', cardinality(e.member_ids),
      'detail', e.detail,
      'flags', to_jsonb(array_remove(array[
        case when e.off_hours then 'off_hours' end,
        case when e.bulk then 'bulk' end,
        case when e.burst then 'burst' end], null))
    ) order by e.accessed_at desc, e.id desc), '[]'::jsonb)
  into items
  from (
    select * from private.pii_access_log_entries(p_from, p_to, p_actor, p_action, p_surface, p_subject, p_flag) x
    order by x.accessed_at desc, x.id desc
    limit page_size offset (page - 1) * page_size
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.actor_id, 'name', private.pii_access_log_actor_name(a.actor_id),
      'count', a.entries) order by a.entries desc, a.actor_id), '[]'::jsonb)
  into actors
  from (
    select e.actor_id, count(*) as entries
    from private.pii_access_log_entries(p_from, p_to, null, null, null, null, null) e
    group by e.actor_id
  ) a;

  return jsonb_build_object('from', p_from, 'to', p_to, 'page', page, 'pageSize', page_size, 'total', total,
    'summary', summary, 'items', items, 'actors', actors);
end $$;

-- 점검 목록 엑셀. 같은 조건 최대 10,000건(넘으면 54000). 대상 ID는 최대 1,000개 그대로 넘기고 파일 칸에서 줄인다.
create function public.admin_export_pii_access_log(
  p_from date, p_to date, p_actor uuid default null, p_action text default null, p_surface text default null,
  p_subject uuid default null, p_flag text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  total bigint;
  result_rows jsonb;
begin
  if not public.has_operator_capability('operators.manage', true) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  perform private.validate_pii_access_log_filters(p_from, p_to, p_action, p_surface, p_flag);
  select count(*) into total from private.pii_access_log_entries(p_from, p_to, p_actor, p_action, p_surface, p_subject, p_flag);
  if total > 10000 then
    raise program_limit_exceeded using message = 'pii_access_log_export_limit';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id::text,
      'at', e.accessed_at,
      'actorId', e.actor_id,
      'actorName', private.pii_access_log_actor_name(e.actor_id),
      'actorAccess', e.actor_access,
      'ip', host(e.client_ip),
      'action', e.action,
      'surface', e.surface,
      'path', e.path,
      'subjectKind', e.subject_kind,
      'subjectIds', to_jsonb(e.subject_ids),
      'subjectCount', e.subject_count,
      'memberIds', to_jsonb(e.member_ids),
      'memberCount', cardinality(e.member_ids),
      'detail', e.detail,
      'flags', to_jsonb(array_remove(array[
        case when e.off_hours then 'off_hours' end,
        case when e.bulk then 'bulk' end,
        case when e.burst then 'burst' end], null))
    ) order by e.accessed_at desc, e.id desc), '[]'::jsonb)
  into result_rows
  from private.pii_access_log_entries(p_from, p_to, p_actor, p_action, p_surface, p_subject, p_flag) e;
  return jsonb_build_object('from', p_from, 'to', p_to, 'total', total, 'capturedAt', clock_timestamp(), 'rows', result_rows);
end $$;

revoke all on function public.admin_pii_access_log(date, date, uuid, text, text, uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_pii_access_log(date, date, uuid, text, text, uuid, text, integer) to authenticated;
revoke all on function public.admin_export_pii_access_log(date, date, uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_export_pii_access_log(date, date, uuid, text, text, uuid, text) to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_pii_access_log(date,date,uuid,text,text,uuid,text,integer)'::regprocedure, 'operators.manage', 'read', true);
select private.register_operator_rpc_contract(
  'public.admin_export_pii_access_log(date,date,uuid,text,text,uuid,text)'::regprocedure, 'operators.manage', 'read', true);

-- 보관 기간이 지난 기록 정리. 삭제 트리거가 같은 기준으로 그 행만 통과시킨다.
create function private.purge_pii_access_log()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from private.operator_pii_access_log where accessed_at < now() - private.pii_access_log_retention();
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function private.purge_pii_access_log() from public, anon, authenticated, service_role;

select cron.schedule('operator-pii-access-log-retention', '37 3 * * *', $job$select private.purge_pii_access_log()$job$);

-- ERP 데이터 읽기(20261109120000)는 public·private의 업무 표를 모두 내보낸다. 접속기록은 운영자 IP·열람 대상을 담은 보안 기록이라
-- ERP 읽기 접근 기록처럼 내보내지 않는다. 다른 제외 표를 건드리지 않게 마지막 이름 뒤에만 덧붙인다.
do $patch$
declare
  definition text := pg_get_functiondef('private.erp_read_tables()'::regprocedure);
  anchor constant text := $a$'erp_read_access_rollup'$a$;
begin
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'erp_read_tables anchor must appear once';
  end if;
  execute replace(definition, anchor, $r$'erp_read_access_rollup', 'operator_pii_access_log'$r$);
end $patch$;
select private.register_operator_internal_contract('private.erp_read_tables()'::regprocedure);

notify pgrst, 'reload schema';
