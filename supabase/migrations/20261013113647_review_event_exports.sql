-- Read-only, caller-scoped review-event exports. Existing reward contracts stay sealed.
create function private.review_event_export_snapshot(p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mode_value text; query_value text; state_value text; date_field text; from_day date; to_day date;
 target_event_id uuid; filter_value text; event_doc jsonb; exported jsonb; fingerprint_rows jsonb; row_count integer; fingerprint text;
begin
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>2000
  or exists(select 1 from jsonb_each(p_filters) f where jsonb_typeof(f.value) not in ('string','null')) then
  raise invalid_parameter_value using message='invalid_review_event_export';end if;
 mode_value:=p_filters->>'mode'; query_value:=p_filters->>'query';
 if mode_value is null or mode_value not in ('events','entries') or query_value is null or char_length(query_value)>100 or query_value<>btrim(query_value) then
  raise invalid_parameter_value using message='invalid_review_event_export';end if;
 if mode_value='events' then
  if (select array_agg(key order by key) from jsonb_object_keys(p_filters) key)<>array['dateField','from','mode','query','state','to'] then
   raise invalid_parameter_value using message='invalid_review_event_export';end if;
  state_value:=p_filters->>'state';date_field:=p_filters->>'dateField';
  if state_value is null or state_value not in ('all','scheduled','active','closed','ready','announced','archived')
   or date_field is null or date_field not in ('created','start','end','announce')
   or (p_filters->>'from' is not null and p_filters->>'from'!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$')
   or (p_filters->>'to' is not null and p_filters->>'to'!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$') then
   raise invalid_parameter_value using message='invalid_review_event_export';end if;
  from_day:=(p_filters->>'from')::date;to_day:=(p_filters->>'to')::date;
  if from_day is not null and to_day is not null and from_day>to_day then raise invalid_parameter_value using message='invalid_review_event_export';end if;
  with candidates as (
   select e.*,private.review_event_state(e,statement_timestamp()) state,
    case date_field when 'start' then starts_on when 'end' then ends_on when 'announce' then announces_on else (created_at at time zone 'Asia/Seoul')::date end filter_day
   from private.review_events e where query_value='' or position(lower(query_value) in lower(e.title))>0 or e.number::text=query_value or e.id::text=query_value
  ), filtered as (select * from candidates where (state_value='all' and archived_at is null or state=state_value)
   and (from_day is null or filter_day>=from_day) and (to_day is null or filter_day<=to_day)), bounded as (
   select * from filtered order by created_at desc,id limit 10001
  ), documents as (
   select id,created_at,private.review_event_document(id) value from bounded
  ) select count(*),coalesce(jsonb_agg((value-'goodIds'-'categoryIds')||jsonb_build_object(
   'targetCount',jsonb_array_length(value->'goodIds')+jsonb_array_length(value->'categoryIds'),
   'targetsFingerprint',encode(extensions.digest(jsonb_build_array(value->'goodIds',value->'categoryIds')::text,'sha256'),'hex'))
   order by created_at desc,id),'[]'::jsonb) into row_count,exported from documents;
  fingerprint_rows:=exported;
 else
  if (select array_agg(key order by key) from jsonb_object_keys(p_filters) key)<>array['eventId','filter','mode','query']
   or p_filters->>'eventId' is null or p_filters->>'eventId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise invalid_parameter_value using message='invalid_review_event_export';end if;
  target_event_id:=(p_filters->>'eventId')::uuid;filter_value:=p_filters->>'filter';
  if filter_value is null or filter_value not in ('all','eligible','selected','awarded','revoked','unavailable') then
   raise invalid_parameter_value using message='invalid_review_event_export';end if;
  event_doc:=private.review_event_document(target_event_id);
  if event_doc is null then raise no_data_found using message='review_event_not_found';end if;
  with candidates as materialized (
   select entry.*,r.body,r.rating,r.updated_at review_updated_at,private.review_event_review_fingerprint(r) review_fingerprint,
    cardinality(coalesce(r.image_paths,'{}')) image_count,coalesce(nullif(btrim(profile.nickname),''),'고객') nickname,
    coalesce(g.name,'삭제된 상품') good_name,coalesce(g.code,'') good_code,private.review_event_entry_problem(entry) problem,
    award.granted_at,award.revoked_at,award.expires_at
   from private.review_event_entries entry left join public.reviews r on r.id=entry.review_id
   left join public.profiles profile on profile.id=entry.user_id left join public.goods g on g.id=entry.good_id
   left join private.review_event_awards award on award.entry_id=entry.id where entry.event_id=target_event_id
  ), filtered as (
   select * from candidates where (query_value='' or position(lower(query_value) in lower(nickname||' '||good_name||' '||coalesce(body,'')))>0 or source_review_id::text=query_value)
    and (filter_value='all' or filter_value='eligible' and problem is null and granted_at is null or filter_value='selected' and selected
     or filter_value='awarded' and granted_at is not null and revoked_at is null or filter_value='revoked' and revoked_at is not null or filter_value='unavailable' and problem is not null)
  ), bounded as (select * from filtered order by entered_at desc,id limit 10001), documents as (
   select entered_at,id,review_fingerprint,jsonb_build_object('id',id,'reviewId',source_review_id,'goodId',good_id,'goodCode',good_code,'goodName',good_name,
    'nickname',nickname,'rating',rating,'imageCount',image_count,'enteredAt',entered_at,'reviewUpdatedAt',review_updated_at,
    'selected',selected,'selectionChanged',selected and (selected_review_updated_at is distinct from review_updated_at or selected_review_fingerprint is distinct from review_fingerprint),
    'problem',problem,'creditAmount',credit_amount,'creditValidityDays',credit_validity_days,'eventRevision',event_revision,
    'grantedAt',granted_at,'revokedAt',revoked_at,'expiresAt',expires_at) value from bounded
  ) select count(*),coalesce(jsonb_agg(value order by entered_at desc,id),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_array(value,review_fingerprint) order by entered_at desc,id),'[]'::jsonb)
   into row_count,exported,fingerprint_rows from documents;
 end if;
 if row_count>10000 then raise program_limit_exceeded using message='review_event_export_limit';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('filters',p_filters,'event',event_doc,'rows',fingerprint_rows)::text,'sha256'),'hex');
 return jsonb_build_object('filters',p_filters,'event',event_doc,'total',row_count,'rows',exported,'fingerprint',fingerprint,'capturedAt',statement_timestamp());
