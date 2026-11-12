-- ==========================================================================
-- ICONS · 배송 안내 템플릿 '도서산간 안내' 칸(S36-038, 묶음 15)
--
-- 배송 안내 템플릿에 제주·도서산간 고객 안내 문구 칸을 더한다. 템플릿을 상품에
-- 적용하면 지금의 배송·교환/반품 안내와 같이 상품 스냅샷(goods.shipping_notice_snapshot
-- 의 remoteAreaNotice)에 고정되고, 공개 배송 정책(get_good_shipping_policy)이 상세
-- 배송 안내로 싣는다. 금액은 이 문구가 아니라 지역별 추가배송비 정책이 정한다.
--
-- 저장은 새 함수 admin_save_shipping_notice_template_v2(도서산간 안내 인자 추가)로 한다.
-- 구 10인자 저장은 배포 사이 이전 화면을 위해 그대로 두며, 이 칸을 읽지도 고치지도
-- 않으므로 초안을 다시 저장해도 입력된 도서산간 안내가 지워지지 않는다. 활성
-- 템플릿은 이 칸도 바꿀 수 없다. 활성화 필수 항목은 그대로다(도서산간 안내는 선택).
--
-- 기존 함수는 현재 정의에서 앵커만 치환한다(20261105093418과 같은 방식).
-- ==========================================================================

alter table public.shipping_notice_templates add column remote_area_notice text not null default ''
  constraint shipping_notice_templates_remote_area_notice_check
    check (char_length(remote_area_notice) <= 4000 and not private.has_disallowed_shipping_notice_control(remote_area_notice));

comment on column public.shipping_notice_templates.remote_area_notice is
  '제주·도서산간 고객 안내 문구(선택). 상품에 적용하면 shipping_notice_snapshot.remoteAreaNotice로 고정된다.';

create function private.shipping_notice_remote_area_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> 1 then
      raise exception 'shipping_notice_remote_area_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;

revoke all on function private.shipping_notice_remote_area_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

-- 활성 템플릿 불변 — 도서산간 안내도 고정한다.
select private.shipping_notice_remote_area_patch(
  'private.guard_shipping_notice_template_immutable()'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$or new.return_exchange_notice is distinct from old.return_exchange_notice$anchor$,
      $patched$or new.return_exchange_notice is distinct from old.return_exchange_notice
    or new.remote_area_notice is distinct from old.remote_area_notice$patched$)));

-- 상품 적용 스냅샷에 도서산간 안내를 싣는다.
select private.shipping_notice_remote_area_patch(
  'public.admin_apply_shipping_notice_template(text,uuid,timestamptz)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$'returnExchangeNotice', template.return_exchange_notice,$anchor$,
      $patched$'returnExchangeNotice', template.return_exchange_notice,
    'remoteAreaNotice', template.remote_area_notice,$patched$)));

-- 공개 배송 정책 — 스냅샷의 도서산간 안내(없으면 빈 문자열).
select private.shipping_notice_remote_area_patch(
  'public.get_good_shipping_policy(text)'::regprocedure,
  jsonb_build_array(
    jsonb_build_array(
      $anchor$'returnExchangeNotice', coalesce(good.shipping_notice_snapshot->>'returnExchangeNotice', ''),$anchor$,
      $patched$'returnExchangeNotice', coalesce(good.shipping_notice_snapshot->>'returnExchangeNotice', ''),
    'remoteAreaNotice', coalesce(good.shipping_notice_snapshot->>'remoteAreaNotice', ''),$patched$)));

drop function private.shipping_notice_remote_area_patch(regprocedure, jsonb);

