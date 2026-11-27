-- 배송 안내 템플릿: 저장 한 번으로 끝낸다(2026-11-26 결정 — 저장 = 적용, 근거 칸 없음, 코드·버전은 손으로 적지 않는다).
--
-- 지금까지는 코드·버전을 손으로 적어 초안을 만들고 → '활성화 확인 근거'를 적어 활성화한 뒤 → 상품을 하나씩 찾아 적용했다.
-- 활성 템플릿은 고칠 수 없어 글자 하나를 고쳐도 같은 코드·더 큰 버전으로 다시 등록하고 상품마다 다시 적용해야 했다.
-- 상품은 템플릿을 따라가지 않는다 — 적용한 순간의 내용을 goods.shipping_notice_snapshot에 복사해 들고 있고,
-- 고객 화면(get_good_shipping_policy)은 그 복사본을 읽는다. 그래서 새 버전을 만들어도 상품을 다시 적용하기 전에는 고객 화면이 그대로였다.
--
-- 1. 테이블 검사: 활성 템플릿에 '확인 근거'가 있어야 한다는 조건을 뺀다. 필수 안내(배송·교환/반품 안내, 고객센터 이름, 전화나 이메일)와
--    확인 시각(confirmed_at)은 그대로 요구한다. 이미 저장된 근거 값은 지우지 않는다.
-- 2. public.admin_activate_shipping_notice_template: 근거(evidence) 없이도 활성화한다.
--    - 인자 시그니처와 나머지 조건(권한 catalog.manage, 초안만, 다른 사람이 먼저 바꿨을 때 PT409, 필수 안내)은 그대로다.
--    - 근거를 보내면 전처럼 저장하고(2000자·제어 문자 검사 유지), 보내지 않으면 저장돼 있던 값을 그대로 둔다.
-- 3. public.admin_list_shipping_notice_templates(새 조회): 템플릿마다 한 줄(코드별 가장 큰 버전)과 그 템플릿을 쓰는 상품 수.
--    - 화면은 버전을 보이지 않는다. 예전 버전은 목록에 따로 나오지 않는다.
--    - 상품 수는 보관하지 않은 상품 가운데 그 코드의 어느 버전이든 적용돼 있는 상품이다(아래 4번이 바꾸는 범위와 같다).
--    - p_code를 주면 그 코드 한 줄만 돌려준다(편집 창이 저장 직전에 지금 내용과 상품 수를 다시 읽는다).
-- 4. public.admin_save_and_apply_shipping_notice_template(새 저장): 저장·사용 시작·상품 반영을 한 트랜잭션에서 한다.
--    - 새 템플릿(p_template_id null): 코드를 작업 번호에서 자동으로 만들고(n-…) 버전 1로, 바로 상품에서 고를 수 있는 상태(active)로 넣는다.
--    - 고치기(p_template_id = 화면이 연 줄): 그 줄이 그 코드의 가장 큰 버전이고 그사이 바뀌지 않았을 때만 받는다(아니면 PT409).
--        · 아직 초안이면 그 줄을 받은 내용으로 고치고 active로 만든다.
--        · active면 고칠 수 없으므로(불변) 같은 코드·다음 버전으로 새 줄을 넣는다. 내용이 같으면 새 줄을 만들지 않는다.
--    - 그 코드의 예전 버전이 적용돼 있는 보관하지 않은 상품을 모두 새 내용으로 바꾼다(상품마다 admin_apply_shipping_notice_template을
--      부른 것과 같은 결과: 템플릿 id·버전·내용 복사본, 상품별 감사 기록). 보관한 상품은 그 함수와 같이 건드리지 않는다.
--    - 필수 안내가 비어 있으면 아무것도 저장하지 않는다(shipping_notice_template_required).
--    - p_operation(작업 번호)이 같은 저장을 다시 보내면 다시 처리하지 않고 처음 결과를 돌려준다. 내용이나 계정이 다르면 PT409.
--    - 감사 기록: catalog.shipping_notice_template.saved_and_applied(요청·결과·전후), 바뀐 상품마다
--      catalog.good.shipping_notice_template_applied(전후와 작업 번호).
-- 5. private.apply_shipping_notice_template_reference(상품 저장·상품 엑셀이 '코드·버전'으로 템플릿을 적용하는 내부 함수):
--    받은 버전이 아니라 그 코드의 지금 내용(가장 큰 active 버전)을 적용한다.
--    - 이제 템플릿은 '지금 내용 하나'이고 고치면 쓰는 상품이 모두 따라가며 화면은 버전을 보이지 않는다. 그런데 이 함수가 받은 버전을
--      그대로 적용하면, 템플릿을 고치기 전에 내려받은 상품 엑셀(옛 버전 번호가 적혀 있다)을 올린 상품만 고치기 전 안내로 조용히 돌아간다.
--    - 받은 (코드, 버전) 줄이 실제로 있는지는 전처럼 확인한다(없으면 shipping_notice_template_not_found).
--    - active 버전이 하나도 없는 코드(예전 방식의 초안만 있는 경우)는 전과 같다 — 받은 줄 그대로 넘겨 shipping_notice_template_not_active로 거절된다.
--    - 코드를 비워 보내면 템플릿을 떼는 것, 버전이 없으면 거절하는 것도 전과 같다.
-- 6. 상품에 템플릿을 붙이는 저장과 템플릿 저장(4번)을 줄 세운다.
--    public.admin_apply_shipping_notice_template(화면의 [상품에 적용] — 템플릿 줄의 id로 적용)과 5번(코드·버전으로 적용)의 본문을
--    private.apply_shipping_notice_template_current 하나로 모으고, 거기서 '그 코드의 지금 내용'을 읽기 전에 4번과 같은 코드 잠금을 잡는다.
--    - 왜: 4번은 저장하는 순간 '이미 그 템플릿을 쓰는 상품'만 새 내용으로 바꾼다. 그 템플릿을 처음 붙이는 저장이 4번과 겹치면
--      (최신인지 확인한 뒤 4번이 끼어들어 끝남) 그 상품만 고치기 전 내용을 받고도 성공으로 끝났다. 예전 버전 줄도 active로 남아 있기 때문이다.
--    - 어떻게: 상품이 지금 그 템플릿(코드)을 쓰고 있지 않으면, 4번이 독점으로 잡는 코드 잠금(pg_advisory_xact_lock)을 공유로 잡는다
--      (pg_advisory_xact_lock_shared — 붙이는 저장끼리는 서로 기다리지 않는다). 잠금을 얻은 뒤 새 문장으로 그 코드의 가장 큰 active 버전을 읽는다.
--        · 4번이 먼저면: 붙이는 저장은 4번이 끝날 때까지 기다렸다가 새 내용을 본다.
--        · 붙이는 저장이 먼저면: 4번은 그 저장이 끝날 때까지 기다렸다가 상품을 읽으므로 방금 붙은 상품도 새 내용으로 바꾼다.
--    - 상품이 이미 그 템플릿(코드의 어느 버전이든)을 쓰고 있으면 코드 잠금을 잡지 않는다. 4번이 그 상품을 반드시 읽어 바꾸기 때문에(상품 줄
--      잠금으로 만난다) 필요가 없고, 상품 줄을 든 채 코드 잠금을 기다리면 4번(코드 잠금 → 상품 줄)과 서로 기다리게 된다.
--    - id로 적용(화면): 넘어온 줄이 그 코드의 가장 큰 active 버전이 아니면 적용하지 않고 PT409 shipping_notice_template_conflict로 거절한다
--      (화면이 연 줄이 그사이 고쳐졌다). 초안 줄을 넘기면 전처럼 shipping_notice_template_not_active다.
--      코드·버전으로 적용(상품 저장·엑셀): 5번대로 가장 큰 active 버전을 적용한다.
--    - 남는 경우: 한 트랜잭션이 상품 여러 개를 저장하면서(엑셀 일괄 등록) 그 템플릿을 이미 쓰는 상품과 처음 붙이는 상품을 함께 다루고,
--      같은 순간 그 템플릿을 저장하면 서로 기다릴 수 있다. PostgreSQL이 1초 뒤 한쪽을 40P01(교착)로 끝내고 다른 쪽은 그대로 끝난다.
--      아무것도 반쯤 저장되지 않으며 다시 누르면 된다.
-- 주문·클레임은 이 안내 글을 복사해 두지 않는다(상품에만 있다). 주문 금액·배송비·승인된 회수 주소는 건드리지 않는다.
-- 템플릿 줄은 FOR NO KEY UPDATE로 잠근다(2번·4번) — 키(id, 코드·버전)를 바꾸지 않으므로, 상품에 템플릿을 붙이는 저장의 외래 키 확인
-- (FOR KEY SHARE)과 서로 기다리지 않는다. 템플릿을 고치는 저장끼리는 전처럼 서로 막는다.
-- 예전 저장 함수(admin_save_shipping_notice_template·_v2)는 그대로 둔다.
-- 상품 수정 화면과 상품 엑셀은 전처럼 코드·버전을 보내고, 버전은 '그 줄이 있는지'를 확인하는 데만 쓰인다.

