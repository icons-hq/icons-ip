begin;
-- Optional identified activity has its own notice, consent and ledger. It never
-- joins the anonymous analytics session ledger or inherits marketing consent.
create table private.member_activity_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 revision bigint not null default 1 check(revision>0), enabled_since timestamptz, updated_at timestamptz not null default clock_timestamp()
);
insert into private.member_activity_settings(singleton) values(true);
create table private.member_activity_consents (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 choice text not null check(choice in ('accepted','declined')), notice_version text not null check(notice_version='member-activity-v1'),
 revision bigint not null check(revision>0), accepted_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
 check((choice='accepted')=(accepted_at is not null))
);
create table private.member_activity_events (
 user_id uuid not null references public.profiles(id) on delete cascade, event_id uuid not null,
 consent_revision bigint not null, kind text not null check(kind in ('visit','video_started','video_completed')),
 page_kind text not null check(page_kind in ('home','shop','good','stories','story','ip','events','event')),
 target_id text not null check(char_length(target_id) between 1 and 200), asset_id uuid,
 category_id uuid, observed_at timestamptz not null default clock_timestamp(),
 primary key(user_id,event_id), check((kind='visit')=(asset_id is null))
);
create index member_activity_user_time on private.member_activity_events(user_id,observed_at desc);
create index member_activity_target_time on private.member_activity_events(target_id,observed_at desc,user_id) where page_kind='good';
create index member_activity_retention on private.member_activity_events(observed_at);
alter table private.member_activity_settings enable row level security;
alter table private.member_activity_consents enable row level security;
alter table private.member_activity_events enable row level security;
revoke all on private.member_activity_settings,private.member_activity_consents,private.member_activity_events from public,anon,authenticated,service_role;

create function private.require_member_activity_identity(p_actor uuid,p_session uuid,p_customer boolean default true) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then
  raise insufficient_privilege using message='member_activity_auth_changed'; end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='member_activity_auth_changed'; end if;
 if p_customer then
  perform 1 from public.profiles p where p.id=p_actor and p.role='user' and p.onboarded_at is not null and p.suspended_at is null
   and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb
   and p.birth_date<=((clock_timestamp() at time zone 'Asia/Seoul')::date-interval '14 years')::date for update;
  if not found or exists(select 1 from private.account_action_fences f where f.subject_user_id=p_actor) then
   raise insufficient_privilege using message='member_activity_unavailable'; end if;
 end if;
