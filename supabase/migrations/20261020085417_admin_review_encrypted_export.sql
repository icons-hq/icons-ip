-- General-review encrypted XLSX snapshot and final issuance audit.
-- No existing function, helper ACL, business row, table, receipt or runtime changes.
-- In mixed-owner environments apply using an executor able to create functions
-- for the existing review reader owner (local proof uses supabase_admin).
set local search_path='';

do $review_export_source$
declare
 reader regprocedure:='public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure;
 source text;reader_owner oid;anchor text;from_start integer;order_start integer;limit_start integer;
 from_where text;ordering text;definition text;
begin
 select pg_get_functiondef(reader),proowner into source,reader_owner from pg_proc where oid=reader;
 if encode(extensions.digest(convert_to(source,'UTF8'),'sha256'),'hex')<>'3332292f02cb0e561035047fbd3cc891a5a2609ff9f910e795046bff4f306ea4' then
  raise exception 'review_export_reader_source_changed';end if;
 if reader_owner not in ('postgres'::regrole::oid,'supabase_admin'::regrole::oid)
  or not has_function_privilege(reader_owner,'private.review_best_state(public.reviews)'::regprocedure,'EXECUTE')
  or not has_function_privilege(reader_owner,'private.review_best_problem(public.reviews)'::regprocedure,'EXECUTE')
  or not has_table_privilege(reader_owner,'private.review_helpful_votes'::regclass,'SELECT') then
  raise exception 'review_export_reader_owner_boundary_unavailable';end if;
 foreach anchor in array array[E'  from public.reviews as review\n',E'  order by\n',E'  limit v_limit\n  offset v_offset;'] loop
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
   raise exception 'review_export_reader_anchor_changed';end if;
 end loop;
 from_start:=strpos(source,E'  from public.reviews as review\n');
 order_start:=strpos(source,E'  order by\n');
 limit_start:=strpos(source,E'  limit v_limit\n  offset v_offset;');
 if from_start>=order_start or order_start>=limit_start then raise exception 'review_export_reader_anchor_order_changed';end if;
 from_where:=substr(source,from_start,order_start-from_start);
 ordering:=substr(source,order_start,limit_start-order_start);
 -- These exact source fragments are reused for filtering, sorting and tie breaks.
 -- The old reader's page clamp/count window and broad PII projection are omitted.
 definition:=$definition$