do $$
declare
  targets text[];
begin
  select array_agg(conname) into targets
  from pg_constraint
  where conrelid = 'public.shipping_notice_templates'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%confirmed_at IS NOT NULL%';
  if coalesce(cardinality(targets), 0) <> 1 then
    raise exception 'shipping_notice_templates active check not found exactly once: %', targets;
  end if;
  execute format('alter table public.shipping_notice_templates drop constraint %I', targets[1]);
end $$;

alter table public.shipping_notice_templates add constraint shipping_notice_templates_active_required check (
  (status = 'draft') or (
    char_length(btrim(shipping_notice, E' \t\n\r')) > 0
    and char_length(btrim(return_exchange_notice, E' \t\n\r')) > 0
    and char_length(btrim(cs_name, E' \t\n\r')) > 0
    and (char_length(btrim(cs_phone, E' \t\n\r')) > 0 or char_length(btrim(cs_email, E' \t\n\r')) > 0)
    and confirmed_at is not null
  )
);

create or replace function public.admin_activate_shipping_notice_template(target_id uuid, expected_updated_at timestamp with time zone, evidence text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  previous public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  normalized_evidence text := btrim(coalesce(evidence, ''), E' \t\n\r');
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  -- 키(id, 코드·버전)를 바꾸지 않는 잠금이다. 상품에 템플릿을 붙이는 저장의 외래 키 확인과 서로 기다리지 않는다.
  select * into previous from public.shipping_notice_templates where id = target_id for no key update;
  if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
  if previous.status <> 'draft' then raise check_violation using message = 'shipping_notice_template_not_draft'; end if;
  if previous.updated_at is distinct from expected_updated_at then
    raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
  end if;
  -- 근거는 더는 필수가 아니다. 보냈을 때만 길이·제어 문자를 본다.
  if char_length(btrim(previous.shipping_notice, E' \t\n\r')) = 0
    or char_length(btrim(previous.return_exchange_notice, E' \t\n\r')) = 0
    or char_length(btrim(previous.cs_name, E' \t\n\r')) = 0
    or (char_length(btrim(previous.cs_phone, E' \t\n\r')) = 0 and char_length(btrim(previous.cs_email, E' \t\n\r')) = 0)
    or char_length(normalized_evidence) > 2000
    or private.has_disallowed_shipping_notice_control(normalized_evidence) then
    raise check_violation using message = 'shipping_notice_template_required';
  end if;
  -- 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다(없으면 빈 값).
  update public.shipping_notice_templates set
    status = 'active', confirmation_evidence = coalesce(nullif(normalized_evidence, ''), previous.confirmation_evidence),
    confirmed_by = actor, confirmed_at = clock_timestamp(),
    updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'catalog.shipping_notice_template.activated', 'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved)));
  return jsonb_build_object('id', saved.id, 'version', saved.version, 'updatedAt', saved.updated_at, 'status', saved.status);
end;
$function$;

create function public.admin_list_shipping_notice_templates(
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0,
  p_code text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  needle text := btrim(coalesce(p_query, ''), E' \t\n\r');
begin
  if (select auth.uid()) is null or not coalesce(public.has_operator_capability('catalog.read', false), false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
    or char_length(coalesce(p_query, '')) > 80 or char_length(coalesce(p_code, '')) > 40 then
    raise invalid_parameter_value using message = 'invalid_shipping_notice_template_page';
  end if;

  with latest as materialized (
    select distinct on (template.code) template.*
    from public.shipping_notice_templates template
    order by template.code, template.version desc
  ), matched as materialized (
    select latest.* from latest
    where case when p_code is not null then latest.code = p_code
      else needle = '' or latest.name ilike
        '%' || replace(replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\' end
  ), page as (
    select * from matched order by updated_at desc, code asc limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id, 'code', page.code, 'version', page.version, 'name', page.name,
        'shippingNotice', page.shipping_notice, 'returnExchangeNotice', page.return_exchange_notice,
        'remoteAreaNotice', page.remote_area_notice,
        'csName', page.cs_name, 'csPhone', page.cs_phone, 'csEmail', page.cs_email,
        'status', page.status, 'updatedAt', page.updated_at,
        'goodsCount', (
          select count(*) from public.goods good
          where good.archived_at is null and good.shipping_notice_template_id in (
            select version_row.id from public.shipping_notice_templates version_row where version_row.code = page.code
          )
        )
      ) order by page.updated_at desc, page.code asc)
      from page
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

create function public.admin_save_and_apply_shipping_notice_template(
  p_operation uuid,
  p_template_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_name text,
  p_shipping_notice text,
  p_return_exchange_notice text,
  p_remote_area_notice text,
  p_cs_name text,
  p_cs_phone text,
  p_cs_email text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  prior public.audit_log;
  request jsonb;
  result jsonb;
  opened public.shipping_notice_templates;
  latest public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  next_snapshot jsonb;
  previous_version_ids uuid[];
  applied_goods integer := 0;
  content_changed boolean := true;
  normalized_name text := btrim(coalesce(p_name, ''), E' \t\n\r');
  normalized_shipping text := btrim(coalesce(p_shipping_notice, ''), E' \t\n\r');
  normalized_return_exchange text := btrim(coalesce(p_return_exchange_notice, ''), E' \t\n\r');
  normalized_remote_area text := btrim(coalesce(p_remote_area_notice, ''), E' \t\n\r');
  normalized_cs_name text := btrim(coalesce(p_cs_name, ''), E' \t\n\r');
  normalized_cs_phone text := btrim(coalesce(p_cs_phone, ''), E' \t\n\r');
  normalized_cs_email text := btrim(coalesce(p_cs_email, ''), E' \t\n\r');
begin
  perform private.require_operator_capability('catalog.manage', false);

  if actor is null or not public.has_operator_capability('catalog.manage', false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if p_operation is null
    or ((p_template_id is null) <> (p_expected_updated_at is null))
    or char_length(normalized_name) not between 1 and 80
    or char_length(normalized_shipping) > 4000 or char_length(normalized_return_exchange) > 4000
    or char_length(normalized_remote_area) > 4000
    or char_length(normalized_cs_name) > 120 or char_length(normalized_cs_phone) > 80
    or char_length(normalized_cs_email) > 320
    or private.has_disallowed_shipping_notice_control(normalized_name)
    or private.has_disallowed_shipping_notice_control(normalized_shipping)
    or private.has_disallowed_shipping_notice_control(normalized_return_exchange)
    or private.has_disallowed_shipping_notice_control(normalized_remote_area)
    or private.has_disallowed_shipping_notice_control(normalized_cs_name)
    or private.has_disallowed_shipping_notice_control(normalized_cs_phone)
    or private.has_disallowed_shipping_notice_control(normalized_cs_email)
  then
    raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
  end if;
  -- 저장하면 바로 상품에서 고를 수 있으므로, 고객에게 보일 필수 안내가 모두 있어야 한다.
  if char_length(normalized_shipping) = 0 or char_length(normalized_return_exchange) = 0
    or char_length(normalized_cs_name) = 0
    or (char_length(normalized_cs_phone) = 0 and char_length(normalized_cs_email) = 0) then
    raise check_violation using message = 'shipping_notice_template_required';
  end if;

  -- 같은 작업 번호의 저장은 한 줄로 세운다. 먼저 끝난 저장의 결과를 뒤따른 호출이 그대로 받는다.
  perform pg_advisory_xact_lock(hashtextextended('shipping_notice_template_operation:' || p_operation::text, 0));
  request := jsonb_build_object(
    'templateId', p_template_id,
    'expectedUpdatedAt', to_char(p_expected_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'name', normalized_name, 'shippingNotice', normalized_shipping, 'returnExchangeNotice', normalized_return_exchange,
    'remoteAreaNotice', normalized_remote_area,
    'csName', normalized_cs_name, 'csPhone', normalized_cs_phone, 'csEmail', normalized_cs_email
  );
  select * into prior from public.audit_log where id = p_operation;
  if found then
    if prior.actor_id is distinct from actor
      or prior.action <> 'catalog.shipping_notice_template.saved_and_applied'
      or prior.diff->'request' is distinct from request then
      raise exception using errcode = 'PT409', message = 'shipping_notice_template_operation_mismatch';
    end if;
    return prior.diff->'result';
  end if;

  if p_template_id is null then
    insert into public.shipping_notice_templates(
      code, version, name, shipping_notice, return_exchange_notice, remote_area_notice,
      cs_name, cs_phone, cs_email, status, confirmed_by, confirmed_at
    ) values (
      'n-' || substr(replace(p_operation::text, '-', ''), 1, 12), 1, normalized_name, normalized_shipping,
      normalized_return_exchange, normalized_remote_area, normalized_cs_name, normalized_cs_phone, normalized_cs_email,
      'active', actor, clock_timestamp()
    ) returning * into saved;
  else
    select * into opened from public.shipping_notice_templates where id = p_template_id;
    if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
    -- 같은 템플릿(코드)을 동시에 고치는 저장을 한 줄로 세운 뒤, 지금의 가장 큰 버전을 다시 읽는다.
    -- 이 템플릿을 상품에 처음 붙이는 저장(private.apply_shipping_notice_template_current)은 같은 잠금을 공유로 잡는다. 그 저장이 끝난 뒤에야
    -- 이 저장이 아래에서 상품을 읽으므로 방금 붙은 상품도 새 내용으로 바뀌고, 이 저장이 먼저면 그쪽이 기다렸다가 새 내용을 본다.
    -- 줄은 FOR NO KEY UPDATE로 잠근다. FOR UPDATE면, 뒤처진 상품에 이 줄을 다시 붙이던 다른 저장(상품 잠금 → 이 줄 FOR KEY SHARE)과
    -- 이 저장(이 줄 잠금 → 상품 잠금)이 서로 기다려 한쪽이 교착으로 실패할 수 있다.
    perform pg_advisory_xact_lock(hashtextextended('shipping_notice_template:' || opened.code, 0));
    select * into latest from public.shipping_notice_templates
      where code = opened.code order by version desc limit 1 for no key update;
    if latest.id <> opened.id or latest.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
    end if;
    if latest.status = 'draft' then
      update public.shipping_notice_templates set
        name = normalized_name,
        shipping_notice = normalized_shipping,
        return_exchange_notice = normalized_return_exchange,
        remote_area_notice = normalized_remote_area,
        cs_name = normalized_cs_name,
        cs_phone = normalized_cs_phone,
        cs_email = normalized_cs_email,
        status = 'active', confirmed_by = actor, confirmed_at = clock_timestamp(),
        updated_at = greatest(clock_timestamp(), latest.updated_at + interval '1 microsecond')
        where id = latest.id returning * into saved;
    elsif (latest.name, latest.shipping_notice, latest.return_exchange_notice, latest.remote_area_notice,
        latest.cs_name, latest.cs_phone, latest.cs_email)
      is distinct from (normalized_name, normalized_shipping, normalized_return_exchange, normalized_remote_area,
        normalized_cs_name, normalized_cs_phone, normalized_cs_email) then
      if latest.version >= 1000000 then
        raise check_violation using message = 'shipping_notice_template_version_exhausted';
      end if;
      insert into public.shipping_notice_templates(
        code, version, name, shipping_notice, return_exchange_notice, remote_area_notice,
        cs_name, cs_phone, cs_email, status, confirmed_by, confirmed_at
      ) values (
        latest.code, latest.version + 1, normalized_name, normalized_shipping,
        normalized_return_exchange, normalized_remote_area, normalized_cs_name, normalized_cs_phone, normalized_cs_email,
        'active', actor, clock_timestamp()
      ) returning * into saved;
    else
      saved := latest;
      content_changed := false;
    end if;

    -- 이 템플릿의 예전 내용이 적용돼 있는 상품을 새 내용으로 바꾼다(상품마다 admin_apply_shipping_notice_template을 부른 것과 같다).
    next_snapshot := jsonb_build_object(
      'templateId', saved.id,
      'templateVersion', saved.version,
      'code', saved.code,
      'name', saved.name,
      'shippingNotice', saved.shipping_notice,
      'returnExchangeNotice', saved.return_exchange_notice,
      'remoteAreaNotice', saved.remote_area_notice,
      'csName', saved.cs_name,
      'csPhone', saved.cs_phone,
      'csEmail', saved.cs_email
    );
    -- 이 템플릿의 예전 버전 줄들을 먼저 목록으로 읽는다(코드 잠금을 들고 있어 이 저장이 끝날 때까지 늘지 않는다).
    -- 상품 조건은 템플릿 표와의 결합이 아니라 이 목록과의 비교로 둔다. 결합으로 두면, 잠금을 기다리는 사이 다른 저장이 그 상품을
    -- 예전 버전에서 또 다른 예전 버전으로 옮겼을 때(뒤처진 상품에 직전 내용을 다시 붙인 경우) PostgreSQL이 바뀐 줄을 처음 짝지은
    -- 템플릿 줄하고만 다시 견줘 그 상품을 빼 버린다(READ COMMITTED의 재확인). 목록과의 비교는 바뀐 줄로 다시 판정된다.
    select coalesce(array_agg(version_row.id), '{}') into previous_version_ids
      from public.shipping_notice_templates version_row
      where version_row.code = saved.code and version_row.id <> saved.id;
    with targets as (
      select good.id as good_id, good.shipping_notice_template_id as before_template_id,
        good.shipping_notice_template_version as before_template_version,
        good.shipping_notice_snapshot as before_snapshot, good.updated_at as before_updated_at
      from public.goods good
      where good.archived_at is null
        and good.shipping_notice_template_id = any(previous_version_ids)
      order by good.id
      for update of good
    ), changed as (
      update public.goods good set
        shipping_notice_template_id = saved.id,
        shipping_notice_template_version = saved.version,
        shipping_notice_snapshot = next_snapshot,
        updated_at = greatest(clock_timestamp(), targets.before_updated_at + interval '1 microsecond')
      from targets
      where good.id = targets.good_id
      returning targets.good_id, targets.before_template_id, targets.before_template_version, targets.before_snapshot
    ), logged as (
      insert into public.audit_log(actor_id, action, target, diff)
      select actor, 'catalog.good.shipping_notice_template_applied', 'goods:' || changed.good_id,
        jsonb_build_object('before', jsonb_build_object(
          'templateId', changed.before_template_id,
          'templateVersion', changed.before_template_version,
          'snapshot', changed.before_snapshot
        ), 'after', jsonb_build_object(
          'templateId', saved.id,
          'templateVersion', saved.version,
          'snapshot', next_snapshot
        ), 'operationId', p_operation)
      from changed
      returning 1
    )
    select count(*) into applied_goods from logged;
  end if;

  result := jsonb_build_object(
    'id', saved.id, 'code', saved.code, 'version', saved.version, 'name', saved.name,
    'status', saved.status, 'updatedAt', saved.updated_at,
    'created', p_template_id is null, 'changed', content_changed, 'appliedGoods', applied_goods
  );
  insert into public.audit_log(id, actor_id, action, target, diff)
    values (p_operation, actor, 'catalog.shipping_notice_template.saved_and_applied',
      'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('request', request, 'result', result,
        'before', case when p_template_id is null then null else to_jsonb(latest) end, 'after', to_jsonb(saved)));
  return result;
end
$$;

create function private.apply_shipping_notice_template_current(
  target_good_id text,
  target_template_id uuid,
  expected_good_updated_at timestamp with time zone,
  follow_current boolean
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  template public.shipping_notice_templates;
  current_template public.shipping_notice_templates;
  previous public.goods;
  saved public.goods;
  snapshot jsonb;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select * into previous from public.goods where id = target_good_id for update;
  if not found then raise no_data_found using message = 'good_not_found'; end if;
  if expected_good_updated_at is null or previous.updated_at is distinct from expected_good_updated_at then
    raise exception using errcode = 'PT409', message = 'good_shipping_notice_conflict';
  end if;
  if previous.archived_at is not null then raise check_violation using message='good_archived'; end if;
  if target_template_id is not null then
    select * into template from public.shipping_notice_templates where id = target_template_id;
    if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
    -- 이 상품이 지금 이 템플릿(코드)을 쓰고 있지 않으면, 템플릿 저장(admin_save_and_apply_shipping_notice_template)과 줄을 선다.
    -- 템플릿 저장은 '이미 쓰는 상품'만 바꾸므로, 처음 붙이는 저장이 그 저장과 겹치면 이 상품만 고치기 전 내용으로 남는다.
    -- 이미 쓰는 상품이면 잡지 않는다 — 템플릿 저장이 이 상품 줄을 기다렸다가 바꾸고, 상품 줄을 든 채 코드 잠금을 기다리면 서로 막힌다.
    if not exists(
      select 1 from public.shipping_notice_templates attached
      where attached.id = previous.shipping_notice_template_id and attached.code = template.code
    ) then
      perform pg_advisory_xact_lock_shared(hashtextextended('shipping_notice_template:' || template.code, 0));
    end if;
    -- 잠금을 얻은 뒤 새 문장으로 그 코드의 지금 내용(가장 큰 active 버전)을 읽는다. 기다리는 동안 끝난 템플릿 저장이 여기서 보인다.
    select * into current_template from public.shipping_notice_templates
      where code = template.code and status = 'active' order by version desc limit 1;
    if found and current_template.id <> template.id then
      if follow_current then
        template := current_template;
      elsif template.status = 'active' then
        -- 화면이 연 줄이 그사이 고쳐졌다. 고치기 전 내용을 상품에 넣지 않는다.
        raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
      end if;
    end if;
  end if;
  if template.id is not distinct from previous.shipping_notice_template_id then
    return jsonb_build_object('goodId',previous.id,'templateId',previous.shipping_notice_template_id,
      'templateVersion',previous.shipping_notice_template_version,'updatedAt',previous.updated_at);
  end if;
  if target_template_id is null then
    update public.goods set
      shipping_notice_template_id = null,
      shipping_notice_template_version = null,
      shipping_notice_snapshot = null,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
      where id = target_good_id returning * into saved;
    insert into public.audit_log(actor_id, action, target, diff)
      values (actor, 'catalog.good.shipping_notice_template_cleared', 'goods:' || saved.id,
        jsonb_build_object('before', jsonb_build_object(
          'templateId', previous.shipping_notice_template_id,
          'templateVersion', previous.shipping_notice_template_version,
          'snapshot', previous.shipping_notice_snapshot
        ), 'after', null));
    return jsonb_build_object('goodId', saved.id, 'templateId', null, 'templateVersion', null, 'updatedAt', saved.updated_at);
  end if;
  if template.status <> 'active' then raise check_violation using message = 'shipping_notice_template_not_active'; end if;
  snapshot := jsonb_build_object(
    'templateId', template.id,
    'templateVersion', template.version,
    'code', template.code,
    'name', template.name,
    'shippingNotice', template.shipping_notice,
    'returnExchangeNotice', template.return_exchange_notice,
    'remoteAreaNotice', template.remote_area_notice,
    'csName', template.cs_name,
    'csPhone', template.cs_phone,
    'csEmail', template.cs_email
  );
  update public.goods set
    shipping_notice_template_id = template.id,
    shipping_notice_template_version = template.version,
    shipping_notice_snapshot = snapshot,
    updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_good_id returning * into saved;
  insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'catalog.good.shipping_notice_template_applied', 'goods:' || saved.id,
      jsonb_build_object('before', jsonb_build_object(
        'templateId', previous.shipping_notice_template_id,
        'templateVersion', previous.shipping_notice_template_version,
        'snapshot', previous.shipping_notice_snapshot
      ), 'after', jsonb_build_object(
        'templateId', saved.shipping_notice_template_id,
        'templateVersion', saved.shipping_notice_template_version,
        'snapshot', saved.shipping_notice_snapshot
      )));
  return jsonb_build_object(
    'goodId', saved.id,
    'templateId', saved.shipping_notice_template_id,
    'templateVersion', saved.shipping_notice_template_version,
    'updatedAt', saved.updated_at
  );
end;
$function$;

-- 화면의 [상품에 적용]: 넘어온 줄이 그 템플릿의 지금 내용일 때만 적용한다(아니면 PT409 shipping_notice_template_conflict).
-- 권한 확인은 여기서도 하고 본문(private.apply_shipping_notice_template_current)에서도 한다.
create or replace function public.admin_apply_shipping_notice_template(target_good_id text, target_template_id uuid, expected_good_updated_at timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.require_operator_capability('catalog.manage',false);
  return private.apply_shipping_notice_template_current(target_good_id, target_template_id, expected_good_updated_at, false);
end;
$function$;

create or replace function private.apply_shipping_notice_template_reference(target_good_id text, target_code text, target_version integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  template_id uuid;
  good_stamp timestamptz;
begin
  if nullif(btrim(coalesce(target_code, ''), E' \t\n\r'), '') is null then
    select updated_at into good_stamp from public.goods where id = target_good_id;
    if not found then raise no_data_found using message = 'good_not_found'; end if;
    return public.admin_apply_shipping_notice_template(target_good_id, null, good_stamp);
  end if;
  if target_version is null then raise invalid_parameter_value using message = 'shipping_notice_template_version_required'; end if;
  select id into template_id from public.shipping_notice_templates
    where code = btrim(target_code) and version = target_version;
  if not found then raise check_violation using message = 'shipping_notice_template_not_found'; end if;
  select updated_at into good_stamp from public.goods where id = target_good_id;
  if not found then raise no_data_found using message = 'good_not_found'; end if;
  -- 받은 버전은 그 줄이 있는지만 확인하고, 적용은 그 코드의 지금 내용(가장 큰 active 버전)으로 한다(follow_current).
  -- 지금 내용은 템플릿 저장과 줄을 선 뒤에 읽는다. active 버전이 하나도 없으면 전처럼 shipping_notice_template_not_active로 거절된다.
  return private.apply_shipping_notice_template_current(target_good_id, template_id, good_stamp, true);
end;
$function$;

-- Supabase default privileges가 새 public 함수에 anon·authenticated·service_role 실행 권한을 붙인다. 모두 거둔 뒤 필요한 롤에만 준다.
-- 다시 정의한 활성화 함수도 봉인을 한 번 더 적어 둔다(authenticated만 실행).
-- 코드·버전 참조 함수는 상품 저장이 안에서만 부른다. 같은 시그니처를 다시 정의해 권한은 그대로지만(어느 롤에도 실행 권한 없음) 한 번 더 적어 둔다.
-- 적용 본문(apply_shipping_notice_template_current)도 안에서만 부른다. 두 함수는 운영자 계약에 등록하는 함수가 아니다.
revoke all on function private.apply_shipping_notice_template_reference(text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.apply_shipping_notice_template_current(text, uuid, timestamp with time zone, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_apply_shipping_notice_template(text, uuid, timestamp with time zone)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_apply_shipping_notice_template(text, uuid, timestamp with time zone) to authenticated;
revoke all on function public.admin_activate_shipping_notice_template(uuid, timestamp with time zone, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_activate_shipping_notice_template(uuid, timestamp with time zone, text) to authenticated;
revoke all on function public.admin_list_shipping_notice_templates(text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_shipping_notice_templates(text, integer, integer, text) to authenticated;
revoke all on function public.admin_save_and_apply_shipping_notice_template(uuid, uuid, timestamp with time zone, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_and_apply_shipping_notice_template(uuid, uuid, timestamp with time zone, text, text, text, text, text, text, text)
  to authenticated;

-- 다시 정의한 함수의 본문 지문을 재등록하고(권한·구분은 전과 같다), 새 함수 둘을 운영자 계약에 등록한다.
select private.register_operator_rpc_contract(
  'public.admin_activate_shipping_notice_template(uuid,timestamp with time zone,text)'::regprocedure, 'catalog.manage', 'write', false
);
select private.register_operator_rpc_contract(
  'public.admin_apply_shipping_notice_template(text,uuid,timestamp with time zone)'::regprocedure, 'catalog.manage', 'write', false
);
select private.register_operator_rpc_contract(
  'public.admin_list_shipping_notice_templates(text,integer,integer,text)'::regprocedure, 'catalog.read', 'read', false
);
select private.register_operator_rpc_contract(
  'public.admin_save_and_apply_shipping_notice_template(uuid,uuid,timestamp with time zone,text,text,text,text,text,text,text)'::regprocedure,
  'catalog.manage', 'write', false
);
