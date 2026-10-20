-- Reviewed: single public Q&A/review replies use monotonic source revisions and
-- actor/payload-bound receipts. Legacy writers remain internal for batch calls.
alter table public.product_questions add column reply_source_revision bigint not null default 0 check(reply_source_revision>=0);
alter table public.reviews add column reply_source_revision bigint not null default 0 check(reply_source_revision>=0);

create function private.advance_cs_reply_source_revision()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.reply_source_revision:=0;
  elsif tg_table_name='product_questions' then
    new.reply_source_revision:=old.reply_source_revision+case when
      row(new.body,new.answer_body,new.status) is distinct from row(old.body,old.answer_body,old.status) then 1 else 0 end;
  else
    new.reply_source_revision:=old.reply_source_revision+case when
      row(new.body,new.rating,new.image_paths,new.admin_reply,new.status) is distinct from
      row(old.body,old.rating,old.image_paths,old.admin_reply,old.status) then 1 else 0 end;
  end if;
  return new;
end $$;
revoke all on function private.advance_cs_reply_source_revision() from public,anon,authenticated,service_role;
create trigger cs_reply_source_revision before insert or update on public.product_questions
for each row execute function private.advance_cs_reply_source_revision();
create trigger cs_reply_source_revision before insert or update on public.reviews
for each row execute function private.advance_cs_reply_source_revision();

