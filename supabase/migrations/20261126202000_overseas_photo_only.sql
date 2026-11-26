begin;

-- 선택한 신분증 사진 한 장만 받는다. 문서번호가 포함된 사진에 대한 별도 동의를 기록한다.
alter table private.overseas_adult_requests
  alter column policy_version set default 'overseas_photo@2026-11-26',
  add column document_number_consent boolean;

create function public.reserve_overseas_adult_photo(p_submission_key uuid, p_consent text, p_number_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  record_id uuid;
  previous_state text;
begin
  if actor is null or p_submission_key is null or p_consent is distinct from 'overseas_photo@2026-11-26'
    or p_number_consent is null or private.is_account_write_fenced(actor) or not private.overseas_member_active(actor) then
    raise insufficient_privilege using message='overseas_request_unavailable';
  end if;
  select state into previous_state from private.overseas_adult_requests
    where user_id=actor and submission_key=p_submission_key;
  if found then
    return jsonb_build_object('status',case when previous_state in ('pending','reviewing') then 'received' else 'existing' end);
  end if;
  record_id := public.begin_overseas_adult_request();
  update private.overseas_adult_requests
    set state='uploading', submission_key=p_submission_key, challenge=null, document_number_consent=p_number_consent,
        consent_version=p_consent, policy_version=p_consent,
        upload_until=clock_timestamp()+interval '3 minutes', expires_at=clock_timestamp()+interval '24 hours'
    where id=record_id and user_id=actor and state='draft';
  if not found then return jsonb_build_object('status','existing'); end if;
  return jsonb_build_object('status','reserved','id',record_id);
end $$;

-- 열람권에 묶인 동일 행의 동의 구분만 전달한다. 문서의 번호는 추출하거나 DB에 쓰지 않는다.
do $patch$
declare
  review_fn regprocedure := 'public.open_overseas_adult_review(uuid,text)'::regprocedure;
  decision_fn regprocedure := 'public.decide_overseas_adult_review(uuid,text,date,boolean)'::regprocedure;
  review_source text := pg_get_functiondef(review_fn);
  decision_source text := pg_get_functiondef(decision_fn);
begin
  if strpos(review_source,'''method'',r.consent_version')=0 or
     strpos(decision_source,'r.consent_version = ''overseas_document@2026-11-26''')=0 then
    raise exception 'overseas review definition changed';
  end if;
  execute replace(review_source,'''method'',r.consent_version',
    '''method'',r.consent_version,''numberConsent'',r.document_number_consent');
  execute replace(decision_source,'r.consent_version = ''overseas_document@2026-11-26''',
    'r.consent_version in (''overseas_document@2026-11-26'',''overseas_photo@2026-11-26'')');
end $patch$;
revoke all on function public.reserve_overseas_adult_document(uuid,text), public.reserve_overseas_adult_photo(uuid,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_overseas_adult_photo(uuid,text,boolean) to authenticated;
select private.register_operator_rpc_contract('public.open_overseas_adult_review(uuid,text)'::regprocedure,'platform.manage','manual',true);
select private.register_operator_rpc_contract('public.decide_overseas_adult_review(uuid,text,date,boolean)'::regprocedure,'platform.manage','manual',true);
commit;
