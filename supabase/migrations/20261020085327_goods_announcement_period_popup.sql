-- Independent importance windows and exactly one explicitly selected home
-- announcement. Existing records, legacy writers and public browsing survive.
alter table public.goods_announcements add column important_starts_at timestamptz;
alter table public.goods_announcements add column important_ends_at timestamptz;
alter table public.goods_announcements add constraint goods_announcements_importance_window check
 ((important_starts_at is null and important_ends_at is null)
  or (important_starts_at is not null and important_ends_at is not null
   and isfinite(important_starts_at) and isfinite(important_ends_at) and important_starts_at<important_ends_at));

create table private.home_announcement_popup (
 singleton boolean primary key default true check(singleton),
 announcement_id uuid references public.goods_announcements(id),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 starts_at timestamptz,ends_at timestamptz,dismiss_key uuid,
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid references public.profiles(id),
 check((announcement_id is null and starts_at is null and ends_at is null and dismiss_key is null)
  or (announcement_id is not null and starts_at is not null and ends_at is not null and dismiss_key is not null
   and isfinite(starts_at) and isfinite(ends_at) and starts_at<ends_at))
);
alter table private.home_announcement_popup enable row level security;
revoke all on private.home_announcement_popup from public,anon,authenticated,service_role;
insert into private.home_announcement_popup(singleton) values(true);