-- No target FK: deleting a customer record must not destroy a completed receipt
-- or let an ambiguous client replay create another write.
create table private.cs_reply_operations(
  operation_id uuid primary key,
  actor_id uuid not null,
  surface text not null check(surface in('product_question','review')),
  target_id uuid not null,
  expected_revision bigint not null check(expected_revision>=0),
  body text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.cs_reply_operations enable row level security;
revoke all on private.cs_reply_operations from public,anon,authenticated,service_role;

create function public.admin_cs_reply_context(p_surface text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_operator_capability('cs.manage',false);
  if p_surface is null or p_surface not in('product_question','review') or p_target_id is null then
    raise invalid_parameter_value using message='invalid_cs_reply_target'; end if;
  if p_surface='product_question' then
    select jsonb_build_object('id',id,'surface',p_surface,'body',body,'reply',answer_body,'replyAt',answered_at,
      'status',status,'revision',reply_source_revision::text) into result from public.product_questions where id=p_target_id;
  else
    select jsonb_build_object('id',id,'surface',p_surface,'body',body,'reply',admin_reply,'replyAt',admin_reply_at,
      'status',status,'revision',reply_source_revision::text,'rating',rating,'imagePaths',image_paths)
      into result from public.reviews where id=p_target_id;
  end if;
  if result is null then raise no_data_found using message='cs_reply_target_not_found'; end if;
  return result;
end $$;
revoke all on function public.admin_cs_reply_context(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_cs_reply_context(text,uuid) to authenticated;

create function public.admin_save_cs_reply(p_operation_id uuid,p_actor_id uuid,p_surface text,p_target_id uuid,p_body text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; previous private.cs_reply_operations; current_revision bigint; current_reply text;
  body_value text:=btrim(coalesce(p_body,''),E' \t\n\r\f\v'); result jsonb; did_change boolean;
begin
  actor:=private.require_operator_capability('cs.manage',false);
  if actor is distinct from p_actor_id then raise insufficient_privilege using message='cs_reply_account_changed'; end if;
  if p_operation_id is null or p_target_id is null or p_surface is null or p_surface not in('product_question','review')
    or p_expected_revision is null or p_expected_revision<0
    or char_length(body_value) not between (case when p_surface='review' then 2 else 1 end) and (case when p_surface='review' then 1000 else 2000 end) then
    raise invalid_parameter_value using message='invalid_cs_reply_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cs_reply_operation:'||p_operation_id::text,0));
  select * into previous from private.cs_reply_operations where operation_id=p_operation_id;
  if found then
    if previous.actor_id<>actor or previous.surface<>p_surface or previous.target_id<>p_target_id
      or previous.expected_revision<>p_expected_revision or previous.body<>body_value then
      raise sqlstate 'PT409' using message='cs_reply_operation_changed'; end if;
    return previous.result;
  end if;
  if p_surface='product_question' then
    select reply_source_revision,answer_body into current_revision,current_reply
      from public.product_questions where id=p_target_id for update;
  else
    select reply_source_revision,admin_reply into current_revision,current_reply
      from public.reviews where id=p_target_id for update;
  end if;
  if not found then raise no_data_found using message='cs_reply_target_not_found'; end if;
  -- CAS precedes the no-op check: stale same-body requests cannot silently pass.
  if current_revision<>p_expected_revision then raise sqlstate 'PT409' using message='cs_reply_source_changed'; end if;
  did_change:=current_reply is distinct from body_value;
  if did_change then
    if p_surface='product_question' then perform public.admin_answer_product_question(p_target_id,body_value);
    else perform public.admin_reply_to_review(p_target_id,body_value); end if;
    current_revision:=current_revision+1;
  end if;
  result:=jsonb_build_object('operationId',p_operation_id,'accountId',actor,'surface',p_surface,'id',p_target_id,
    'expectedRevision',p_expected_revision::text,'revision',current_revision::text,'body',body_value,
    'changed',did_change,'savedAt',clock_timestamp());
  insert into private.cs_reply_operations(operation_id,actor_id,surface,target_id,expected_revision,body,result)
    values(p_operation_id,actor,p_surface,p_target_id,p_expected_revision,body_value,result);
  return result;
end $$;
revoke all on function public.admin_save_cs_reply(uuid,uuid,text,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_cs_reply(uuid,uuid,text,uuid,text,bigint) to authenticated;

create function public.admin_cs_reply_operation(p_operation_id uuid,p_actor_id uuid,p_surface text,p_target_id uuid,p_body text,p_expected_revision bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; previous private.cs_reply_operations;
begin
  actor:=private.require_operator_capability('cs.manage',false);
  if actor is distinct from p_actor_id then raise insufficient_privilege using message='cs_reply_account_changed'; end if;
  if p_operation_id is null or p_target_id is null or p_surface is null or p_surface not in('product_question','review')
    or p_expected_revision is null or p_expected_revision<0 or p_body is null then
    raise invalid_parameter_value using message='invalid_cs_reply_request'; end if;
  select * into previous from private.cs_reply_operations where operation_id=p_operation_id;
  -- A read does not reveal another actor's receipt, even for a guessed UUID.
  if not found or previous.actor_id<>actor then return null; end if;
  if previous.surface<>p_surface or previous.target_id<>p_target_id or previous.expected_revision<>p_expected_revision
    or previous.body<>btrim(p_body,E' \t\n\r\f\v') then raise sqlstate 'PT409' using message='cs_reply_operation_changed'; end if;
  return previous.result;
end $$;
revoke all on function public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint) to authenticated;

revoke all on function public.admin_answer_product_question(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_reply_to_review(uuid,text) from public,anon,authenticated,service_role;
-- Migrations may run as postgres or supabase_admin. Preserve nested execution
-- explicitly for the writer/batch SECURITY DEFINER owners, never client roles.
do $$ declare owner_name text; begin
  for owner_name in select distinct pg_get_userbyid(proowner) from pg_proc where oid in
    ('public.admin_save_cs_reply(uuid,uuid,text,uuid,text,bigint)'::regprocedure,'public.admin_reply_reviews_batch(uuid,jsonb,text)'::regprocedure)
  loop
    execute format('grant execute on function public.admin_answer_product_question(uuid,text) to %I',owner_name);
    execute format('grant execute on function public.admin_reply_to_review(uuid,text) to %I',owner_name);
  end loop;
end $$;

select private.register_operator_internal_contract('private.advance_cs_reply_source_revision()'::regprocedure);
select private.register_operator_rpc_contract('public.admin_cs_reply_context(text,uuid)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_cs_reply(uuid,uuid,text,uuid,text,bigint)'::regprocedure,'cs.manage','write',false);
select private.register_operator_rpc_contract('public.admin_cs_reply_operation(uuid,uuid,text,uuid,text,bigint)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_answer_product_question(uuid,text)'::regprocedure,'cs.manage','retired',false);
select private.register_operator_rpc_contract('public.admin_reply_to_review(uuid,text)'::regprocedure,'cs.manage','retired',false);
notify pgrst,'reload schema';