end $$;
revoke all on function private.review_event_export_snapshot(jsonb) from public,anon,authenticated,service_role;

create function public.admin_export_review_events(p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.review_event_export_snapshot(p_filters);
end $$;
revoke all on function public.admin_export_review_events(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_export_review_events(jsonb) to authenticated;

-- The route builds the file before this check and releases no bytes until it succeeds.
create function public.admin_record_review_event_export(p_filters jsonb,p_fingerprint text,p_row_count integer) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; snapshot jsonb; audit_id uuid;
begin
 actor:=private.require_operator_capability('cs.manage',false);
 if p_fingerprint is null or p_fingerprint!~'^[0-9a-f]{64}$' or p_row_count is null or p_row_count not between 0 and 10000 then
  raise invalid_parameter_value using message='invalid_review_event_export';end if;
 snapshot:=private.review_event_export_snapshot(p_filters);
 if snapshot->>'fingerprint'<>p_fingerprint or (snapshot->>'total')::integer<>p_row_count then
  raise exception using errcode='PT409',message='review_event_export_changed';end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.list_export.downloaded',
  case when p_filters->>'mode'='events' then 'admin_screen:review-events' else 'review_event:'||(p_filters->>'eventId') end,
  jsonb_build_object('screen','review-events','mode',p_filters->>'mode','filters',p_filters-'query',
   'queryPresent',(p_filters->>'query')<>'','queryLength',char_length(p_filters->>'query'),'rowCount',p_row_count,'recordCount',p_row_count,
   'fingerprint',p_fingerprint,'privacyConfirmed',true)) returning id into audit_id;
 return audit_id;
end $$;
revoke all on function public.admin_record_review_event_export(jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_review_event_export(jsonb,text,integer) to authenticated;
select private.register_operator_rpc_contract('public.admin_export_review_events(jsonb)','cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_record_review_event_export(jsonb,text,integer)','cs.manage','write',false);
select private.register_operator_internal_contract('private.review_event_export_snapshot(jsonb)');
notify pgrst,'reload schema';
