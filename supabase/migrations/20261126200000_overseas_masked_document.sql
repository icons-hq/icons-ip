begin;

-- 작성 중이던 신청도 새 동의로 같은 행에서 이어간다. 신규 신청에는 손글씨 코드가 없다.
alter table private.overseas_adult_requests
  alter column challenge drop default,
  alter column policy_version set default 'overseas_document@2026-11-26',
  add column submission_key uuid;
create unique index overseas_document_submission_once
  on private.overseas_adult_requests(user_id, submission_key) where submission_key is not null;

create function public.reserve_overseas_adult_document(p_submission_key uuid, p_consent text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  record_id uuid;
  previous_state text;
begin
  if actor is null or p_submission_key is null or p_consent is distinct from 'overseas_document@2026-11-26'
    or private.is_account_write_fenced(actor) or not private.overseas_member_active(actor) then
    raise insufficient_privilege using message = 'overseas_request_unavailable';
  end if;
  -- is_account_write_fenced가 획득한 회원 잠금 아래 응답 유실·중복 제출을 같은 신청에 묶는다.
  select state into previous_state from private.overseas_adult_requests
    where user_id = actor and submission_key = p_submission_key;
  if found then
    return jsonb_build_object('status', case when previous_state in ('pending','reviewing') then 'received' else 'existing' end);
  end if;
  record_id := public.begin_overseas_adult_request();
  update private.overseas_adult_requests
    set state = 'uploading', submission_key = p_submission_key, challenge = null,
        consent_version = p_consent, policy_version = p_consent,
        upload_until = clock_timestamp() + interval '3 minutes', expires_at = clock_timestamp() + interval '24 hours'
    where id = record_id and user_id = actor and state = 'draft';
  if not found then return jsonb_build_object('status','existing'); end if;
  return jsonb_build_object('status','reserved','id',record_id);
end $$;

-- 고객 상태에는 문서 원문이나 손글씨 코드를 내보내지 않는다.
create or replace function public.my_overseas_adult_request() returns jsonb
language sql stable security definer set search_path = '' as $$
  with intake as materialized (select private.overseas_intake_status() as status)
  select jsonb_build_object(
    'open', intake.status = 'open', 'intakeStatus', intake.status,
    'domesticVerified', private.adult_verification_valid((select auth.uid())),
    'request', (
      select jsonb_build_object('id', r.id, 'number', r.request_no, 'state', r.state,
        'outcome', case when r.state = 'closed' then r.outcome end,
        'expiresAt', r.expires_at, 'validUntil', case when r.valid_until > now() then r.valid_until end)
      from private.overseas_adult_requests r where r.user_id = (select auth.uid())
      order by r.created_at desc limit 1
    )
  ) from intake;
$$;

-- 이미 제출한 자료는 제출 당시 방식으로 심사한다. 두 형식 모두 같은 일회 열람권을 사용한다.
create or replace function public.open_overseas_adult_review(p_id uuid, p_digest text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); r private.overseas_adult_requests;
begin
  if not private.overseas_reviewer(actor) or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise insufficient_privilege; end if;
  update private.overseas_adult_requests set state='reviewing', reviewer=actor, review_session=(auth.jwt()->>'session_id')::uuid,
    opened_at=clock_timestamp(), review_until=least(expires_at,clock_timestamp()+interval '5 minutes'), token_digest=p_digest
    where id=p_id and user_id<>actor and private.overseas_member_active(user_id) and state='pending' and expires_at>clock_timestamp()
    returning * into r;
  if not found then raise no_data_found; end if;
  return jsonb_build_object('share',r.key_share,'method',r.consent_version,'challenge',r.challenge,'until',r.review_until);
end $$;

-- 신분증에 적힌 생년월일을 운영자가 입력하고 DB가 회원가입 때 등록한 값과 대조한다.
-- 다른 사람의 서류는 해당 회원의 국내 성인 인증을 변경하지 않는다.
do $decision$
declare
  source text := pg_get_functiondef('public.decide_overseas_adult_review(uuid,text,date,boolean)'::regprocedure);
  anchor constant text := '    decision:=case when extract(year from today)-extract(year from p_birth)>=19 then ''approved'' else ''underage'' end;';
begin
  if strpos(source,anchor)=0 then raise exception 'missing overseas age decision'; end if;
  execute replace(source,anchor,$new$    if r.consent_version = 'overseas_document@2026-11-26' and not exists (
      select 1 from public.profiles p where p.id=r.user_id and p.birth_date=p_birth
    ) then
      decision:='rejected';
    else
      decision:=case when extract(year from today)-extract(year from p_birth)>=19 then 'approved' else 'underage' end;
    end if;$new$);
end $decision$;

-- 옛 접수 호출은 새 동의 없이 사진을 예약할 수 없다. begin은 새 예약 함수 안에서만 재사용한다.
revoke all on function public.begin_overseas_adult_request(), public.reserve_overseas_adult_upload(uuid,text),
  public.reserve_overseas_adult_document(uuid,text), public.my_overseas_adult_request(),
  public.open_overseas_adult_review(uuid,text), public.decide_overseas_adult_review(uuid,text,date,boolean)
from public, anon, authenticated, service_role;
grant execute on function public.reserve_overseas_adult_document(uuid,text), public.my_overseas_adult_request(),
  public.open_overseas_adult_review(uuid,text), public.decide_overseas_adult_review(uuid,text,date,boolean)
to authenticated;
select private.register_operator_rpc_contract('public.open_overseas_adult_review(uuid,text)'::regprocedure,'platform.manage','manual',true);
select private.register_operator_rpc_contract('public.decide_overseas_adult_review(uuid,text,date,boolean)'::regprocedure,'platform.manage','manual',true);
commit;
