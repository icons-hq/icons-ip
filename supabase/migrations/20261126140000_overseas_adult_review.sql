begin;

-- 사진은 비공개 Storage에만 둔다. 실제 AES 키는 DB와 객체에 나뉜 두 난수가 함께 있어야 파생된다.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('overseas-adult-evidence','overseas-adult-evidence',false,3145728,array['application/octet-stream']);

create table private.overseas_adult_reviewers (
  user_id uuid primary key references public.profiles(id) on delete cascade
);
create table private.overseas_adult_goods (
  good_id text primary key references public.goods(id) on delete cascade
);
create table private.overseas_adult_policy (
  singleton boolean primary key default true check(singleton),
  effective_at timestamptz not null
);
insert into private.overseas_adult_policy(effective_at) values ('2026-12-04 00:00:00+09');
create table private.overseas_adult_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  challenge text not null default upper(encode(extensions.gen_random_bytes(5),'hex')),
  state text not null default 'draft' check(state in ('draft','uploading','pending','reviewing','purging','closed')),
  outcome text check(outcome in ('approved','rejected','underage','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  submitted_at timestamptz, upload_until timestamptz, consent_version text,
  key_share text check(key_share ~ '^[0-9a-f]{64}$'),
  reviewer uuid references auth.users(id) on delete set null,
  review_session uuid, token_digest text, opened_at timestamptz, delivered_at timestamptz, review_until timestamptz,
  decided_at timestamptz, purged_at timestamptz, valid_until timestamptz,
  cleanup_after timestamptz, cleanup_attempts integer not null default 0,
  policy_version text not null default 'overseas_manual@2026-11-26',
  check ((state in ('closed','purging')) = (outcome is not null)),
  check ((state in ('pending','reviewing')) = (key_share is not null)),
  check ((state='closed') = (purged_at is not null)),
  check (valid_until is null or (state='closed' and outcome='approved'))
);
create unique index overseas_adult_one_request on private.overseas_adult_requests(user_id) where state <> 'closed';
create index overseas_adult_owner_history on private.overseas_adult_requests(user_id,created_at desc);
create index overseas_adult_queue on private.overseas_adult_requests(state, expires_at) where state <> 'closed';
create index overseas_adult_validity on private.overseas_adult_requests(user_id,valid_until) where valid_until is not null;

alter table private.overseas_adult_requests enable row level security;
alter table private.overseas_adult_goods enable row level security;
alter table private.overseas_adult_reviewers enable row level security;
alter table private.overseas_adult_policy enable row level security;
revoke all on private.overseas_adult_requests, private.overseas_adult_goods, private.overseas_adult_reviewers, private.overseas_adult_policy from public, anon, authenticated, service_role;

create function private.overseas_member_active(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=p_user and suspended_at is null and onboarded_at is not null)
    and not exists(select 1 from private.account_action_fences where subject_user_id=p_user);
$$;
create function private.overseas_reviewer(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_operator_capability(p_user,'platform.manage',true)
     and exists(select 1 from private.overseas_adult_reviewers where user_id=p_user)
     and private.operator_mfa_session_verified(p_user);
$$;
create function private.overseas_intake_open() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.overseas_adult_policy where effective_at <= now()) and private.adult_goods_storefront_enabled()
    and exists(select 1 from private.overseas_adult_goods a join public.goods g on g.id=a.good_id join public.ips i on i.id=g.ip_id
      where g.sale_restriction='adult' and g.published_at is not null and g.archived_at is null and i.published_at is not null and i.archived_at is null)
    and exists(select 1 from private.overseas_adult_reviewers r join public.profiles p on p.id=r.user_id
      where private.has_operator_capability(p.id,'platform.manage',true) and exists(select 1 from auth.mfa_factors f where f.user_id=r.user_id and f.status='verified'));
$$;
create function private.overseas_valid_until(p_user uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select max(valid_until) from private.overseas_adult_requests where user_id=p_user and valid_until>now() and private.overseas_member_active(p_user);
$$;
create function private.overseas_queue_destruction(p_id uuid, p_outcome text) returns void
language sql volatile security definer set search_path='' as $$
  update private.overseas_adult_requests set state='purging', outcome=p_outcome, decided_at=clock_timestamp(),
    cleanup_after=greatest(clock_timestamp(), upload_until), key_share=null, token_digest=null, review_session=null
  where id=p_id and state not in ('closed','purging');
$$;

create function public.my_overseas_adult_request() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('open', private.overseas_intake_open(), 'goods', coalesce((
    select jsonb_agg(g.name order by g.name) from private.overseas_adult_goods a
    join public.goods g on g.id=a.good_id join public.ips i on i.id=g.ip_id
    where g.sale_restriction='adult' and g.published_at is not null and g.archived_at is null
      and i.published_at is not null and i.archived_at is null and (select private.adult_goods_storefront_enabled())
  ),'[]'::jsonb), 'request', (
    select jsonb_build_object('id',r.id,'state',r.state,'outcome',case when r.state='closed' then r.outcome end,
      'challenge',case when r.state='draft' then r.challenge end,'expiresAt',r.expires_at,'validUntil',case when r.valid_until>now() then r.valid_until end)
    from private.overseas_adult_requests r where r.user_id=(select auth.uid()) order by r.created_at desc limit 1));
$$;

create function public.begin_overseas_adult_request() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result uuid;
begin
  if actor is null or private.is_account_write_fenced(actor) or not private.overseas_member_active(actor)
    or not private.overseas_intake_open() or private.adult_verification_valid(actor) or private.overseas_valid_until(actor) is not null
  then raise insufficient_privilege using message='overseas_intake_closed'; end if;
  select id into result from private.overseas_adult_requests where user_id=actor and state<>'closed';
  if found then return result; end if;
  if (select count(*) from private.overseas_adult_requests where user_id=actor and created_at>now()-interval '1 day')>=3
  then raise check_violation using message='overseas_request_limit'; end if;
  insert into private.overseas_adult_requests(user_id) values(actor) returning id into result;
  return result;
end $$;

create function public.reserve_overseas_adult_upload(p_id uuid,p_consent text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if p_consent is distinct from 'overseas_manual@2026-11-26' or not private.overseas_intake_open()
    or private.is_account_write_fenced(actor) or not private.overseas_member_active(actor) then return false; end if;
  update private.overseas_adult_requests set state='uploading',upload_until=clock_timestamp()+interval '3 minutes',consent_version=p_consent
    where id=p_id and user_id=actor and state='draft' and expires_at>clock_timestamp();
  return found;
end $$;
create function public.service_submit_overseas_adult_upload(p_id uuid,p_user uuid,p_share text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_share is null or p_share !~ '^[0-9a-f]{64}$' or not private.overseas_member_active(p_user) or not private.overseas_intake_open() then return false; end if;
  update private.overseas_adult_requests set state='pending',key_share=p_share,submitted_at=clock_timestamp(),upload_until=null
  where id=p_id and user_id=p_user and state='uploading' and least(expires_at,upload_until)>clock_timestamp()
    and exists(select 1 from storage.objects where bucket_id='overseas-adult-evidence' and name=p_id::text);
  return found;
end $$;
create function public.cancel_overseas_adult_request(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.overseas_adult_requests;
begin
  select * into r from private.overseas_adult_requests where id=p_id and user_id=(select auth.uid()) for update;
  if not found then return false; end if;
  if r.state in ('closed','purging') then return r.outcome='cancelled'; end if;
  perform private.overseas_queue_destruction(r.id,'cancelled');
  return true;
end $$;

create function public.overseas_review_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if not private.overseas_reviewer(actor) then raise insufficient_privilege; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'submittedAt',q.submitted_at) order by q.submitted_at) from
    (select id,submitted_at from private.overseas_adult_requests where state='pending' and expires_at>now()
      and user_id<>actor and private.overseas_member_active(user_id) order by submitted_at limit 100) q),'[]'::jsonb);
end $$;
create function public.open_overseas_adult_review(p_id uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r private.overseas_adult_requests;
begin
  if not private.overseas_reviewer(actor) or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise insufficient_privilege; end if;
  update private.overseas_adult_requests set state='reviewing',reviewer=actor,review_session=(auth.jwt()->>'session_id')::uuid,
    opened_at=clock_timestamp(),review_until=least(expires_at,clock_timestamp()+interval '5 minutes'),token_digest=p_digest
  where id=p_id and user_id<>actor and private.overseas_member_active(user_id) and state='pending' and expires_at>clock_timestamp() returning * into r;
  if not found then raise no_data_found; end if;
  return jsonb_build_object('share',r.key_share,'challenge',r.challenge,'until',r.review_until);
end $$;
create function private.overseas_review_held(r private.overseas_adult_requests,p_digest text) returns boolean
language sql stable security definer set search_path='' as $$
  select r.state='reviewing' and r.reviewer=auth.uid() and private.overseas_reviewer(auth.uid())
    and r.review_session=(auth.jwt()->>'session_id')::uuid and r.token_digest=p_digest and r.review_until>clock_timestamp()
    and private.overseas_member_active(r.user_id);
$$;
create function public.overseas_adult_review_live(p_id uuid,p_digest text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.overseas_adult_requests r where id=p_id and delivered_at is not null and private.overseas_review_held(r,p_digest));
$$;
create function public.deliver_overseas_adult_review(p_id uuid,p_digest text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update private.overseas_adult_requests r set delivered_at=clock_timestamp()
    where id=p_id and delivered_at is null and private.overseas_review_held(r,p_digest);
  return found;
end $$;
create function public.decide_overseas_adult_review(p_id uuid,p_digest text,p_birth date,p_matches boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.overseas_adult_requests; today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date; decision text;
begin
  select * into r from private.overseas_adult_requests where id=p_id for update;
  if not found or r.delivered_at is null or not coalesce(private.overseas_review_held(r,p_digest),false) then return false; end if;
  decision:='rejected';
  if p_matches is true then
    if p_birth is null or p_birth < date '1900-01-01' or p_birth>today then raise invalid_parameter_value using message='overseas_birth_invalid'; end if;
    decision:=case when extract(year from today)-extract(year from p_birth)>=19 then 'approved' else 'underage' end;
  end if;
  if decision='underage' then
    update private.adult_verifications set revoked_at=now(),revoked_reason='underage_result' where user_id=r.user_id and revoked_at is null;
    update private.overseas_adult_requests set valid_until=null where user_id=r.user_id and valid_until is not null;
  end if;
  perform private.overseas_queue_destruction(p_id,decision);
  return true;
end $$;

-- 탈퇴 신청 때 즉시 열람권을 회수한다. auth.users의 실제 삭제 후에도 객체를 정리할 행은 유지한다.
create function private.withdraw_overseas_adult_requests() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; r record;
begin
  if tg_table_name='account_action_fences' then target:=new.subject_user_id; else target:=new.user_id; end if;
  for r in select id from private.overseas_adult_requests where user_id=target and state<>'closed' for update loop
    perform private.overseas_queue_destruction(r.id,'cancelled');
  end loop;
  update private.overseas_adult_requests set user_id=null,valid_until=null,
    outcome=case when state='purging' then 'cancelled' else outcome end where user_id=target;
  return new;
end $$;
create trigger overseas_adult_processed_withdrawal after insert on private.member_withdrawal_processings for each row execute function private.withdraw_overseas_adult_requests();
create trigger overseas_adult_withdrawal after insert on private.account_action_fences for each row execute function private.withdraw_overseas_adult_requests();

create function public.service_overseas_adult_cleanup(p_id uuid default null) returns setof uuid
language plpgsql security definer set search_path='' as $$
declare r record;
begin
  for r in select a.id from private.overseas_adult_requests a where (p_id is null or a.id=p_id)
    and state not in ('closed','purging') and (expires_at<=clock_timestamp() or upload_until<=clock_timestamp()
      or review_until<=clock_timestamp() or not private.overseas_member_active(user_id))
    order by expires_at limit 40 for update skip locked loop
    perform private.overseas_queue_destruction(r.id,'expired');
  end loop;
  -- 승인 기록은 1년, 그 밖의 심사 기록은 30일. 탈퇴한 신청의 최종 익명 행도 정리한다.
  delete from private.overseas_adult_requests where id in (select id from private.overseas_adult_requests
    where state='closed' and (user_id is null or purged_at < now() - case when outcome='approved' then interval '1 year' else interval '30 days' end)
    limit 100);
  return query with batch as (select a.id from private.overseas_adult_requests a where (p_id is null or a.id=p_id)
    and state='purging' and cleanup_after<=clock_timestamp() order by cleanup_after limit 20 for update skip locked)
  update private.overseas_adult_requests a set cleanup_attempts=cleanup_attempts+1,cleanup_after=clock_timestamp()+interval '1 minute'
    from batch where a.id=batch.id returning a.id;
  -- 타임아웃 뒤 지연 도착한 객체나 DB 복원 뒤 연결이 사라진 객체도 Storage API로 회수한다.
  if p_id is null then
    return query select o.name::uuid from storage.objects o where o.bucket_id='overseas-adult-evidence'
      and o.name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and o.created_at<now()-interval '3 minutes'
      and not exists(select 1 from private.overseas_adult_requests a where a.id::text=o.name and a.state<>'closed')
      order by o.created_at limit 20;
  end if;
end $$;
create function public.service_finish_overseas_adult_cleanup(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.overseas_adult_requests;
begin
  select * into r from private.overseas_adult_requests where id=p_id for update;
  if exists(select 1 from storage.objects where bucket_id='overseas-adult-evidence' and name=p_id::text) then return false; end if;
  if r.id is null or r.state='closed' then return true; end if;
  if r.state<>'purging' or r.cleanup_attempts=0 or r.upload_until>clock_timestamp() then return false; end if;
  update private.overseas_adult_requests set state='closed',purged_at=clock_timestamp(),cleanup_after=null,
    outcome=case when outcome='approved' and not private.overseas_member_active(user_id) then 'cancelled' else outcome end,
    valid_until=case when outcome='approved' and private.overseas_member_active(user_id) then decided_at + interval '1 year' end
    where id=p_id;
  return true;
end $$;

-- 계정의 해외 증거는 법정·계약상 제한을 별도 검토한 자체 제한 상품에만 쓸 수 있다.
create function private.adult_allowed_for_good(p_user uuid,p_good text) returns boolean
language sql stable security definer set search_path='' as $$
  select case when private.adult_verification_valid(p_user) then true
    else exists(select 1 from private.overseas_adult_goods where good_id=p_good)
      and private.overseas_valid_until(p_user) is not null end;
$$;
create function private.good_sale_restriction_visible(p_restriction public.goods_sale_restriction,p_user_id uuid,p_good_id text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_restriction='none' or (p_restriction='adult' and (select private.adult_goods_storefront_enabled()) and private.adult_allowed_for_good(p_user_id,p_good_id));
$$;
create function public.good_sale_restriction_visible_to_viewer(p_restriction public.goods_sale_restriction,p_good_id text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.good_sale_restriction_visible(p_restriction,(select auth.uid()),p_good_id);
$$;
alter policy goods_public_read on public.goods using (
  published_at is not null and archived_at is null and (sale_restriction='none' or public.good_sale_restriction_visible_to_viewer(sale_restriction,id))
  and exists(select 1 from public.ips ip where ip.id=goods.ip_id and ip.published_at is not null and ip.archived_at is null)
);

-- 기존 함수의 금액·판매기간·행 잠금 등은 보존하고 같은 행의 상품 식별자를 권한 판정에 전달한다.
do $patch$
declare f record; source text; target text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and p.prokind='f'
    and p.prosrc ~ 'private\.good_sale_restriction_visible\((good|g|goods|current_good)\.sale_restriction,'
  loop
    source:=pg_get_functiondef(f.oid);
    target:=regexp_replace(source,
      'private\.good_sale_restriction_visible\((good|g|goods|current_good)\.sale_restriction,\s*(\(select auth\.uid\(\)\)|[a-z_.]+)\)',
      'private.good_sale_restriction_visible(\1.sale_restriction,\2,\1.id)','g');
    if target=source then raise exception 'missing product for %',f.proname; end if;
    execute target;
  end loop;
end $patch$;
create function pg_temp.overseas_patch(p_fn regprocedure,p_old text,p_new text) returns void language plpgsql as $$
declare body text:=pg_get_functiondef(p_fn);
begin
  if position(p_old in body)=0 then raise exception 'overseas policy anchor missing in %',p_fn; end if;
  execute replace(body,p_old,p_new);
end $$;
select pg_temp.overseas_patch(oid::regprocedure,'private.adult_verification_valid(actor)','private.adult_allowed_for_good(actor,p_good_id)')
  from pg_proc where pronamespace='private'::regnamespace and proname='set_cart_quantity_with_inputs';
select pg_temp.overseas_patch(oid::regprocedure,'private.adult_verification_valid(p_actor)','private.adult_allowed_for_good(p_actor,restricted.id)')
  from pg_proc where pronamespace='private'::regnamespace and proname='calculate_goods_transaction_locked';
select pg_temp.overseas_patch(oid::regprocedure,'private.adult_verification_valid(v_user)','private.adult_allowed_for_good(v_user,r.good_id)')
  from pg_proc where pronamespace='private'::regnamespace and proname='place_order_before_shipments';
select pg_temp.overseas_patch(oid::regprocedure,'private.adult_verification_valid(actor)','private.adult_allowed_for_good(actor,item.good_id)')
  from pg_proc where pronamespace='public'::regnamespace and proname='add_cart_selection';
select pg_temp.overseas_patch(oid::regprocedure,'private.adult_verification_valid(p_user_id)','private.adult_allowed_for_good(p_user_id,item.good_id)')
  from pg_proc where pronamespace='public'::regnamespace and proname='service_create_checkout_direct_draft';
select pg_temp.overseas_patch(oid::regprocedure,$old$and good.sale_restriction <> 'none'
    )
    and not private.adult_verification_valid(v_attempt.user_id)$old$,
    $new$and good.sale_restriction <> 'none'
        and not private.good_sale_restriction_visible(good.sale_restriction,v_attempt.user_id,good.id)
    )$new$)
  from pg_proc where pronamespace='private'::regnamespace and proname='claim_goods_payment_before_sale_period';

-- 현재 본인 상태 응답은 KCP 증거를 우선한다. 국내 명의 해시를 해외 증거에 만들어 넣지 않는다.
select pg_temp.overseas_patch('public.get_my_adult_verification()',
  '  select evidence.*',
  $patch$  if not private.adult_verification_valid(v_user) then
    declare e private.overseas_adult_requests;
    begin
      select * into e from private.overseas_adult_requests where user_id=v_user and valid_until>now()
        and private.overseas_member_active(v_user) order by valid_until desc limit 1;
      if found then
        return jsonb_build_object('status','verified','scope','selected','verifiedAt',e.decided_at,'expiresAt',e.valid_until);
      end if;
    end;
  end if;
  select evidence.*$patch$);
select pg_temp.overseas_patch('public.complete_my_adult_verification(text,text)',
  $old$update private.adult_verifications
    set revoked_at = v_now, revoked_reason = 'underage_result'$old$,
  $new$update private.overseas_adult_requests set valid_until=null where user_id=v_user and valid_until is not null;
    perform private.overseas_queue_destruction(id,'underage') from private.overseas_adult_requests
      where user_id=v_user and state not in ('closed','purging');
    update private.overseas_adult_requests set outcome='underage' where user_id=v_user and state='purging' and outcome='approved';
    update private.adult_verifications set revoked_at = v_now, revoked_reason = 'underage_result'$new$);
-- 국내 확인이 새로 성립하면 같은 계정의 수동 증거도 종결한다. 명의 이전 뒤 수동 권한이 되살아나지 않는다.
select pg_temp.overseas_patch('public.complete_my_adult_verification(text,text)',
  $old$update private.adult_verifications
  set revoked_at = v_now, revoked_reason = 'superseded'$old$,
  $new$update private.overseas_adult_requests set valid_until=null where user_id=v_user and valid_until is not null;
  perform private.overseas_queue_destruction(id,'cancelled') from private.overseas_adult_requests
    where user_id=v_user and state not in ('closed','purging');
  update private.overseas_adult_requests set outcome='cancelled' where user_id=v_user and state='purging' and outcome='approved';
  update private.adult_verifications
  set revoked_at = v_now, revoked_reason = 'superseded'$new$);

create function private.overseas_policy_manager(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_operator_capability(p_actor,'operators.manage',true) and private.operator_mfa_session_verified(p_actor);
$$;
create function public.overseas_adult_management() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if not private.overseas_policy_manager(actor) then raise insufficient_privilege; end if;
  return jsonb_build_object('goods',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'enabled',a.good_id is not null) order by g.name)
    from public.goods g left join private.overseas_adult_goods a on a.good_id=g.id where g.sale_restriction='adult' and g.archived_at is null),'[]'::jsonb),
    'operators',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.nickname,'enabled',r.user_id is not null) order by p.nickname)
    from public.profiles p left join private.overseas_adult_reviewers r on r.user_id=p.id where p.role in ('admin','staff') and p.suspended_at is null
      and private.has_operator_capability(p.id,'platform.manage',true)),'[]'::jsonb));
