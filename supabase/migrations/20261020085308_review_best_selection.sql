-- Independently selected BEST reviews. This ledger does not award benefits.
create table private.review_best_selections (
 review_id uuid primary key references public.reviews(id) on delete cascade,
 selected boolean not null default false,
 review_fingerprint text,
 revision integer not null default 1 check(revision>0),
 selected_at timestamptz,
 updated_by uuid references public.profiles(id) on delete set null,
 reason text not null check(char_length(reason) between 2 and 500),
 invalidated_at timestamptz,
 invalidation_reason text check(invalidation_reason in ('review_changed','purchase_changed')),
 updated_at timestamptz not null default clock_timestamp(),
 check(not selected or (review_fingerprint is not null and selected_at is not null)),
 check((invalidated_at is null)=(invalidation_reason is null))
);
create table private.review_best_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 revision integer not null default 0 check(revision>=0), updated_at timestamptz not null default clock_timestamp()
);
insert into private.review_best_settings(id) values(true);
alter table private.review_best_selections enable row level security;
alter table private.review_best_settings enable row level security;
revoke all on private.review_best_selections,private.review_best_settings from public,anon,authenticated,service_role;

create function private.review_best_problem(p_review public.reviews)
returns text language plpgsql stable security definer set search_path='' as $$
begin
 if p_review.id is null then return 'review_deleted';end if;
 if p_review.status<>'visible' then return 'review_hidden';end if;
 if not private.review_event_purchase_eligible(p_review.order_id,p_review.user_id,p_review.good_id) then return 'purchase_ineligible';end if;
 if not exists(select 1 from public.profiles where id=p_review.user_id and suspended_at is null)
   or private.is_account_write_fenced(p_review.user_id) then return 'customer_unavailable';end if;
 if not exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_review.good_id
   and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null) then return 'good_unavailable';end if;
 return null;
end $$;
revoke all on function private.review_best_problem(public.reviews) from public,anon,authenticated,service_role;

create function private.review_best_state(p_review public.reviews)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare chosen private.review_best_selections; problem text;
begin
 select * into chosen from private.review_best_selections where review_id=p_review.id;
 problem:=private.review_best_problem(p_review);
 if problem is null and chosen.selected and (chosen.invalidated_at is not null or chosen.review_fingerprint is distinct from private.review_event_review_fingerprint(p_review)) then problem:=case when chosen.invalidation_reason='purchase_changed' then 'purchase_changed' else 'review_changed' end;end if;
 return jsonb_build_object('reviewId',p_review.id,'selected',coalesce(chosen.selected,false),'revision',coalesce(chosen.revision,0),
   'reviewFingerprint',private.review_event_review_fingerprint(p_review),'selectedAt',chosen.selected_at,'reason',chosen.reason,
   'problem',problem,'state',case when not coalesce(chosen.selected,false) then 'not_selected' when problem is null then 'selected' else 'needs_review' end);
end $$;
revoke all on function private.review_best_state(public.reviews) from public,anon,authenticated,service_role;