end $$;
revoke all on function private.require_member_activity_identity(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.member_activity_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_value uuid:=(auth.jwt()->>'session_id')::uuid; c private.member_activity_consents; s private.member_activity_settings;
begin
 if actor is null or session_value is null or not exists(select 1 from auth.sessions where id=session_value and user_id=actor and (not_after is null or not_after>statement_timestamp())) then
  raise insufficient_privilege using message='member_activity_auth_changed';end if;
 if not exists(select 1 from public.profiles p where p.id=actor and p.role='user' and p.onboarded_at is not null and p.suspended_at is null
   and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb and p.birth_date<=((clock_timestamp() at time zone 'Asia/Seoul')::date-interval '14 years')::date)
  or exists(select 1 from private.account_action_fences f where f.subject_user_id=actor) then return null;end if;
 select * into s from private.member_activity_settings where singleton;
 select * into c from private.member_activity_consents where user_id=actor;
 return jsonb_build_object('actorId',actor,'sessionId',session_value,'enabled',s.enabled,'choice',coalesce(c.choice,'unset'),'revision',coalesce(c.revision,0),
  'noticeVersion','member-activity-v1','acceptedAt',c.accepted_at);
end $$;
revoke all on function public.member_activity_state() from public,anon,authenticated,service_role;
grant execute on function public.member_activity_state() to authenticated;

create function public.set_member_activity_consent(p_choice text,p_expected_revision bigint,p_expected_actor uuid,p_expected_session uuid,p_notice_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.member_activity_consents; s private.member_activity_settings;
begin
 select * into s from private.member_activity_settings where singleton for share;
 perform private.require_member_activity_identity(p_expected_actor,p_expected_session);
 if p_choice is null or p_choice not in ('accepted','declined') or p_expected_revision is null or p_expected_revision<0 or p_notice_version is distinct from 'member-activity-v1' then
  raise invalid_parameter_value using message='invalid_member_activity_choice';end if;
 if p_choice='accepted' and not s.enabled then raise object_not_in_prerequisite_state using message='member_activity_disabled';end if;
 select * into c from private.member_activity_consents where user_id=p_expected_actor for update;
 if coalesce(c.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='member_activity_choice_changed';end if;
 if c.choice is distinct from p_choice then
  insert into private.member_activity_consents(user_id,choice,notice_version,revision,accepted_at)
   values(p_expected_actor,p_choice,p_notice_version,coalesce(c.revision,0)+1,case when p_choice='accepted' then clock_timestamp() end)
   on conflict(user_id) do update set choice=excluded.choice,notice_version=excluded.notice_version,revision=excluded.revision,accepted_at=excluded.accepted_at,updated_at=clock_timestamp();
 end if;
 if p_choice='declined' then delete from private.member_activity_events where user_id=p_expected_actor;end if;
 return public.member_activity_state();
end $$;
revoke all on function public.set_member_activity_consent(text,bigint,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_member_activity_consent(text,bigint,uuid,uuid,text) to authenticated;

create function public.record_member_activity_event(p_event_id uuid,p_kind text,p_page_kind text,p_target_id text,p_asset_id uuid,
 p_expected_revision bigint,p_expected_actor uuid,p_expected_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.member_activity_consents; target jsonb; old private.member_activity_events; s private.member_activity_settings; at_value timestamptz:=clock_timestamp();
begin
 select * into s from private.member_activity_settings where singleton for share;
 perform private.require_member_activity_identity(p_expected_actor,p_expected_session);
 select * into c from private.member_activity_consents where user_id=p_expected_actor for share;
 if not s.enabled or c.choice is distinct from 'accepted' or c.revision is distinct from p_expected_revision then
  raise insufficient_privilege using message='member_activity_consent_required';end if;
 if p_event_id is null or p_kind is null or p_kind not in ('visit','video_started','video_completed') or p_page_kind is null
  or p_page_kind not in ('home','shop','good','stories','story','ip','events','event') or p_target_id is null or char_length(p_target_id) not between 1 and 200
  or (p_kind='visit')<>(p_asset_id is null) then raise invalid_parameter_value using message='invalid_member_activity_event';end if;
 target:=private.store_analytics_page(p_page_kind,p_target_id,at_value);
 if target is null then raise no_data_found using message='member_activity_target_unavailable';end if;
 if p_kind<>'visit' and (p_page_kind<>'good' or not exists(select 1 from private.goods_media_bindings b join private.goods_media_assets a on a.id=p_asset_id and a.status='attached'
   where b.good_id=p_target_id and p_asset_id in (b.video_asset_id,b.shortclip_asset_id))) then
  raise no_data_found using message='member_activity_video_unavailable';end if;
 select * into old from private.member_activity_events where user_id=p_expected_actor and event_id=p_event_id;
 if found then
  if old.consent_revision<>c.revision or old.kind<>p_kind or old.page_kind<>p_page_kind or old.target_id<>p_target_id or old.asset_id is distinct from p_asset_id then
   raise sqlstate 'PT409' using message='member_activity_event_conflict';end if;
  return jsonb_build_object('recorded',true,'duplicate',true);
 end if;
 if (select count(*) from private.member_activity_events where user_id=p_expected_actor and observed_at>at_value-interval '1 minute')>=120 then
  raise sqlstate 'P0429' using message='member_activity_rate_limited';end if;
 insert into private.member_activity_events(user_id,event_id,consent_revision,kind,page_kind,target_id,asset_id,category_id,observed_at)
  values(p_expected_actor,p_event_id,c.revision,p_kind,p_page_kind,p_target_id,p_asset_id,(target->>'categoryId')::uuid,at_value);
 return jsonb_build_object('recorded',true,'duplicate',false);
end $$;
revoke all on function public.record_member_activity_event(uuid,text,text,text,uuid,bigint,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_member_activity_event(uuid,text,text,text,uuid,bigint,uuid,uuid) to authenticated;

create function public.admin_get_member_activity_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return (select jsonb_build_object('enabled',enabled,'revision',revision,'enabledSince',enabled_since,'updatedAt',updated_at,'noticeVersion','member-activity-v1','retentionDays',90) from private.member_activity_settings where singleton);
end $$;
revoke all on function public.admin_get_member_activity_settings() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_member_activity_settings() to authenticated;
select private.register_operator_rpc_contract('public.admin_get_member_activity_settings()'::regprocedure,'marketing.manage','read',false);

create function public.admin_save_member_activity_settings(p_enabled boolean,p_expected_revision bigint,p_operation_id uuid,p_expected_actor uuid,p_expected_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.member_activity_settings; prior public.audit_log; result jsonb; request jsonb;
begin
 perform private.require_operator_capability('marketing.manage',true);
 perform private.require_member_activity_identity(p_expected_actor,p_expected_session,false);
 if p_enabled is null or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null then raise invalid_parameter_value using message='invalid_member_activity_settings';end if;
 select * into s from private.member_activity_settings where singleton for update;
 request:=jsonb_build_object('enabled',p_enabled,'revision',p_expected_revision,'sessionId',p_expected_session);
 select * into prior from public.audit_log where id=p_operation_id;
 if found then
  if prior.actor_id is distinct from p_expected_actor or prior.action<>'marketing.member_activity_settings' or prior.diff->'request' is distinct from request then
   raise sqlstate 'PT409' using message='member_activity_operation_conflict';end if;
  return prior.diff->'result';
 end if;
 if s.revision<>p_expected_revision then raise sqlstate 'PT409' using message='member_activity_settings_changed';end if;
 update private.member_activity_settings set enabled=p_enabled,revision=revision+1,updated_at=clock_timestamp(),
  enabled_since=case when p_enabled and not s.enabled then clock_timestamp() when p_enabled then s.enabled_since else null end where singleton;
 result:=public.admin_get_member_activity_settings();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_expected_actor,'marketing.member_activity_settings','member_activity',jsonb_build_object('request',request,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_member_activity_settings(boolean,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_member_activity_settings(boolean,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_member_activity_settings(boolean,bigint,uuid,uuid,uuid)'::regprocedure,'marketing.manage','write',false);

create function public.process_member_activity_retention() returns jsonb
language plpgsql security definer set search_path='' as $$
declare removed bigint; cutoff timestamptz:=(((clock_timestamp() at time zone 'Asia/Seoul')::date-89)::timestamp at time zone 'Asia/Seoul');
begin
 if auth.role() is distinct from 'service_role' and session_user<>'postgres' then raise insufficient_privilege;end if;
 delete from private.member_activity_events where observed_at<cutoff;get diagnostics removed=row_count;
 return jsonb_build_object('removed',removed,'cutoff',cutoff);
end $$;
revoke all on function public.process_member_activity_retention() from public,anon,authenticated,service_role;
grant execute on function public.process_member_activity_retention() to service_role;

create function private.member_activity_fenced() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=new.subject_user_id for update;
 delete from private.member_activity_events where user_id=new.subject_user_id;
 update private.member_activity_consents set choice='declined',accepted_at=null,revision=revision+1,updated_at=clock_timestamp() where user_id=new.subject_user_id;
 return new;
end $$;
revoke all on function private.member_activity_fenced() from public,anon,authenticated,service_role;
create trigger member_activity_account_fenced after insert on private.account_action_fences for each row execute function private.member_activity_fenced();
commit;
