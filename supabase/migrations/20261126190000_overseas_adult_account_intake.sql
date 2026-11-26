begin;

-- 정식 오픈 전 운영 방침과 같은 시행일이다. 상품 지정은 접수·승인의 조건에서 제외한다.
update private.overseas_adult_policy
set effective_at = timestamptz '2026-11-26 00:00:00+09'
where singleton;

create function private.overseas_intake_status() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from private.overseas_adult_policy where effective_at <= now()) then 'policy_pending'
    when not private.adult_goods_storefront_enabled() then 'store_closed'
    when not exists (
      select 1 from public.profiles p where p.role in ('admin','staff') and p.suspended_at is null
        and private.has_operator_capability(p.id, 'platform.manage', true)
    ) then 'review_paused'
    else 'open'
  end;
$$;

create or replace function private.overseas_intake_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.overseas_intake_status() = 'open';
$$;

create or replace function public.my_overseas_adult_request() returns jsonb
language sql stable security definer set search_path = '' as $$
  with intake as materialized (select private.overseas_intake_status() as status)
  select jsonb_build_object(
    'open', intake.status = 'open', 'intakeStatus', intake.status,
    'domesticVerified', private.adult_verification_valid((select auth.uid())),
    'request', (
      select jsonb_build_object('id', r.id, 'number', r.request_no, 'state', r.state,
        'outcome', case when r.state = 'closed' then r.outcome end,
        'challenge', case when r.state = 'draft' then r.challenge end,
        'expiresAt', r.expires_at, 'validUntil', case when r.valid_until > now() then r.valid_until end)
      from private.overseas_adult_requests r where r.user_id = (select auth.uid())
      order by r.created_at desc limit 1
    )
  ) from intake;
$$;

-- 변경된 범위에 동의한 뒤에만 사진을 받는다. 이전 화면의 동의 값으로는 예약할 수 없다.
alter table private.overseas_adult_requests alter column policy_version set default 'overseas_manual_all@2026-11-26';
create or replace function public.reserve_overseas_adult_upload(p_id uuid, p_consent text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if p_consent is distinct from 'overseas_manual_all@2026-11-26' or not private.overseas_intake_open()
    or private.is_account_write_fenced(actor) or not private.overseas_member_active(actor) then return false; end if;
  update private.overseas_adult_requests
    set state = 'uploading', upload_until = clock_timestamp() + interval '3 minutes',
        consent_version = p_consent, policy_version = p_consent
    where id = p_id and user_id = actor and state = 'draft' and expires_at > clock_timestamp();
  return found;
end $$;

-- 장바구니·주문·결제 호출에는 상품 ID가 포함된다. 권한은 계정의 유효한 증거로 한 번 판정한다.
create or replace function private.adult_allowed_for_good(p_user uuid, p_good text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.adult_verification_valid(p_user) or private.overseas_valid_until(p_user) is not null;
$$;

-- 상품 ID가 없는 기존 전시 호출도 동일한 공개 설정과 성인 인증을 검사한다.
create or replace function private.good_sale_restriction_visible(p_restriction public.goods_sale_restriction, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.good_sale_restriction_visible(p_restriction, p_user_id, null::text);
$$;

-- 국내 본인확인의 해제·만료 응답과 우선순위를 보존하면서 해외 승인 수단을 알려 준다.
do $status$
declare
  definition text := pg_get_functiondef('public.get_my_adult_verification()'::regprocedure);
  old_fields constant text := '''scope'',''selected''';
begin
  if strpos(definition, old_fields) = 0 then raise exception 'missing overseas verification status'; end if;
  execute replace(definition, old_fields, '''method'',''overseas_manual''');
end $status$;

-- 상품 지정 API와 자동 해제 트리거를 종료한다. 기존 감사 기록과 지정 행은 보존한다.
delete from private.operator_rpc_contracts
where signature in ('public.overseas_adult_management()', 'public.configure_overseas_adult_review(text,text,boolean)');
delete from private.operator_internal_contracts
where signature in ('public.overseas_adult_management()', 'public.configure_overseas_adult_review(text,text,boolean)',
  'private.reset_overseas_good_approval()');
drop trigger overseas_good_changed on public.goods;
drop function private.reset_overseas_good_approval();
drop function public.overseas_adult_management();
drop function public.configure_overseas_adult_review(text,text,boolean);

revoke all on function private.overseas_intake_status(), private.overseas_intake_open(),
  private.adult_allowed_for_good(uuid,text), private.good_sale_restriction_visible(public.goods_sale_restriction,uuid),
  public.my_overseas_adult_request(), public.reserve_overseas_adult_upload(uuid,text), public.get_my_adult_verification()
from public, anon, authenticated, service_role;
grant execute on function public.my_overseas_adult_request(), public.reserve_overseas_adult_upload(uuid,text),
  public.get_my_adult_verification() to authenticated;
select private.register_operator_internal_contract('private.overseas_intake_status()'::regprocedure);
select private.register_operator_internal_contract('private.overseas_intake_open()'::regprocedure);

commit;