create function public.admin_get_review_best_states(p_review_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_review_ids is null or cardinality(p_review_ids)>100 or array_position(p_review_ids,null) is not null then raise invalid_parameter_value using message='invalid_best_reviews';end if;
 return (select coalesce(jsonb_agg(private.review_best_state(r) order by r.id),'[]'::jsonb) from public.reviews r where r.id=any(p_review_ids));
end $$;
revoke all on function public.admin_get_review_best_states(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_review_best_states(uuid[]) to authenticated;

create function public.admin_set_review_best(p_review_id uuid,p_selected boolean,p_reason text,p_expected_revision integer,p_review_fingerprint text,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); review public.reviews; previous private.review_best_selections; request jsonb; receipt jsonb; problem text; purchase_id uuid;
begin
 perform private.require_actor_operator_capability(actor,'cs.manage');
 if p_review_id is null or p_selected is null or p_reason is null or char_length(btrim(p_reason)) not between 2 and 500 or p_reason~'[[:cntrl:]]'
  or p_expected_revision is null or p_expected_revision<0 or p_review_fingerprint is null or p_review_fingerprint!~'^[0-9a-f]{32}$' or p_operation_id is null then raise invalid_parameter_value using message='invalid_best_review';end if;
 request:=jsonb_build_object('reviewId',p_review_id,'selected',p_selected,'reason',btrim(p_reason),'expectedRevision',p_expected_revision,'reviewFingerprint',p_review_fingerprint);
 perform pg_advisory_xact_lock(hashtextextended('review-best-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_best.selected',request);if receipt is not null then return receipt;end if;
 -- Serialize even the first selection (there is no selection row to lock yet)
 -- with purchase invalidation. Never take an order/payment row lock from here.
 select order_id into purchase_id from public.reviews where id=p_review_id;
 if not found then raise no_data_found using message='review_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended('review-best-order:'||purchase_id::text,0));
 -- Review edits lock this row before invalidating selection; keep the same order.
 select * into review from public.reviews where id=p_review_id for update;
 if not found then raise no_data_found using message='review_not_found';end if;
 if review.order_id<>purchase_id then raise sqlstate 'PT409' using message='best_review_changed';end if;
 select * into previous from private.review_best_selections where review_id=p_review_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='best_review_revision_conflict';end if;
 if private.review_event_review_fingerprint(review) is distinct from p_review_fingerprint then raise sqlstate 'PT409' using message='best_review_changed';end if;
 if p_selected then
  problem:=private.review_best_problem(review);if problem is not null then raise check_violation using message=problem;end if;
 end if;
 insert into private.review_best_selections(review_id,selected,review_fingerprint,selected_at,updated_by,reason)
 values(p_review_id,p_selected,case when p_selected then p_review_fingerprint else null end,case when p_selected then clock_timestamp() else null end,actor,btrim(p_reason))
 on conflict(review_id) do update set selected=excluded.selected,review_fingerprint=excluded.review_fingerprint,selected_at=excluded.selected_at,
  updated_by=excluded.updated_by,reason=excluded.reason,invalidated_at=null,invalidation_reason=null,revision=review_best_selections.revision+1,updated_at=clock_timestamp();
 receipt:=private.review_best_state(review);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_best.selected','review:'||p_review_id,
  jsonb_build_object('request',request,'before',jsonb_build_object('selected',coalesce(previous.selected,false),'revision',coalesce(previous.revision,0)),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_set_review_best(uuid,boolean,text,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_review_best(uuid,boolean,text,integer,text,uuid) to authenticated;

create function private.invalidate_review_best(p_review_ids uuid[],p_reason text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare changed record;
begin
 for changed in select review_id from private.review_best_selections where review_id=any(p_review_ids) and selected and invalidated_at is null order by review_id for update loop
  update private.review_best_selections set invalidated_at=clock_timestamp(),invalidation_reason=p_reason,revision=revision+1,updated_at=clock_timestamp() where review_id=changed.review_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'review.best.invalidated','review:'||changed.review_id,jsonb_build_object('reason',p_reason));
 end loop;
end $$;
revoke all on function private.invalidate_review_best(uuid[],text) from public,anon,authenticated,service_role;
create function private.review_best_review_changed()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
 if private.review_event_review_fingerprint(old) is distinct from private.review_event_review_fingerprint(new) then perform private.invalidate_review_best(array[new.id],'review_changed');end if;
 return new;
end $$;
revoke all on function private.review_best_review_changed() from public,anon,authenticated,service_role;
create trigger review_best_review_changed after update of body,rating,image_paths,status on public.reviews for each row execute function private.review_best_review_changed();

create function private.review_best_purchase_changed()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare changed_order_id uuid;
begin
 if tg_table_name='orders' then
  if new.status='canceled' then changed_order_id:=new.id;end if;
 elsif tg_table_name='payments' then
  if new.purpose='order' and new.status='refunded' then changed_order_id:=new.ref_id;end if;
 elsif new.claim_type in ('cancel','return') and (new.status='completed' or new.stage='completed') then changed_order_id:=new.order_id;
 end if;
 if changed_order_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('review-best-order:'||changed_order_id::text,0));
  perform private.invalidate_review_best(array(select id from public.reviews r where r.order_id=changed_order_id),'purchase_changed');
 end if;
 return new;
end $$;
revoke all on function private.review_best_purchase_changed() from public,anon,authenticated,service_role;
create trigger review_best_order_canceled after update of status on public.orders for each row when(old.status is distinct from new.status) execute function private.review_best_purchase_changed();
create trigger review_best_payment_refunded after update of status on public.payments for each row when(old.status is distinct from new.status) execute function private.review_best_purchase_changed();
create trigger review_best_claim_completed after insert or update of status,stage on public.order_cancellation_requests for each row execute function private.review_best_purchase_changed();

create function public.admin_get_review_best_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('store.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return (select jsonb_build_object('enabled',enabled,'revision',revision) from private.review_best_settings where id);
end $$;
revoke all on function public.admin_get_review_best_settings() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_review_best_settings() to authenticated;
create function public.admin_save_review_best_settings(p_enabled boolean,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.review_best_settings;request jsonb;receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'store.manage');
 if p_enabled is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise invalid_parameter_value using message='invalid_best_review_settings';end if;
 request:=jsonb_build_object('enabled',p_enabled,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('review-best-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_best.settings',request);if receipt is not null then return receipt;end if;
 select * into previous from private.review_best_settings where id for update;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='best_review_settings_conflict';end if;
 update private.review_best_settings set enabled=p_enabled,revision=revision+1,updated_at=clock_timestamp() where id returning jsonb_build_object('enabled',enabled,'revision',revision) into receipt;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_best.settings','store:review-best',jsonb_build_object('request',request,'before',previous.enabled,'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_review_best_settings(boolean,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_review_best_settings(boolean,integer,uuid) to authenticated;

create function public.get_good_selected_reviews(p_good_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private.review_best_settings where id and enabled) then return '[]'::jsonb;end if;
 -- Sampling happens on the server once; the exact three cards hydrate unchanged.
 with eligible as materialized (
  select r.* from public.reviews r join private.review_best_selections s on s.review_id=r.id and s.selected and s.invalidated_at is null
  where r.good_id=p_good_id and s.review_fingerprint=private.review_event_review_fingerprint(r) and private.review_best_problem(r) is null
 ), chosen as(select * from eligible where (select count(*) from eligible)>=3 order by random() limit 3)
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,'authorName',coalesce(nullif(btrim(p.nickname),''),'구매자'),
  'createdAt',r.created_at,'imagePaths',coalesce(to_jsonb(r.image_paths),'[]'::jsonb))),'[]'::jsonb) into result
 from chosen r left join public.public_profiles p on p.id=r.user_id;
 return result;
end $$;
revoke all on function public.get_good_selected_reviews(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_selected_reviews(text) to anon,authenticated;

-- Preserve the established query, pagination and search contracts; add one
-- explicit BEST state predicate before its window count and LIMIT.
do $migration$
declare body text; signature_anchor text:='p_offset integer DEFAULT 0)';
 validation_anchor text:=E'  return query\n  select';
 filter_anchor text:='  where (p_review_id is null or review.id = p_review_id)';
 result_anchor text:='total_count bigint)'; select_anchor text:='    count(*) over()::bigint as total_count';
begin
 body:=pg_get_functiondef('public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer)'::regprocedure);
 if (length(body)-length(replace(body,signature_anchor,'')))/length(signature_anchor)<>1
  or (length(body)-length(replace(body,validation_anchor,'')))/length(validation_anchor)<>1
  or (length(body)-length(replace(body,filter_anchor,'')))/length(filter_anchor)<>1
  or (length(body)-length(replace(body,result_anchor,'')))/length(result_anchor)<>1
  or (length(body)-length(replace(body,select_anchor,'')))/length(select_anchor)<>1 then raise exception 'review_best_search_anchor_missing';end if;
 body:=replace(body,'public.admin_search_reviews(','public.admin_search_reviews_best(');
 body:=replace(body,signature_anchor,'p_offset integer DEFAULT 0, p_best text DEFAULT ''all'')');
 body:=replace(body,result_anchor,'total_count bigint, best_selection jsonb)');
 body:=replace(body,select_anchor,select_anchor||E',\n    private.review_best_state(review) as best_selection');
 body:=replace(body,validation_anchor,E'  if p_best is null or p_best not in (''all'',''selected'',''not_selected'',''needs_review'') then raise invalid_parameter_value using message=''invalid_best_review_filter'';end if;\n'||validation_anchor);
 body:=replace(body,filter_anchor,filter_anchor||E'\n    and (p_best=''all'' or (p_best=''not_selected'' and not exists(select 1 from private.review_best_selections selection where selection.review_id=review.id and selection.selected)) or (p_best in (''selected'',''needs_review'') and exists(select 1 from private.review_best_selections selection where selection.review_id=review.id and selection.selected and private.review_best_state(review)->>''state''=p_best)))');
 execute body;
end $migration$;
revoke all on function public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text) to authenticated;

select private.register_operator_rpc_contract('public.admin_get_review_best_states(uuid[])','cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_set_review_best(uuid,boolean,text,integer,text,uuid)','cs.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_get_review_best_settings()','store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_review_best_settings(boolean,integer,uuid)','store.manage','manual',false);
do $$ declare name text;begin
 foreach name in array array['private.review_best_problem(public.reviews)','private.review_best_state(public.reviews)','private.invalidate_review_best(uuid[],text)',
 'private.review_best_review_changed()','private.review_best_purchase_changed()','public.get_good_selected_reviews(text)']
 loop perform private.register_operator_internal_contract(name::regprocedure);end loop;
end $$;
notify pgrst,'reload schema';