create function public.admin_get_goods_announcement_editor_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare announcement jsonb;selection private.home_announcement_popup;periods jsonb;
begin
 if not public.has_operator_capability('catalog.announcements',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_id is null then raise invalid_parameter_value using message='invalid_goods_announcement';end if;
 select * into selection from private.home_announcement_popup where singleton;
 if not found then raise data_exception using message='goods_announcement_popup_state_missing';end if;
 announcement:=public.admin_get_goods_announcement(p_id);
 if announcement is not null then
  select jsonb_build_object('importantStartsAt',important_starts_at,'importantEndsAt',important_ends_at)
   into periods from public.goods_announcements where id=p_id;
  announcement:=announcement||periods;
 end if;
 return jsonb_build_object('announcement',announcement,'popup',jsonb_build_object(
  'selected',coalesce(selection.announcement_id=p_id,false),'revision',selection.revision,
  'startsAt',case when selection.announcement_id=p_id then selection.starts_at else null end,
  'endsAt',case when selection.announcement_id=p_id then selection.ends_at else null end));
end $$;
revoke all on function public.admin_get_goods_announcement_editor_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_announcement_editor_context(uuid) to authenticated;

create function public.admin_save_goods_announcement_v2(p_operation_id uuid,p_id uuid,p_expected_revision integer,
 p_values jsonb,p_popup_intent text,p_expected_popup_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();previous public.goods_announcements;saved public.goods_announcements;
 ids text[];starts_value timestamptz;ends_value timestamptz;before_goods text[];
 important_starts timestamptz;important_ends timestamptz;popup_starts timestamptz;popup_ends timestamptz;
 field text;request_payload jsonb;normalized_values jsonb;receipt public.audit_log;result jsonb;
 popup_before private.home_announcement_popup;popup_after private.home_announcement_popup;
begin
 perform private.require_operator_capability('catalog.announcements',false);
 if p_operation_id is null or p_id is null or p_expected_revision is null or p_expected_revision<0
  or jsonb_typeof(p_values) is distinct from 'object' then raise invalid_parameter_value using message='invalid_goods_announcement';end if;
 if p_popup_intent is null or p_popup_intent not in ('preserve','set','clear')
  or (p_expected_popup_revision is not null and p_expected_popup_revision not between 0 and 9007199254740991)
  or (p_popup_intent<>'preserve' and p_expected_popup_revision is null) then
  raise invalid_parameter_value using message='invalid_goods_announcement_popup_intent';end if;
  if exists(select 1 from jsonb_object_keys(p_values) key where key not in
      ('title','body','format','category','device','enabled','important','allGoods','goodIds','startsAt','endsAt','importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt'))
    or exists(select 1 from unnest(array['title','body','format','category','device']) key where jsonb_typeof(p_values->key) is distinct from 'string')
    or exists(select 1 from unnest(array['enabled','important','allGoods']) key where jsonb_typeof(p_values->key) is distinct from 'boolean')
    or char_length(btrim(p_values->>'title')) not between 1 and 50
    or char_length(btrim(p_values->>'body')) not between 1 and 30000
    or p_values->>'format' not in ('plain','html') or p_values->>'category' not in ('general','event','shipping','product')
    or p_values->>'device' not in ('all','pc','mobile')
    or jsonb_typeof(p_values->'goodIds') is distinct from 'array'
    or jsonb_array_length(p_values->'goodIds') > 500
    or exists(select 1 from jsonb_array_elements(p_values->'goodIds') item where jsonb_typeof(item) <> 'string'
      or char_length(item#>>'{}') not between 1 and 120)
    or exists(select 1 from unnest(array['startsAt','endsAt']) key where coalesce(jsonb_typeof(p_values->key),'null') not in ('string','null')) then
    raise invalid_parameter_value using message='invalid_goods_announcement';
  end if;
  select coalesce(array_agg(value),'{}') into ids from jsonb_array_elements_text(p_values->'goodIds');
  if cardinality(ids) <> (select count(distinct value) from unnest(ids) value)
    or ((p_values->>'allGoods')::boolean and cardinality(ids) <> 0)
    or (not (p_values->>'allGoods')::boolean and cardinality(ids) = 0) then
    raise invalid_parameter_value using message='invalid_goods_announcement_goods';
  end if;
  starts_value:=nullif(p_values->>'startsAt','')::timestamptz;
  ends_value:=nullif(p_values->>'endsAt','')::timestamptz;
  if (starts_value is not null and not isfinite(starts_value)) or (ends_value is not null and not isfinite(ends_value))
    or (starts_value is not null and ends_value is not null and starts_value >= ends_value) then
    raise invalid_parameter_value using message='invalid_goods_announcement_period';
  end if;

 -- All extended fields are explicit. Legacy callers use the unchanged 3-arg API.
 if not p_values ?& array['importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt'] then
  raise invalid_parameter_value using message='invalid_goods_announcement_period';end if;
 foreach field in array array['importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt'] loop
  if jsonb_typeof(p_values->field) not in ('string','null') then
   raise invalid_parameter_value using message='invalid_goods_announcement_period';end if;
  if jsonb_typeof(p_values->field)='string' and p_values->>field !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
   raise invalid_parameter_value using message='invalid_goods_announcement_period';end if;
 end loop;
 begin
  important_starts:=(p_values->>'importantStartsAt')::timestamptz;
  important_ends:=(p_values->>'importantEndsAt')::timestamptz;
  popup_starts:=(p_values->>'popupStartsAt')::timestamptz;
  popup_ends:=(p_values->>'popupEndsAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise invalid_parameter_value using message='invalid_goods_announcement_period';
 end;
 if (important_starts is null) is distinct from (important_ends is null)
  or (important_starts is not null and (not isfinite(important_starts) or not isfinite(important_ends) or important_starts>=important_ends)) then
  raise invalid_parameter_value using message='invalid_goods_announcement_important_period';end if;
 if (p_popup_intent='set' and (popup_starts is null or popup_ends is null or not isfinite(popup_starts) or not isfinite(popup_ends) or popup_starts>=popup_ends))
  or (p_popup_intent<>'set' and (popup_starts is not null or popup_ends is not null)) then
  raise invalid_parameter_value using message='invalid_goods_announcement_popup_period';end if;
 normalized_values:=p_values||jsonb_build_object('title',btrim(p_values->>'title'),'body',btrim(p_values->>'body'),
  'startsAt',starts_value,'endsAt',ends_value,'importantStartsAt',important_starts,'importantEndsAt',important_ends,
  'popupStartsAt',popup_starts,'popupEndsAt',popup_ends);
 request_payload:=jsonb_build_object('id',p_id,'expectedRevision',p_expected_revision,'values',normalized_values,
  'popupIntent',p_popup_intent,'expectedPopupRevision',p_expected_popup_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods_announcement_operation:'||p_operation_id::text,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if found then
  if receipt.actor_id=actor and receipt.action='admin.goods_announcement.saved'
   and receipt.target='goods_announcement:'||p_id::text and receipt.diff->'request'=request_payload
   and receipt.diff ? 'result' then return receipt.diff->'result';end if;
  raise unique_violation using message='operation_conflict';
 end if;
 if exists(select 1 from unnest(ids) item where not exists(select 1 from public.goods where id=item)) then
  raise invalid_parameter_value using message='invalid_goods_announcement_goods';end if;
 -- Keep the legacy target lock; no singleton holder locks another notice row.
 perform pg_advisory_xact_lock(hashtextextended('goods_announcement:'||p_id::text,0));
 select * into previous from public.goods_announcements where id=p_id for update;
 if (previous.id is null and p_expected_revision<>0) or (previous.id is not null and previous.revision<>p_expected_revision) then
  raise sqlstate 'PT409' using message='goods_announcement_changed';end if;
 if p_popup_intent='preserve' then
  select * into popup_before from private.home_announcement_popup where singleton;
 else
  select * into popup_before from private.home_announcement_popup where singleton for update;
 end if;
 if not found then raise data_exception using message='goods_announcement_popup_state_missing';end if;
 if p_popup_intent<>'preserve' and popup_before.revision<>p_expected_popup_revision then
  raise sqlstate 'PT409' using message='goods_announcement_popup_changed';end if;
 if p_popup_intent='clear' and popup_before.announcement_id is distinct from p_id then
  raise invalid_parameter_value using message='goods_announcement_popup_not_selected';end if;
 select coalesce(array_agg(good_id order by good_id),'{}') into before_goods from public.goods_announcement_goods where announcement_id=p_id;
 insert into public.goods_announcements(id,title,body,body_format,category,device,enabled,important,all_goods,starts_at,ends_at,
  important_starts_at,important_ends_at,created_by,updated_by)
 values(p_id,btrim(p_values->>'title'),btrim(p_values->>'body'),p_values->>'format',p_values->>'category',p_values->>'device',
  (p_values->>'enabled')::boolean,(p_values->>'important')::boolean,(p_values->>'allGoods')::boolean,starts_value,ends_value,
  important_starts,important_ends,actor,actor)
 on conflict(id) do update set title=excluded.title,body=excluded.body,body_format=excluded.body_format,category=excluded.category,
  device=excluded.device,enabled=excluded.enabled,important=excluded.important,all_goods=excluded.all_goods,
  starts_at=excluded.starts_at,ends_at=excluded.ends_at,important_starts_at=excluded.important_starts_at,important_ends_at=excluded.important_ends_at,
  revision=public.goods_announcements.revision+1,updated_by=actor,updated_at=clock_timestamp()
 returning * into saved;
 delete from public.goods_announcement_goods where announcement_id=p_id and not(good_id=any(ids));
 insert into public.goods_announcement_goods(announcement_id,good_id) select p_id,item from unnest(ids) item on conflict do nothing;
 if p_popup_intent='set' then
  update private.home_announcement_popup set announcement_id=p_id,starts_at=popup_starts,ends_at=popup_ends,
   revision=revision+1,dismiss_key=gen_random_uuid(),updated_at=clock_timestamp(),updated_by=actor where singleton returning * into popup_after;
 elsif p_popup_intent='clear' then
  update private.home_announcement_popup set announcement_id=null,starts_at=null,ends_at=null,dismiss_key=null,
   revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where singleton returning * into popup_after;
 else
  popup_after:=popup_before;
 end if;
 result:=jsonb_build_object('id',saved.id,'revision',saved.revision,'reference',saved.reference,'updatedAt',saved.updated_at,'popupRevision',popup_after.revision);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods_announcement.saved','goods_announcement:'||p_id::text,
  jsonb_build_object('request',request_payload,'before',case when previous.id is null then null else to_jsonb(previous) end,
   'after',to_jsonb(saved),'beforeGoodIds',before_goods,'afterGoodIds',ids,
   'popupBefore',to_jsonb(popup_before),'popupAfter',to_jsonb(popup_after),'result',result));
 return result;
end $$;
revoke all on function public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint) to authenticated;

create function public.admin_get_goods_announcement_save_result(p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();receipt public.audit_log;
begin
 perform private.require_operator_capability('catalog.announcements',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_operation_id';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods_announcement_operation:'||p_operation_id::text,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if not found or receipt.actor_id is distinct from actor or receipt.action<>'admin.goods_announcement.saved'
  or not receipt.diff ?& array['request','result']
  or receipt.target is distinct from 'goods_announcement:'||(receipt.diff->'request'->>'id') then return null;end if;
 return receipt.diff->'result';
end $$;
revoke all on function public.admin_get_goods_announcement_save_result(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_announcement_save_result(uuid) to authenticated;

-- Only effective importance reaches PDP clients. Future importance boundaries
-- still refresh a page that currently contains only ordinary announcements.
create or replace function public.get_good_announcements(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 with eligible as materialized (
  select n.*,n.important and (n.important_starts_at is null or n.important_starts_at<=statement_timestamp())
    and (n.important_ends_at is null or n.important_ends_at>statement_timestamp()) as effective_important,
   greatest(n.starts_at,n.important_starts_at) as importance_starts,least(n.ends_at,n.important_ends_at) as importance_ends
  from public.goods_announcements n where n.enabled
   and exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_good_id
    and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null)
   and (n.all_goods or exists(select 1 from public.goods_announcement_goods links where links.announcement_id=n.id and links.good_id=p_good_id))
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'format',body_format,
   'category',category,'device',device,'important',effective_important) order by effective_important desc,updated_at desc,id)
  from eligible where (starts_at is null or starts_at<=statement_timestamp()) and (ends_at is null or ends_at>statement_timestamp())),'[]'),
  'nextChangeAt',(select min(at) from eligible cross join lateral(values(starts_at),(ends_at),
   (case when important and coalesce(importance_starts,'-infinity')<coalesce(importance_ends,'infinity') then importance_starts end),
   (case when important and coalesce(importance_starts,'-infinity')<coalesce(importance_ends,'infinity') then importance_ends end))boundary(at)
   where at>statement_timestamp() and isfinite(at)));
$$;
revoke all on function public.get_good_announcements(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_announcements(text) to anon,authenticated;

create function public.get_home_announcement_popup() returns jsonb
language sql stable security definer set search_path='' as $$
 with selected as materialized (
  select n.*,s.dismiss_key,greatest(n.starts_at,s.starts_at) as effective_starts,least(n.ends_at,s.ends_at) as effective_ends,
   n.important and (n.important_starts_at is null or n.important_starts_at<=statement_timestamp())
    and (n.important_ends_at is null or n.important_ends_at>statement_timestamp()) as effective_important
  from private.home_announcement_popup s join public.goods_announcements n on n.id=s.announcement_id where s.singleton and n.enabled
 ), eligible as materialized(select * from selected where effective_starts<effective_ends)
 select jsonb_build_object('item',(select jsonb_build_object('id',id,'title',title,'body',body,'format',body_format,'device',device,
  'important',effective_important,'dismissKey',dismiss_key,'startsAt',effective_starts,'endsAt',effective_ends)
  from eligible where effective_starts<=statement_timestamp() and effective_ends>statement_timestamp()),
  'nextChangeAt',(select min(at) from eligible cross join lateral(values(effective_starts),(effective_ends),
   (case when important and important_starts_at>effective_starts and important_starts_at<effective_ends then important_starts_at end),
   (case when important and important_ends_at>effective_starts and important_ends_at<effective_ends then important_ends_at end))boundary(at)
   where at>statement_timestamp() and isfinite(at)));
$$;
revoke all on function public.get_home_announcement_popup() from public,anon,authenticated,service_role;
grant execute on function public.get_home_announcement_popup() to anon,authenticated;

select private.register_operator_rpc_contract('public.admin_get_goods_announcement_editor_context(uuid)'::regprocedure,'catalog.announcements','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_announcement_v2(uuid,uuid,integer,jsonb,text,bigint)'::regprocedure,'catalog.announcements','manual',false);
select private.register_operator_rpc_contract('public.admin_get_goods_announcement_save_result(uuid)'::regprocedure,'catalog.announcements','manual',false);
select private.register_operator_internal_contract('public.get_good_announcements(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_home_announcement_popup()'::regprocedure);
notify pgrst,'reload schema';