create function public.admin_save_shipping_notice_template_v2(
  target_id uuid, target_code text, target_version integer, target_name text,
  target_shipping_notice text, target_return_exchange_notice text, target_remote_area_notice text,
  target_cs_name text, target_cs_phone text, target_cs_email text, expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := (select auth.uid());
  previous public.shipping_notice_templates;
  saved public.shipping_notice_templates;
  normalized_code text := btrim(coalesce(target_code, ''), E' \t\n\r');
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r');
  normalized_shipping text := btrim(coalesce(target_shipping_notice, ''), E' \t\n\r');
  normalized_return_exchange text := btrim(coalesce(target_return_exchange_notice, ''), E' \t\n\r');
  normalized_remote_area text := btrim(coalesce(target_remote_area_notice, ''), E' \t\n\r');
  normalized_cs_name text := btrim(coalesce(target_cs_name, ''), E' \t\n\r');
  normalized_cs_phone text := btrim(coalesce(target_cs_phone, ''), E' \t\n\r');
  normalized_cs_email text := btrim(coalesce(target_cs_email, ''), E' \t\n\r');
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if normalized_code !~ '^[a-z][a-z0-9-]{1,39}$'
    or target_version is null or target_version not between 1 and 1000000
    or char_length(normalized_name) not between 1 and 80
    or char_length(normalized_shipping) > 4000 or char_length(normalized_return_exchange) > 4000
    or char_length(normalized_remote_area) > 4000
    or char_length(normalized_cs_name) > 120 or char_length(normalized_cs_phone) > 80
    or char_length(normalized_cs_email) > 320
    or private.has_disallowed_shipping_notice_control(normalized_shipping)
    or private.has_disallowed_shipping_notice_control(normalized_return_exchange)
    or private.has_disallowed_shipping_notice_control(normalized_remote_area)
    or private.has_disallowed_shipping_notice_control(normalized_cs_name)
    or private.has_disallowed_shipping_notice_control(normalized_cs_phone)
    or private.has_disallowed_shipping_notice_control(normalized_cs_email)
  then
    raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
  end if;

  if target_id is not null then
    select * into previous from public.shipping_notice_templates where id = target_id for update;
    if not found then raise no_data_found using message = 'shipping_notice_template_not_found'; end if;
    if previous.updated_at is distinct from expected_updated_at then
      raise exception using errcode = 'PT409', message = 'shipping_notice_template_conflict';
    end if;
    if previous.status <> 'draft' then
      raise check_violation using message = 'shipping_notice_template_active_immutable';
    end if;
    if previous.code <> normalized_code or previous.version <> target_version then
      raise check_violation using message = 'shipping_notice_template_identity_locked';
    end if;
    update public.shipping_notice_templates set
      name = normalized_name,
      shipping_notice = normalized_shipping,
      return_exchange_notice = normalized_return_exchange,
      remote_area_notice = normalized_remote_area,
      cs_name = normalized_cs_name,
      cs_phone = normalized_cs_phone,
      cs_email = normalized_cs_email,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
      where id = target_id returning * into saved;
  else
    if expected_updated_at is not null then
      raise invalid_parameter_value using message = 'invalid_shipping_notice_template';
    end if;
    insert into public.shipping_notice_templates(
      code, version, name, shipping_notice, return_exchange_notice, remote_area_notice, cs_name, cs_phone, cs_email
    ) values (
      normalized_code, target_version, normalized_name, normalized_shipping, normalized_return_exchange,
      normalized_remote_area, normalized_cs_name, normalized_cs_phone, normalized_cs_email
    ) returning * into saved;
  end if;

  insert into public.audit_log(actor_id, action, target, diff)
    values (
      actor,
      case when target_id is null then 'catalog.shipping_notice_template.created'
        else 'catalog.shipping_notice_template.updated' end,
      'shipping_notice_templates:' || saved.id::text,
      jsonb_build_object('before', to_jsonb(previous), 'after', to_jsonb(saved))
    );
  return jsonb_build_object('id', saved.id, 'version', saved.version, 'updatedAt', saved.updated_at);
end;
$function$;

revoke all on function public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamptz)
  to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_save_shipping_notice_template_v2(uuid,text,integer,text,text,text,text,text,text,text,timestamptz)'::regprocedure,
  'catalog.manage', 'write', false);

-- 다시 만든 함수의 운영자 계약 지문을 현재 본문으로 갱신한다(분류·권한 값은 기존 그대로).
select private.register_operator_rpc_contract(pg_catalog.to_regprocedure(contract.signature),
  contract.capability, contract.guard_kind, contract.legacy_admin_only)
from private.operator_rpc_contracts as contract
where contract.signature = 'public.admin_apply_shipping_notice_template(text,uuid,timestamp with time zone)';

select private.register_operator_internal_contract(target.oid::regprocedure)
from pg_catalog.pg_proc as target
where target.oid = 'public.get_good_shipping_policy(text)'::regprocedure::oid
  and exists (
    select 1 from private.operator_internal_contracts as contract
    where pg_catalog.to_regprocedure(contract.signature) = target.oid
  );

notify pgrst, 'reload schema';