create function private.review_export_snapshot(p_actor_id uuid,p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $snapshot$
declare
 p_review_id uuid;p_from date;p_to date;p_rating integer;p_status text;p_has_photo boolean;p_has_reply boolean;p_low_rating boolean;p_best text;
 v_query text;v_field text;v_sort text;query_units integer;row_count integer;exported jsonb;fingerprint text;
 trim_chars constant text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
  ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)
  ||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
 if p_actor_id is null or not private.has_operator_capability(p_actor_id,'cs.manage',false)
  or not exists(select 1 from auth.users u where u.id=p_actor_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=statement_timestamp())) then
  raise insufficient_privilege using message='review_export_auth_changed';end if;
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>3000
  or (select array_agg(key order by key) from jsonb_object_keys(p_filters) key)
    is distinct from array['best','field','from','lowRating','photo','query','rating','reply','reviewId','sort','status','to']
  or exists(select 1 from jsonb_each(p_filters) f where
    case when f.key='lowRating' then jsonb_typeof(f.value)<>'boolean'
     when f.key in ('from','to','reviewId') then jsonb_typeof(f.value) not in ('string','null')
     else jsonb_typeof(f.value)<>'string' end) then
  raise invalid_parameter_value using message='invalid_review_export_filters';end if;
 if p_filters->>'rating' not in ('all','1','2','3','4','5')
  or p_filters->>'status' not in ('all','visible','hidden')
  or p_filters->>'photo' not in ('all','with','without') or p_filters->>'reply' not in ('all','with','without')
  or p_filters->>'best' not in ('all','selected','not_selected','needs_review')
  or p_filters->>'field' not in ('all','good','author','body')
  or p_filters->>'sort' not in ('recent','oldest','rating_desc','rating_asc','good_name_asc','photo_count_desc','helpful_desc')
  or (p_filters->>'from' is not null and p_filters->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (p_filters->>'to' is not null and p_filters->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (p_filters->>'reviewId' is not null and p_filters->>'reviewId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
  raise invalid_parameter_value using message='invalid_review_export_filters';end if;
 begin
  p_from:=(p_filters->>'from')::date;p_to:=(p_filters->>'to')::date;p_review_id:=(p_filters->>'reviewId')::uuid;
 exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise invalid_parameter_value using message='invalid_review_export_filters';end;
 if p_from is not null and (p_from<date '0100-01-01' or p_from>date '9999-12-31')
  or p_to is not null and (p_to<date '0100-01-01' or p_to>date '9999-12-31')
  or p_from is not null and p_to is not null and p_from>p_to then
  raise invalid_parameter_value using message='invalid_review_export_filters';end if;
 v_query:=p_filters->>'query';
 select coalesce(sum(case when ascii(unit.ch)>65535 then 2 else 1 end),0)::integer
  into query_units from regexp_split_to_table(v_query,'') as unit(ch) where unit.ch<>'';
 if v_query<>btrim(v_query,trim_chars) or query_units>100 then
  raise invalid_parameter_value using message='invalid_review_export_filters';end if;
 v_query:=nullif(v_query,'');v_field:=p_filters->>'field';v_sort:=p_filters->>'sort';
 p_rating:=nullif(p_filters->>'rating','all')::integer;p_status:=nullif(p_filters->>'status','all');p_best:=p_filters->>'best';
 p_low_rating:=(p_filters->>'lowRating')::boolean;
 p_has_photo:=case p_filters->>'photo' when 'with' then true when 'without' then false else null end;
 p_has_reply:=case p_filters->>'reply' when 'with' then true when 'without' then false else null end;
 with bounded as materialized (
  select row_number() over (__REVIEW_ORDERING__) ordinal,
   jsonb_build_object('id',review.id,'goodId',review.good_id,'goodName',good.name,
    'authorName',coalesce(nullif(btrim(coalesce(author.nickname,'')),''),'fan_'||left(review.user_id::text,6)),
    'rating',review.rating,'body',review.body,'imageCount',coalesce(cardinality(review.image_paths),0),
    'helpfulCount',helpful.helpful_count,'status',review.status,'bestState',private.review_best_state(review)->>'state',
    'reportCount',(select count(*) from public.reports report where report.target_type='review' and report.target_id=review.id::text),
    'openReportCount',(select count(*) from public.reports report where report.target_type='review' and report.target_id=review.id::text and report.status in ('open','reviewing')),
    'hasReply',review.admin_reply is not null,'replyAt',review.admin_reply_at,'createdAt',review.created_at,'editedAt',review.edited_at) value
__REVIEW_FROM_WHERE__
__REVIEW_ORDERING__
  limit 10001
 ) select count(*)::integer,coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into row_count,exported from bounded;
 if row_count>10000 then raise program_limit_exceeded using message='review_export_limit';end if;
 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('version',1,'filters',p_filters,'rows',exported)::text,'UTF8'),'sha256'),'hex');
 return jsonb_build_object('version',1,'filters',p_filters,'total',row_count,'rows',exported,'capturedAt',statement_timestamp(),'fingerprint',fingerprint);
end $snapshot$;
$definition$;
 if (length(definition)-length(replace(definition,'__REVIEW_FROM_WHERE__','')))/length('__REVIEW_FROM_WHERE__')<>1
  or (length(definition)-length(replace(definition,'__REVIEW_ORDERING__','')))/length('__REVIEW_ORDERING__')<>2 then
  raise exception 'review_export_template_anchor_changed';end if;
 definition:=replace(replace(definition,'__REVIEW_FROM_WHERE__',from_where),'__REVIEW_ORDERING__',ordering);
 execute definition;
 execute format('alter function private.review_export_snapshot(uuid,jsonb) owner to %I',pg_get_userbyid(reader_owner));