end $$;
create function public.configure_overseas_adult_review(p_kind text,p_target text,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if not private.overseas_policy_manager(actor) or p_enabled is null then raise insufficient_privilege; end if;
  if p_kind='good' then
    if p_enabled then
      perform 1 from public.goods where id=p_target and sale_restriction='adult' and archived_at is null for update;
      if not found then return false; end if;
      insert into private.overseas_adult_goods values(p_target) on conflict do nothing;
    else delete from private.overseas_adult_goods where good_id=p_target; end if;
  elsif p_kind='reviewer' then
    if p_enabled then
      if not private.has_operator_capability(p_target::uuid,'platform.manage',true)
        or not exists(select 1 from auth.mfa_factors where user_id=p_target::uuid and status='verified') then return false; end if;
      insert into private.overseas_adult_reviewers values(p_target::uuid) on conflict do nothing;
    else delete from private.overseas_adult_reviewers where user_id=p_target::uuid; end if;
  else raise invalid_parameter_value; end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.overseas_adult.'||p_kind,p_target,jsonb_build_object('enabled',p_enabled));
  return true;
end $$;

-- 상품 표시 내용·제한이 바뀌면 운영자가 해당 상품을 다시 확인한다.
create function private.reset_overseas_good_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from private.overseas_adult_goods where good_id=new.id;
  return new;
end $$;
create trigger overseas_good_changed after update on public.goods for each row
  when ((old.sale_restriction,old.name,old.name_en,old.ip_id,old.description,old.image_path,old.gallery_paths,old.detail_image_path,old.detail_image_paths,old.description_image_paths,old.archived_at)
    is distinct from (new.sale_restriction,new.name,new.name_en,new.ip_id,new.description,new.image_path,new.gallery_paths,new.detail_image_path,new.detail_image_paths,new.description_image_paths,new.archived_at))
  execute function private.reset_overseas_good_approval();

do $grants$
declare f record;
begin
  for f in select p.oid::regprocedure signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and p.proname in ('overseas_member_active','overseas_reviewer','overseas_intake_open','overseas_valid_until',
      'overseas_queue_destruction','my_overseas_adult_request','begin_overseas_adult_request','reserve_overseas_adult_upload',
      'service_submit_overseas_adult_upload','cancel_overseas_adult_request','overseas_review_queue','open_overseas_adult_review',
      'overseas_adult_review_live','overseas_review_held','deliver_overseas_adult_review','decide_overseas_adult_review','withdraw_overseas_adult_requests',
      'service_overseas_adult_cleanup','service_finish_overseas_adult_cleanup','adult_allowed_for_good','overseas_policy_manager',
      'overseas_adult_management','configure_overseas_adult_review','reset_overseas_good_approval')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.nspname='public' then execute format('grant execute on function %s to %I',f.signature,
      case when f.proname like 'service_%' then 'service_role' else 'authenticated' end); end if;
  end loop;
end $grants$;
revoke all on function private.good_sale_restriction_visible(public.goods_sale_restriction,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction,text) from public,anon,authenticated,service_role;
grant execute on function public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction,text) to anon,authenticated;
commit;
