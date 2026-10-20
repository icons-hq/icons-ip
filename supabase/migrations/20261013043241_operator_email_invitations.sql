-- Email invitations reuse the existing durable dispatcher and its default-off
-- provider gate. No provider is enabled and no external message is sent here.
alter table private.email_intents drop constraint email_intents_source_check;
alter table private.email_intents add constraint email_intents_source_check check(source in ('auth_hook','account_deletion','order_delay_notice','operator_invitation'));
alter table private.email_intents drop constraint email_intents_message_kind_check;
alter table private.email_intents add constraint email_intents_message_kind_check check(message_kind in (
  'auth_signup','auth_recovery','auth_email_change_current','auth_email_change_new','auth_reauthentication','account_deletion_notice','order_delay_notice','operator_invitation'));
alter table private.email_intent_fences drop constraint email_intent_fences_source_check;
alter table private.email_intent_fences add constraint email_intent_fences_source_check check(source in ('auth_hook','account_deletion','order_delay_notice','operator_invitation'));
do $$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('public.enqueue_email_intent(text,text,text,text,text)'::regprocedure);
  revised:=replace(definition,'''auth_hook'',''account_deletion'',''order_delay_notice''','''auth_hook'',''account_deletion'',''order_delay_notice'',''operator_invitation''');
  revised:=replace(revised,'''account_deletion_notice'',''order_delay_notice''','''account_deletion_notice'',''order_delay_notice'',''operator_invitation''');
  revised:=replace(revised,' if target_content_revision is null',E' if (target_source=''operator_invitation'') is distinct from (target_message_kind=''operator_invitation'') then raise check_violation using message=''invalid_email_message_kind'';end if;\n if target_content_revision is null');
  if definition=revised or position('target_source=''operator_invitation''' in revised)=0 then raise exception 'operator email enqueue contract changed'; end if;
  execute revised;
  definition:=pg_get_functiondef('private.destroy_email_dispatch_evidence(timestamptz)'::regprocedure);
  revised:=replace(definition,'''account_deletion'',''order_delay_notice''','''account_deletion'',''order_delay_notice'',''operator_invitation''');
  if definition=revised then raise exception 'operator email retention contract changed'; end if;
  execute revised;
end $$;
revoke all on function public.enqueue_email_intent(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_email_intent(text,text,text,text,text) to service_role;

create table private.operator_invitations (
  id uuid primary key,
  recipient_email text not null check(length(recipient_email) between 3 and 320 and recipient_email=lower(btrim(recipient_email)) and recipient_email !~ '[[:cntrl:]]'),
  recipient_name text not null check(length(recipient_name) between 1 and 100 and recipient_name !~ '[[:cntrl:]]'),
  recipient_digest bytea not null check(octet_length(recipient_digest)=32),
  token_hash bytea not null unique check(octet_length(token_hash)=32),
  manager_role text not null check(manager_role in ('primary','deputy','influencer','agency','logistics')),
  duty text not null check(duty in ('sales','marketing','cs','design_content','logistics','accounting','management','other')),
  status text not null default 'pending' check(status in ('pending','accepted','cancelled','replaced')),
  revision integer not null default 1 check(revision>0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text check(cancellation_reason in ('operator_cancelled','reissued','inviter_access_revoked')),
  replaced_by uuid references private.operator_invitations(id) deferrable initially deferred,
  email_intent_id uuid not null unique references private.email_intents(id) on delete restrict,
  dispatch_claim_id uuid,
  dispatch_actor_id uuid references public.profiles(id) on delete set null,
  dispatch_attempted_at timestamptz,
  delivery_error text check(delivery_error in ('provider_not_configured','delivery_disabled','delivery_in_progress','delivery_outcome_unknown','provider_rejected','provider_retryable','delivery_needs_review','token_key_changed')),
  check(expires_at=created_at+interval '7 days'),
  check((status='accepted')=(accepted_at is not null)),
  check((status in ('cancelled','replaced'))=(cancelled_at is not null))
);
create index operator_invitations_recipient_idx on private.operator_invitations(recipient_email,status,expires_at);
create index operator_invitations_created_idx on private.operator_invitations(created_at desc,id desc);
alter table private.operator_invitations enable row level security;
revoke all on private.operator_invitations from public,anon,authenticated,service_role;

create function private.operator_invitation_rows(p_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.recipient_name,
    'maskedEmail',left(split_part(i.recipient_email,'@',1),1)||'***@'||split_part(i.recipient_email,'@',2),
    'managerRole',i.manager_role,'duty',i.duty,'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
    'revision',i.revision,'createdAt',i.created_at,'expiresAt',i.expires_at,'acceptedAt',i.accepted_at,'cancelledAt',i.cancelled_at,
    'emailState',e.state,'deliveryError',i.delivery_error,'dispatchAttemptedAt',i.dispatch_attempted_at)
    order by i.created_at desc,i.id desc),'[]'::jsonb)
  from private.operator_invitations i join private.email_intents e on e.id=i.email_intent_id where i.id=any(p_ids);