end $review_export_source$;
revoke all on function private.review_export_snapshot(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.admin_export_reviews(p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());session_text text:=(select auth.jwt()->>'session_id');session_id uuid;
begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null
  or (select auth.jwt()->>'sub') is distinct from actor::text or session_text is null
  or session_text!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise insufficient_privilege using message='review_export_auth_changed';end if;
 session_id:=session_text::uuid;
 if not exists(select 1 from auth.sessions s where s.id=session_id and s.user_id=actor
  and (s.not_after is null or s.not_after>statement_timestamp())) then
  raise insufficient_privilege using message='review_export_auth_changed';end if;
 return private.review_export_snapshot(actor,p_filters);
end $$;
revoke all on function public.admin_export_reviews(jsonb) from public,anon,authenticated,service_role;

-- Only the application service can attest an encrypted file. Lock the actor and
-- live session before recomputing the same snapshot; never audit row/password data.
create function public.service_record_review_export(p_actor_id uuid,p_session_id uuid,p_filters jsonb,
 p_fingerprint text,p_row_count integer,p_captured_at timestamptz,p_file_sha256 text) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare snapshot jsonb;recorded_id uuid;query_units integer;
begin
 if current_setting('role',true) is distinct from 'service_role' or p_actor_id is null or p_session_id is null then
  raise insufficient_privilege using message='review_export_auth_changed';end if;
 if p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or p_file_sha256 is null or p_file_sha256!~'^[a-f0-9]{64}$'
  or p_row_count is null or p_row_count not between 0 and 10000 or p_captured_at is null or not isfinite(p_captured_at)
  or p_captured_at>clock_timestamp() then raise invalid_parameter_value using message='invalid_review_export_issuance';end if;
 perform private.lock_operator_subjects(array[p_actor_id]);
 perform 1 from auth.users u where u.id=p_actor_id and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise insufficient_privilege using message='review_export_auth_changed';end if;
 perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_actor_id
  and (s.not_after is null or s.not_after>clock_timestamp()) for share;
 if not found or not private.has_operator_capability(p_actor_id,'cs.manage',false) then
  raise insufficient_privilege using message='review_export_auth_changed';end if;
 snapshot:=private.review_export_snapshot(p_actor_id,p_filters);
 if snapshot->>'fingerprint' is distinct from p_fingerprint or (snapshot->>'total')::integer is distinct from p_row_count then
  raise sqlstate 'PT409' using message='review_export_changed';end if;
 select coalesce(sum(case when ascii(unit.ch)>65535 then 2 else 1 end),0)::integer
  into query_units from regexp_split_to_table(p_filters->>'query','') as unit(ch) where unit.ch<>'';
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.review_export.file_issued','admin_screen:reviews',
  jsonb_build_object('screen','reviews','filters',p_filters-'query','queryPresent',(p_filters->>'query')<>'','queryLength',query_units,
   'rowCount',p_row_count,'recordCount',p_row_count,'fingerprint',p_fingerprint,'capturedAt',p_captured_at,
   'format','xlsx','encryption','ECMA-376-Agile','fileSha256',p_file_sha256)) returning id into recorded_id;
 return recorded_id;
end $$;
revoke all on function public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamptz,text) from public,anon,authenticated,service_role;

do $review_export_owners$
declare reader_owner name;signature text;
begin
 select pg_get_userbyid(proowner) into reader_owner from pg_proc where oid=
  'public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure;
 foreach signature in array array['public.admin_export_reviews(jsonb)','public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamptz,text)'] loop
  execute format('alter function %s owner to %I',signature,reader_owner);
  -- Local mixed-owner defaults can separately grant postgres on public functions.
  if reader_owner<>'postgres' then execute format('revoke all on function %s from postgres',signature);end if;
 end loop;
end $review_export_owners$;
grant execute on function public.admin_export_reviews(jsonb) to authenticated;
grant execute on function public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamptz,text) to service_role;
select private.register_operator_rpc_contract('public.admin_export_reviews(jsonb)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamptz,text)'::regprocedure,'cs.manage','service_start',false);
select private.register_operator_internal_contract('private.review_export_snapshot(uuid,jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.admin_export_reviews(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamptz,text)'::regprocedure);
notify pgrst,'reload schema';