$$;
revoke all on function private.operator_invitation_rows(uuid[]) from public,anon,authenticated,service_role;

create function private.normalize_operator_invitation(p_entry jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare normalized jsonb; email text; name text;
begin
  if jsonb_typeof(p_entry) is distinct from 'object' or p_entry-array['id','email','name','managerRole','duty','tokenHash','sourceDigest','recipientDigest']::text[]<>'{}'::jsonb
    or jsonb_typeof(p_entry->'id') is distinct from 'string' or p_entry->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_entry->'email') is distinct from 'string' or jsonb_typeof(p_entry->'name') is distinct from 'string'
    or coalesce(p_entry->>'managerRole','') not in ('primary','deputy','influencer','agency','logistics')
    or coalesce(p_entry->>'duty','') not in ('sales','marketing','cs','design_content','logistics','accounting','management','other')
    or coalesce(p_entry->>'tokenHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_entry->>'sourceDigest','') !~ '^[0-9a-f]{64}$' or coalesce(p_entry->>'recipientDigest','') !~ '^[0-9a-f]{64}$'
    then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  email:=lower(btrim(p_entry->>'email')); name:=btrim(p_entry->>'name');
  if length(email)>320 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or email ~ '[[:cntrl:]]'
    or length(name) not between 1 and 100 or name ~ '[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  normalized:=p_entry||jsonb_build_object('id',(p_entry->>'id')::uuid,'email',email,'name',name);
  return normalized;
end $$;
revoke all on function private.normalize_operator_invitation(jsonb) from public,anon,authenticated,service_role;

-- Called only with the global operator state lock and an authorized actor.
-- enqueue_email_intent remains the single writer for durable email intents.
create function private.insert_operator_invitation(p_entry jsonb,p_actor uuid,p_created_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare entry jsonb:=private.normalize_operator_invitation(p_entry); intent jsonb; invitation_id uuid:=(entry->>'id')::uuid;
begin
  if exists(select 1 from auth.users u join private.operator_memberships m on m.profile_id=u.id where u.email_confirmed_at is not null and lower(u.email)=entry->>'email')
    then raise invalid_parameter_value using message='operator_already_manager'; end if;
  if exists(select 1 from private.operator_invitations where recipient_email=entry->>'email' and status='pending' and expires_at>p_created_at)
    then raise invalid_parameter_value using message='operator_invitation_pending'; end if;
  if (select count(*) from private.operator_memberships where manager_role<>'owner')+
    (select count(*) from private.operator_invitations where status='pending' and expires_at>p_created_at)>=1000
    then raise invalid_parameter_value using message='operator_limit'; end if;
  intent:=public.enqueue_email_intent('operator_invitation',entry->>'sourceDigest',entry->>'recipientDigest','operator_invitation','operator_invitation_v1');
  insert into private.operator_invitations(id,recipient_email,recipient_name,recipient_digest,token_hash,manager_role,duty,created_by,created_at,expires_at,email_intent_id)
  values(invitation_id,entry->>'email',entry->>'name',decode(entry->>'recipientDigest','hex'),decode(entry->>'tokenHash','hex'),entry->>'managerRole',entry->>'duty',p_actor,p_created_at,p_created_at+interval '7 days',(intent->>'intentId')::uuid);
  return invitation_id;
end $$;
revoke all on function private.insert_operator_invitation(jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.admin_list_operator_invitations(p_query text default '',p_status text default 'all',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=btrim(coalesce(p_query,'')); ids uuid[]; total_count bigint;
begin
  if not private.has_operator_capability((select auth.uid()),'operators.manage',true) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if length(q)>100 or p_status is null or p_status not in ('all','pending','accepted','cancelled','replaced','expired')
    or p_page is null or p_page<1 or p_page>1000000 or p_page_size is null or p_page_size not in (20,50,100) then raise invalid_parameter_value using message='invalid_operator_filter'; end if;
  with filtered as materialized (
    select id,created_at from private.operator_invitations
    where (q='' or strpos(lower(recipient_name),lower(q))>0 or strpos(recipient_email,lower(q))>0)
      and (p_status='all' or (p_status='expired' and status='pending' and expires_at<=now())
        or (status=p_status and (p_status<>'pending' or expires_at>now())))
  ), page_rows as (select * from filtered order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size)
  select (select count(*) from filtered),coalesce((select array_agg(id) from page_rows),'{}'::uuid[]) into total_count,ids;
  return jsonb_build_object('rows',private.operator_invitation_rows(ids),'total',total_count);
end $$;
revoke all on function public.admin_list_operator_invitations(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_operator_invitations(text,text,integer,integer) to authenticated;

create function public.admin_create_operator_invitations(p_entries jsonb,p_expected_access_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; entries jsonb; entry jsonb; request jsonb; result jsonb; ids uuid[]:='{}'; created_time timestamptz:=clock_timestamp();
begin
  if actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_operation_id is null or p_expected_access_revision is null or p_expected_access_revision<1 or jsonb_typeof(p_entries) is distinct from 'array' then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  if jsonb_array_length(p_entries) not between 1 and 10 then raise invalid_parameter_value using message='operator_invitation_batch_limit'; end if;
  select jsonb_agg(private.normalize_operator_invitation(value) order by value->>'id') into entries from jsonb_array_elements(p_entries);
  if (select count(distinct value->>'email') from jsonb_array_elements(entries))<>jsonb_array_length(entries)
    or (select count(distinct value->>'id') from jsonb_array_elements(entries))<>jsonb_array_length(entries) then raise invalid_parameter_value using message='operator_invitation_duplicate'; end if;
  request:=jsonb_build_object('entriesDigest',encode(extensions.digest(entries::text,'sha256'),'hex'),'expectedAccessRevision',p_expected_access_revision);
  select * into strict state from private.operator_access_state where id for update;
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.invited',request);
  if result is not null then return result; end if;
  if not state.configured then raise invalid_parameter_value using message='operator_setup_required'; end if;
  if state.revision<>p_expected_access_revision then raise sqlstate 'PT409' using message='operator_access_changed'; end if;
  for entry in select value from jsonb_array_elements(entries) loop ids:=array_append(ids,private.insert_operator_invitation(entry,actor,created_time)); end loop;
  update private.operator_access_state set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('invitationIds',to_jsonb(ids),'count',cardinality(ids),'accessRevision',state.revision);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.invited','operators',jsonb_build_object('request',request,'result',result));
  return result;
end $$;
revoke all on function public.admin_create_operator_invitations(jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_operator_invitations(jsonb,bigint,uuid) to authenticated;

create function public.admin_cancel_operator_invitation(p_invitation_id uuid,p_expected_revision integer,p_expected_access_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; invitation private.operator_invitations; request jsonb; result jsonb;
begin
  if actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_invitation_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_access_revision is null or p_expected_access_revision<1 then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  select * into strict state from private.operator_access_state where id for update;
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  request:=jsonb_build_object('invitationId',p_invitation_id,'expectedRevision',p_expected_revision,'expectedAccessRevision',p_expected_access_revision);
  result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.invitation_cancelled',request);
  if result is not null then return result; end if;
  if state.revision<>p_expected_access_revision then raise sqlstate 'PT409' using message='operator_access_changed'; end if;
  select * into invitation from private.operator_invitations where id=p_invitation_id for update;
  if not found or invitation.revision<>p_expected_revision then raise sqlstate 'PT409' using message='operator_invitation_changed'; end if;
  if invitation.status<>'pending' then raise invalid_parameter_value using message='operator_invitation_not_pending'; end if;
  update private.operator_invitations set status='cancelled',revision=revision+1,cancelled_at=clock_timestamp(),cancelled_by=actor,cancellation_reason='operator_cancelled' where id=p_invitation_id;
  update private.operator_access_state set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('revision',invitation.revision+1,'accessRevision',state.revision);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.invitation_cancelled','operator-invitation:'||p_invitation_id::text,jsonb_build_object('request',request,'result',result));
  return result;
end $$;
revoke all on function public.admin_cancel_operator_invitation(uuid,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_cancel_operator_invitation(uuid,integer,bigint,uuid) to authenticated;

create function public.admin_reissue_operator_invitation(p_invitation_id uuid,p_entry jsonb,p_expected_revision integer,p_expected_access_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; previous private.operator_invitations; entry jsonb:=private.normalize_operator_invitation(p_entry); request jsonb; result jsonb; new_id uuid; created_time timestamptz:=clock_timestamp();
begin
  if actor is null then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_invitation_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_access_revision is null or p_expected_access_revision<1 then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  select * into strict state from private.operator_access_state where id for update;
  perform private.require_actor_operator_capability(actor,'operators.manage',true);
  request:=jsonb_build_object('invitationId',p_invitation_id,'entryDigest',encode(extensions.digest(entry::text,'sha256'),'hex'),'expectedRevision',p_expected_revision,'expectedAccessRevision',p_expected_access_revision);
  result:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.operator.invitation_reissued',request);
  if result is not null then return result; end if;
  if not state.configured then raise invalid_parameter_value using message='operator_setup_required'; end if;
  if state.revision<>p_expected_access_revision then raise sqlstate 'PT409' using message='operator_access_changed'; end if;
  select * into previous from private.operator_invitations where id=p_invitation_id for update;
  if not found or previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='operator_invitation_changed'; end if;
  if previous.status not in ('pending','cancelled') or previous.recipient_email<>entry->>'email' or previous.id=(entry->>'id')::uuid
    then raise invalid_parameter_value using message='operator_invitation_reissue_invalid'; end if;
  update private.operator_invitations set status='replaced',revision=revision+1,cancelled_at=created_time,cancelled_by=actor,cancellation_reason='reissued',replaced_by=(entry->>'id')::uuid where id=p_invitation_id;
  new_id:=private.insert_operator_invitation(entry,actor,created_time);
  update private.operator_access_state set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('invitationIds',jsonb_build_array(new_id),'count',1,'accessRevision',state.revision);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.operator.invitation_reissued','operator-invitation:'||p_invitation_id::text,jsonb_build_object('request',request,'result',result));
  return result;
end $$;
revoke all on function public.admin_reissue_operator_invitation(uuid,jsonb,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_reissue_operator_invitation(uuid,jsonb,integer,bigint,uuid) to authenticated;

create function private.cancel_operator_invites_on_authority_loss()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
  if old.manager_role in ('owner','primary') and (tg_op='DELETE' or new.manager_role not in ('owner','primary')) then
    update private.operator_invitations set status='cancelled',revision=revision+1,cancelled_at=clock_timestamp(),cancellation_reason='inviter_access_revoked'
    where created_by=old.profile_id and status='pending';
  end if;
  return null;
end $$;
revoke all on function private.cancel_operator_invites_on_authority_loss() from public,anon,authenticated,service_role;
create trigger cancel_operator_invites_on_authority_loss after update of manager_role or delete on private.operator_memberships for each row execute function private.cancel_operator_invites_on_authority_loss();

create function public.get_my_operator_invitation(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); invitation private.operator_invitations; current_email text; confirmed_at timestamptz;
begin
  if actor is null then raise insufficient_privilege using message='authentication_required'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  select lower(email),email_confirmed_at into current_email,confirmed_at from auth.users where id=actor;
  if confirmed_at is null then return jsonb_build_object('status','email_confirmation_required'); end if;
  select * into invitation from private.operator_invitations where token_hash=decode(p_token_hash,'hex');
  if not found or (invitation.recipient_email is distinct from current_email and invitation.accepted_by is distinct from actor)
    then return jsonb_build_object('status','unavailable'); end if;
  if invitation.status='accepted' and invitation.accepted_by=actor then
    return jsonb_build_object('status','accepted','managerRole',(select manager_role from private.operator_memberships where profile_id=actor),'accessActive',
      coalesce(private.operator_access_for(actor)->>'mode'='configured',false));
  end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() or not private.has_operator_capability(invitation.created_by,'operators.manage',true)
    or exists(select 1 from public.profiles where id=actor and suspended_at is not null)
    or exists(select 1 from private.account_action_fences where subject_user_id=actor) then return jsonb_build_object('status','unavailable'); end if;
  return jsonb_build_object('status','pending','managerRole',invitation.manager_role,'duty',invitation.duty,'expiresAt',invitation.expires_at);
end $$;
revoke all on function public.get_my_operator_invitation(text) from public,anon,authenticated,service_role;
grant execute on function public.get_my_operator_invitation(text) to authenticated;

create function public.accept_operator_invitation(p_token_hash text,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); state private.operator_access_state; invitation private.operator_invitations; current_email text; confirmed_at timestamptz; result jsonb; request jsonb;
begin
  if actor is null then raise insufficient_privilege using message='authentication_required'; end if;
  if p_operation_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value using message='invalid_operator_invitation'; end if;
  select * into strict state from private.operator_access_state where id for update;
  select * into invitation from private.operator_invitations where token_hash=decode(p_token_hash,'hex');
  if not found then raise insufficient_privilege using message='operator_invitation_unavailable'; end if;
  perform private.lock_operator_subjects(array[actor,invitation.created_by]);
  select * into invitation from private.operator_invitations where id=invitation.id for update;
  if not state.configured or not exists(select 1 from public.profiles where id=actor and suspended_at is null)
    or exists(select 1 from private.account_action_fences where subject_user_id=actor) then raise insufficient_privilege using message='operator_invitation_unavailable'; end if;
  select lower(email),email_confirmed_at into current_email,confirmed_at from auth.users where id=actor;
  if confirmed_at is null then raise insufficient_privilege using message='operator_invitation_email_unverified'; end if;
  if invitation.status='accepted' and invitation.accepted_by=actor then
    return jsonb_build_object('status','accepted','managerRole',(select manager_role from private.operator_memberships where profile_id=actor),
      'accessActive',coalesce(private.operator_access_for(actor)->>'mode'='configured',false),'accessRevision',state.revision);
  end if;
  if invitation.recipient_email is distinct from current_email or invitation.status<>'pending' or invitation.expires_at<=clock_timestamp()
    or not private.has_operator_capability(invitation.created_by,'operators.manage',true) then raise insufficient_privilege using message='operator_invitation_unavailable'; end if;
  if exists(select 1 from private.operator_memberships where profile_id=actor) then raise invalid_parameter_value using message='operator_already_manager'; end if;
  if (select count(*) from private.operator_memberships where manager_role<>'owner')>=1000 then raise invalid_parameter_value using message='operator_limit'; end if;
  request:=jsonb_build_object('invitationId',invitation.id);
  if exists(select 1 from public.audit_log where id=p_operation_id) then raise unique_violation using message='operation_conflict'; end if;
  update public.profiles set role=case when role='user' then 'staff'::public.user_role else role end where id=actor;
  insert into private.operator_memberships(profile_id,manager_role,updated_by) values(actor,invitation.manager_role,invitation.created_by);
  insert into public.operator_assignments(profile_id,duty) values(actor,invitation.duty)
    on conflict(profile_id) do update set duty=excluded.duty,revision=operator_assignments.revision+1,updated_at=clock_timestamp();
  update private.operator_invitations set status='accepted',revision=revision+1,accepted_by=actor,accepted_at=clock_timestamp() where id=invitation.id;
  update private.operator_access_state set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id returning * into state;
  result:=jsonb_build_object('status','accepted','managerRole',invitation.manager_role,'accessActive',true,'accessRevision',state.revision);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'operator.invitation_accepted','operator-invitation:'||invitation.id::text,jsonb_build_object('request',request,'result',result));
  return result;
end $$;
revoke all on function public.accept_operator_invitation(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.accept_operator_invitation(text,uuid) to authenticated;

create function public.service_prepare_operator_invitation_email(p_invitation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare invitation private.operator_invitations; claim_id uuid:=extensions.gen_random_uuid();
begin
  perform 1 from private.operator_access_state where id for update;
  select * into invitation from private.operator_invitations where id=p_invitation_id;
  if not found then return jsonb_build_object('kind','unavailable'); end if;
  perform private.lock_operator_subjects(array[p_actor_id,invitation.created_by]);
  perform private.require_actor_operator_capability(p_actor_id,'operators.manage',true);
  select * into invitation from private.operator_invitations where id=p_invitation_id for update;
  if invitation.status<>'pending' or invitation.expires_at<=clock_timestamp() or not private.has_operator_capability(invitation.created_by,'operators.manage',true)
    then return jsonb_build_object('kind','unavailable'); end if;
  update private.operator_invitations set dispatch_claim_id=claim_id,dispatch_actor_id=p_actor_id,dispatch_attempted_at=clock_timestamp(),delivery_error=null where id=invitation.id;
  return jsonb_build_object('kind','ready','id',invitation.id,'claimId',claim_id,'intentId',invitation.email_intent_id,'recipient',invitation.recipient_email,
    'name',invitation.recipient_name,'managerRole',invitation.manager_role,'expiresAt',invitation.expires_at,'tokenHash',encode(invitation.token_hash,'hex'));
end $$;
revoke all on function public.service_prepare_operator_invitation_email(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_prepare_operator_invitation_email(uuid,uuid) to service_role;

create function public.service_finish_operator_invitation_email(p_invitation_id uuid,p_claim_id uuid,p_error text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare affected integer;
begin
  if p_error is not null and p_error not in ('provider_not_configured','delivery_disabled','delivery_in_progress','delivery_outcome_unknown','provider_rejected','provider_retryable','delivery_needs_review','token_key_changed')
    then raise invalid_parameter_value using message='invalid_operator_invitation_delivery_error'; end if;
  -- Completes only a pre-authorized dispatch receipt. Never changes membership,
  -- pending/accepted/cancelled state, or the token after authority is revoked.
  update private.operator_invitations set dispatch_claim_id=null,delivery_error=p_error where id=p_invitation_id and dispatch_claim_id=p_claim_id;
  get diagnostics affected=row_count;
  return affected=1;
end $$;
revoke all on function public.service_finish_operator_invitation_email(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_finish_operator_invitation_email(uuid,uuid,text) to service_role;

create function private.lock_operator_invitation_dispatch(p_intent_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare invitation private.operator_invitations;
begin
  if not exists(select 1 from private.email_intents where id=p_intent_id and source='operator_invitation') then return true; end if;
  perform 1 from private.operator_access_state where id for update;
  select * into invitation from private.operator_invitations where email_intent_id=p_intent_id;
  if not found then return false; end if;
  perform private.lock_operator_subjects(array[invitation.created_by,invitation.dispatch_actor_id]);
  select * into invitation from private.operator_invitations where email_intent_id=p_intent_id for update;
  return invitation.status='pending' and invitation.expires_at>clock_timestamp() and invitation.dispatch_claim_id is not null
    and private.has_operator_capability(invitation.created_by,'operators.manage',true)
    and private.has_operator_capability(invitation.dispatch_actor_id,'operators.manage',true);
end $$;
revoke all on function private.lock_operator_invitation_dispatch(uuid) from public,anon,authenticated,service_role;
do $$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('public.claim_email_intent_dispatch(uuid,text)'::regprocedure);
  revised:=replace(definition,E'begin\n select * into strict v_control',E'begin\n if not private.lock_operator_invitation_dispatch(target_intent_id) then\n  return jsonb_build_object(''kind'',''disabled'',''state'',(select state from private.email_intents where id=target_intent_id));\n end if;\n select * into strict v_control');
  if definition=revised then raise exception 'operator dispatch claim contract changed'; end if;
  execute revised;
end $$;
revoke all on function public.claim_email_intent_dispatch(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_email_intent_dispatch(uuid,text) to service_role;

select private.register_operator_rpc_contract('public.admin_list_operator_invitations(text,text,integer,integer)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_create_operator_invitations(jsonb,bigint,uuid)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_cancel_operator_invitation(uuid,integer,bigint,uuid)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_reissue_operator_invitation(uuid,jsonb,integer,bigint,uuid)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.service_prepare_operator_invitation_email(uuid,uuid)','operators.manage','service_start',true);
select private.register_operator_rpc_contract('public.service_finish_operator_invitation_email(uuid,uuid,text)','operators.manage','service_finish',false);
-- These recipient-only flows verify the inviter's stored authority and the
-- caller's confirmed Auth email; recipients need no operator grant beforehand.
select private.register_operator_rpc_contract('public.get_my_operator_invitation(text)','operators.manage','manual',true);
select private.register_operator_rpc_contract('public.accept_operator_invitation(text,uuid)','operators.manage','manual',true);
notify pgrst,'reload schema';
