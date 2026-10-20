-- Marketing owns its own campaign/run/recipient ledger. It does not call an email provider.
create table private.marketing_campaigns (
 id uuid primary key, reference bigint generated always as identity unique,
 name text not null check(char_length(btrim(name)) between 1 and 50),
 segment_id uuid not null references private.customer_segments(id), segment_revision integer not null,
 rule jsonb not null, rule_hash text not null, content jsonb not null, schedule jsonb not null,
 exclusion text not null check(exclusion in ('none','received','read')),
 state text not null default 'draft' check(state in ('draft','published')),
 revision integer not null default 1 check(revision>0), sender_id uuid references public.profiles(id) on delete set null,
 estimate_id uuid references private.customer_segment_estimates(id),
 created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), archived_at timestamptz
);
create table private.marketing_runs (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references private.marketing_campaigns(id), scheduled_at timestamptz not null,
 state text not null default 'queued' check(state in ('queued','processing','completed','blocked','canceled','expired')),
 reason text, started_at timestamptz, completed_at timestamptz,
 candidate_count integer not null default 0 check(candidate_count>=0),
 unique(campaign_id,scheduled_at)
);
create index marketing_runs_due on private.marketing_runs(scheduled_at,id) where state in ('queued','processing');
create table private.marketing_recipients (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references private.marketing_runs(id),
 customer_id uuid references public.profiles(id) on delete set null,
 notification_id uuid references public.notifications(id) on delete set null,
 state text not null default 'pending' check(state in ('pending','sent','excluded')), reason text, registered_at timestamptz,
 unique(run_id,customer_id)
);
create index marketing_recipient_pending on private.marketing_recipients(run_id,id) where state='pending';
create index marketing_recipient_history on private.marketing_recipients(customer_id,run_id) where state='sent';
alter table private.marketing_campaigns enable row level security;
alter table private.marketing_runs enable row level security;
alter table private.marketing_recipients enable row level security;
revoke all on private.marketing_campaigns,private.marketing_runs,private.marketing_recipients from public,anon,authenticated,service_role;
do $$declare definition text; types text;begin
 select pg_get_constraintdef(oid) into strict definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_type_check';
 select string_agg(distinct quote_literal(value[1]),',') into types from regexp_matches(definition,'''([a-z_]+)''::text','g')value;
 if types is null then raise exception 'notification_types_unreadable';end if;
 execute 'alter table public.notifications drop constraint notifications_type_check';
 execute format('alter table public.notifications add constraint notifications_type_check check(type in (%s,%L))',types,'marketing_message');
end $$;

create function private.normalize_marketing_content(p_content jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare template text; title text; body text; image_path text; ids text[]; button jsonb; buttons jsonb:='[]'; max_lines integer;
begin
 if p_content is null or jsonb_typeof(p_content)<>'object' or not(p_content ?& array['template','title','body','imagePath','goodIds','buttons'])
  or exists(select 1 from jsonb_object_keys(p_content) key where key<>all(array['template','title','body','imagePath','goodIds','buttons']))
  or jsonb_typeof(p_content->'template') is distinct from 'string' or jsonb_typeof(p_content->'title') is distinct from 'string'
  or jsonb_typeof(p_content->'body') is distinct from 'string' or jsonb_typeof(p_content->'imagePath') not in ('null','string')
  or jsonb_typeof(p_content->'goodIds') is distinct from 'array' or jsonb_typeof(p_content->'buttons') is distinct from 'array'
 then raise invalid_parameter_value using message='invalid_marketing_content';end if;
 template:=p_content->>'template';title:=btrim(p_content->>'title');body:=btrim(replace(p_content->>'body',E'\r\n',E'\n'));image_path:=p_content->>'imagePath';
 max_lines:=case template when 'text' then 16 when 'image' then 8 when 'product_list' then 2 when 'product_cards' then 2 end;
 if max_lines is null or char_length(title) not between 1 and 120 or title~'[[:cntrl:]]' or char_length(body) not between 1 and 500
  or body~E'[\\x01-\\x08\\x0B-\\x1F\\x7F]' or cardinality(string_to_array(body,E'\n'))>max_lines
  or image_path is not null and image_path !~ '^public-media/catalog/curation/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
  or template='image' and image_path is null or template in ('text','product_cards') and image_path is not null
  or jsonb_array_length(p_content->'goodIds')>6 or jsonb_array_length(p_content->'buttons')>2
  or exists(select 1 from jsonb_array_elements(p_content->'goodIds') v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,119}$')
 then raise invalid_parameter_value using message='invalid_marketing_content';end if;
 select coalesce(array_agg(value order by position),'{}'::text[]) into ids from jsonb_array_elements_text(p_content->'goodIds') with ordinality a(value,position);
 if cardinality(ids)<>(select count(distinct id) from unnest(ids) id)
  or template in ('text','image') and cardinality(ids)<>0 or template='product_list' and cardinality(ids) not between 1 and 3
  or template='product_cards' and cardinality(ids) not between 1 and 6 then raise invalid_parameter_value using message='invalid_marketing_content';end if;
 for button in select value from jsonb_array_elements(p_content->'buttons') loop
  if jsonb_typeof(button)<>'object' or not(button ?& array['label','path'])
   or exists(select 1 from jsonb_object_keys(button) key where key<>all(array['label','path']))
   or jsonb_typeof(button->'label') is distinct from 'string' or char_length(btrim(button->>'label')) not between 1 and 20 or button->>'label'~'[[:cntrl:]]'
   or jsonb_typeof(button->'path') is distinct from 'string' or char_length(button->>'path') not between 1 and 500
   or button->>'path' !~ '^/([^/].*)?$' or button->>'path'~'[[:cntrl:]]' or strpos(button->>'path',chr(92))>0
   or button->>'path'~* '^/(admin|api|auth|login|logout)(/|[?#]|$)' or strpos(button->>'path','%')>0
  then raise invalid_parameter_value using message='invalid_marketing_button';end if;
  buttons:=buttons||jsonb_build_array(jsonb_build_object('label',btrim(button->>'label'),'path',button->>'path'));
 end loop;
 return jsonb_build_object('template',template,'title',title,'body',body,'imagePath',image_path,'goodIds',to_jsonb(ids),'buttons',buttons);
end $$;
revoke all on function private.normalize_marketing_content(jsonb) from public,anon,authenticated,service_role;

create function private.marketing_content_available(p_content jsonb) returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from jsonb_array_elements_text(p_content->'goodIds') requested(id)
  left join public.goods g on g.id=requested.id left join public.ips i on i.id=g.ip_id
  where g.id is null or g.archived_at is not null or g.published_at is null or g.sale_restriction<>'none' or i.archived_at is not null or i.published_at is null);
$$;
revoke all on function private.marketing_content_available(jsonb) from public,anon,authenticated,service_role;

-- The private clock parameter supports deterministic isolated database tests. Clients cannot supply it.
create function private.marketing_schedule_times(p_schedule jsonb,p_at timestamptz) returns timestamptz[]
language plpgsql immutable set search_path='' as $$
declare kind text; start_date date; end_date date; local_time time; at_value timestamptz; weekday integer; times timestamptz[];
begin
 if jsonb_typeof(p_schedule) is distinct from 'object' or jsonb_typeof(p_schedule->'kind') is distinct from 'string' then raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
 kind:=p_schedule->>'kind';
 if kind='immediate' then
  if p_schedule<>'{"kind":"immediate"}' then raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
  if (p_at at time zone 'Asia/Seoul')::time<time '08:00' or (p_at at time zone 'Asia/Seoul')::time>=time '20:00' then raise check_violation using message='marketing_outside_window';end if;
  return array[p_at];
 elsif kind='once' then
  if jsonb_typeof(p_schedule->'at') is distinct from 'string' or exists(select 1 from jsonb_object_keys(p_schedule) key where key<>all(array['kind','at'])) then raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
  begin at_value:=(p_schedule->>'at')::timestamptz;exception when others then raise invalid_parameter_value using message='invalid_marketing_schedule';end;
  times:=array[at_value];
 elsif kind='weekly' then
  if not(p_schedule ?& array['kind','startDate','endDate','weekday','time']) or exists(select 1 from jsonb_object_keys(p_schedule) key where key<>all(array['kind','startDate','endDate','weekday','time']))
   or jsonb_typeof(p_schedule->'startDate') is distinct from 'string' or p_schedule->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$'
   or jsonb_typeof(p_schedule->'endDate') is distinct from 'string' or p_schedule->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$'
   or jsonb_typeof(p_schedule->'time') is distinct from 'string' or p_schedule->>'time' !~ '^(0[89]|1[0-9]):[0-5][0-9]$'
   or jsonb_typeof(p_schedule->'weekday') is distinct from 'number' or p_schedule->>'weekday' !~ '^[0-6]$' then raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
  begin start_date:=(p_schedule->>'startDate')::date;end_date:=(p_schedule->>'endDate')::date;local_time:=(p_schedule->>'time')::time;
  exception when others then raise invalid_parameter_value using message='invalid_marketing_schedule';end;
  weekday:=(p_schedule->>'weekday')::integer;
  if end_date<start_date or end_date-start_date>365 then raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
  select array_agg((day::date+local_time) at time zone 'Asia/Seoul' order by day) into times from generate_series(start_date::timestamp,end_date::timestamp,interval '1 day')day where extract(dow from day)=weekday;
 else raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
 if coalesce(cardinality(times),0)=0 or exists(select 1 from unnest(times) t where t is null or not isfinite(t) or t<=p_at or t>p_at+interval '366 days'
  or (t at time zone 'Asia/Seoul')::time<time '08:00' or (t at time zone 'Asia/Seoul')::time>=time '20:00') then raise invalid_parameter_value using message='invalid_marketing_schedule';end if;
 return times;
end $$;
revoke all on function private.marketing_schedule_times(jsonb,timestamptz) from public,anon,authenticated,service_role;

create function private.marketing_campaign_document(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'reference',c.reference,'name',c.name,'revision',c.revision,'state',c.state,'segmentId',c.segment_id,
  'segmentRevision',c.segment_revision,'segmentName',s.name,'rule',c.rule,'ruleHash',c.rule_hash,'content',c.content,'schedule',c.schedule,'exclusion',c.exclusion,
  'createdAt',c.created_at,'updatedAt',c.updated_at,'archived',c.archived_at is not null,
  'estimate',private.customer_segment_estimate_document(c.estimate_id),
  'selectedProducts',coalesce((select jsonb_agg(jsonb_build_object('kind','good','id',g.id,'label',g.name,'extra',g.code) order by requested.position) from jsonb_array_elements_text(c.content->'goodIds') with ordinality requested(id,position) join public.goods g on g.id=requested.id),'[]'::jsonb),
  'runs',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'scheduledAt',r.scheduled_at,'state',r.state,'reason',r.reason,'startedAt',r.started_at,'completedAt',r.completed_at,
   'candidateCount',r.candidate_count,'sentCount',(select count(*) from private.marketing_recipients rec where rec.run_id=r.id and rec.state='sent'),
   'excludedCount',(select count(*) from private.marketing_recipients rec where rec.run_id=r.id and rec.state='excluded'),
   'readCount',(select count(*) from private.marketing_recipients rec join public.notifications n on n.id=rec.notification_id where rec.run_id=r.id and n.read_at is not null)) order by r.scheduled_at,r.id)
   from private.marketing_runs r where r.campaign_id=c.id),'[]'::jsonb)) from private.marketing_campaigns c join private.customer_segments s on s.id=c.segment_id where c.id=p_id;
$$;
revoke all on function private.marketing_campaign_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_save_marketing_campaign(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_values jsonb,p_publish boolean,p_estimate_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; segment private.customer_segments; previous private.marketing_campaigns; estimate private.customer_segment_estimates;
 content_value jsonb; name_value text; request jsonb; replay jsonb; result jsonb; times timestamptz[]; new_revision integer; image_value text;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null or p_publish is null
  or jsonb_typeof(p_values) is distinct from 'object' or not(p_values ?& array['name','segmentId','segmentRevision','content','schedule','exclusion'])
  or exists(select 1 from jsonb_object_keys(p_values) key where key<>all(array['name','segmentId','segmentRevision','content','schedule','exclusion','copyFrom']))
  or jsonb_typeof(p_values->'name') is distinct from 'string' or char_length(btrim(p_values->>'name')) not between 1 and 50 or p_values->>'name'~'[[:cntrl:]]'
  or jsonb_typeof(p_values->'segmentId') is distinct from 'string' or p_values->>'segmentId' !~* '^[0-9a-f-]{36}$'
  or jsonb_typeof(p_values->'segmentRevision') is distinct from 'number' or p_values->>'segmentRevision' !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_values->'exclusion') is distinct from 'string' or p_values->>'exclusion' not in ('none','received','read')
 then raise invalid_parameter_value using message='invalid_marketing_campaign';end if;
 content_value:=private.normalize_marketing_content(p_values->'content');name_value:=btrim(p_values->>'name');
 request:=jsonb_build_object('id',p_id,'revision',p_expected_revision,'values',p_values,'publish',p_publish,'estimateId',p_estimate_id);
 perform pg_advisory_xact_lock(hashtextextended('marketing-operation:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.marketing.saved',request);if replay is not null then return replay;end if;
 perform pg_advisory_xact_lock(hashtextextended('marketing-campaign:'||p_id::text,0));
 select * into previous from private.marketing_campaigns where id=p_id for update;
 if found and (previous.revision<>p_expected_revision or previous.archived_at is not null or previous.state<>'draft') or not found and p_expected_revision<>0 then raise sqlstate 'PT409' using message='marketing_campaign_changed';end if;
 select * into segment from private.customer_segments where id=(p_values->>'segmentId')::uuid and archived_at is null for share;
 if not found or segment.revision<>(p_values->>'segmentRevision')::integer or not private.customer_segment_references_available(segment.rule) then raise sqlstate 'PT409' using message='customer_segment_changed';end if;
 if not private.marketing_content_available(content_value) then raise check_violation using message='marketing_product_unavailable';end if;
 -- Future schedules are validated for drafts as well. Immediate drafts can be saved outside the delivery window.
 if p_publish or p_values->'schedule' <> '{"kind":"immediate"}' then times:=private.marketing_schedule_times(p_values->'schedule',statement_timestamp());end if;
 if p_publish then
  select * into estimate from private.customer_segment_estimates where id=p_estimate_id;
  if not found or estimate.actor_id is distinct from actor or estimate.rule_hash<>segment.rule_hash or estimate.rule<>segment.rule or estimate.valid_until<=statement_timestamp() then raise check_violation using message='customer_segment_estimate_required';end if;
 end if;
 image_value:=content_value->>'imagePath';
 if image_value is not null and image_value is distinct from previous.content->>'imagePath' then
  if p_values->>'copyFrom' is not null and previous.id is null and exists(select 1 from private.marketing_campaigns src where src.id::text=p_values->>'copyFrom' and src.content->>'imagePath'=image_value) then null;
  else
   update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
   where claim.actor_id=actor and claim.kind='curation' and claim.path=substr(image_value,14) and claim.status='verified' and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
   if not found then raise check_violation using message='unverified_artwork';end if;
  end if;
 end if;
 if previous.id is null then
  insert into private.marketing_campaigns(id,name,segment_id,segment_revision,rule,rule_hash,content,schedule,exclusion,state,sender_id,estimate_id,created_by,updated_by)
  values(p_id,name_value,segment.id,segment.revision,segment.rule,segment.rule_hash,content_value,p_values->'schedule',p_values->>'exclusion',case when p_publish then 'published' else 'draft' end,case when p_publish then actor end,case when p_publish then p_estimate_id end,actor,actor) returning revision into new_revision;
 else
  update private.marketing_campaigns set name=name_value,segment_id=segment.id,segment_revision=segment.revision,rule=segment.rule,rule_hash=segment.rule_hash,content=content_value,schedule=p_values->'schedule',exclusion=p_values->>'exclusion',
   state=case when p_publish then 'published' else 'draft' end,sender_id=case when p_publish then actor end,estimate_id=case when p_publish then p_estimate_id end,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=p_id returning revision into new_revision;
 end if;
 if p_publish then insert into private.marketing_runs(campaign_id,scheduled_at) select p_id,t from unnest(times)t;end if;
 result:=jsonb_build_object('id',p_id,'revision',new_revision,'state',case when p_publish then 'published' else 'draft' end);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.marketing.saved','marketing_campaign:'||p_id,jsonb_build_object('request',request,'result',result));return result;
end $$;
revoke all on function public.admin_save_marketing_campaign(uuid,integer,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_marketing_campaign(uuid,integer,uuid,jsonb,boolean,uuid) to authenticated;

create function public.admin_marketing_campaigns(p_query text default '',p_state text default 'all',p_page integer default 1,p_start date default null,p_end date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_state is null or p_state not in ('all','draft','queued','processing','completed','blocked','canceled','expired') or p_page is null or p_page not between 1 and 100000
  or p_start is not null and p_end is not null and p_start>p_end then raise invalid_parameter_value using message='invalid_marketing_filter';end if;
 with filtered as materialized(select c.* from private.marketing_campaigns c where c.archived_at is null
  and (p_query='' or strpos(lower(c.name),lower(btrim(p_query)))>0 or strpos(c.reference::text,btrim(p_query))>0 or exists(select 1 from private.customer_segments s where s.id=c.segment_id and strpos(lower(s.name),lower(btrim(p_query)))>0))
  and (p_state='all' or p_state='draft' and c.state='draft' or exists(select 1 from private.marketing_runs r where r.campaign_id=c.id and r.state=p_state))
  and (p_start is null or c.created_at>=p_start::timestamp at time zone 'Asia/Seoul') and (p_end is null or c.created_at<(p_end+1)::timestamp at time zone 'Asia/Seoul')),
 rows as(select * from filtered order by created_at desc,id limit 20 offset(p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,'rows',coalesce((select jsonb_agg(private.marketing_campaign_document(id) order by created_at desc,id) from rows),'[]'::jsonb)) into result;return result;
end $$;
revoke all on function public.admin_marketing_campaigns(text,text,integer,date,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_marketing_campaigns(text,text,integer,date,date) to authenticated;
create function public.admin_marketing_product_options(p_query text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_marketing_filter';end if;
 with matched as materialized(select g.id,g.name,g.code from public.goods g join public.ips i on i.id=g.ip_id
  where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null
   and (p_query='' or strpos(lower(g.name||' '||g.code||' '||g.id),lower(btrim(p_query)))>0)),
 rows as(select * from matched order by name,id limit 20 offset(p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from matched),'page',p_page,'pageSize',20,'rows',coalesce((select jsonb_agg(jsonb_build_object('kind','good','id',id,'label',name,'extra',code) order by name,id) from rows),'[]'::jsonb)) into result;return result;
end $$;
revoke all on function public.admin_marketing_product_options(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_marketing_product_options(text,integer) to authenticated;
create function public.admin_get_marketing_campaign(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('marketing.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if not exists(select 1 from private.marketing_campaigns where id=p_id and archived_at is null) then return null;end if;
 return private.marketing_campaign_document(p_id);
end $$;
revoke all on function public.admin_get_marketing_campaign(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_marketing_campaign(uuid) to authenticated;

create function public.admin_change_marketing_campaign(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; campaign private.marketing_campaigns; request jsonb; replay jsonb; result jsonb; affected integer; new_revision integer;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or p_action is null or p_action not in ('cancel','archive') then raise invalid_parameter_value using message='invalid_marketing_action';end if;
 request:=jsonb_build_object('id',p_id,'revision',p_expected_revision,'action',p_action);
 perform pg_advisory_xact_lock(hashtextextended('marketing-operation:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.marketing.'||p_action,request);if replay is not null then return replay;end if;
 select * into campaign from private.marketing_campaigns where id=p_id for update;
 if not found or campaign.revision<>p_expected_revision or campaign.archived_at is not null then raise sqlstate 'PT409' using message='marketing_campaign_changed';end if;
 if p_action='cancel' then
  update private.marketing_runs set state='canceled',completed_at=clock_timestamp() where campaign_id=p_id and state='queued';get diagnostics affected=row_count;
  if affected=0 then raise check_violation using message='marketing_nothing_to_cancel';end if;
 else
  if exists(select 1 from private.marketing_runs where campaign_id=p_id and state in ('queued','processing')) then raise check_violation using message='marketing_campaign_active';end if;
  update private.marketing_campaigns set archived_at=clock_timestamp() where id=p_id;affected:=1;
 end if;
 update private.marketing_campaigns set revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning revision into new_revision;
 result:=jsonb_build_object('id',p_id,'revision',new_revision,'affectedCount',affected);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.marketing.'||p_action,'marketing_campaign:'||p_id,jsonb_build_object('request',request,'result',result));return result;
end $$;
revoke all on function public.admin_change_marketing_campaign(uuid,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_marketing_campaign(uuid,integer,uuid,text) to authenticated;

-- A batch locks every account subject before campaign/run rows. Consent UPDATEs
-- serialize on the profiles share locks; account deletion and role changes use the same subject fences.
create function private.process_marketing_run(p_run_id uuid,p_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare campaign private.marketing_campaigns; run private.marketing_runs; segment private.customer_segments; subjects uuid[]; recipient_ids uuid[];
 rec private.marketing_recipients; reason_value text; notification uuid; inserted_count integer:=0; excluded_count integer:=0; eligible_ids uuid[]; execution_at timestamptz;
begin
 select * into run from private.marketing_runs where id=p_run_id;
 if not found or run.state not in ('queued','processing') or run.scheduled_at>coalesce(p_at,clock_timestamp()) then return jsonb_build_object('processed',false);end if;
 select * into campaign from private.marketing_campaigns where id=run.campaign_id;
 select array_agg(id order by id),array_agg(customer_id order by id) into recipient_ids,subjects from
  (select id,customer_id from private.marketing_recipients where run_id=p_run_id and state='pending' order by id limit 100) pending;
 perform private.lock_operator_subjects(array_append(coalesce(subjects,'{}'),campaign.sender_id));
 select * into campaign from private.marketing_campaigns where id=run.campaign_id for update skip locked;
 if not found then return jsonb_build_object('processed',false);end if;
 select * into run from private.marketing_runs where id=p_run_id for update skip locked;
 if not found or run.state not in ('queued','processing') or run.scheduled_at>coalesce(p_at,clock_timestamp()) then return jsonb_build_object('processed',false);end if;
 if campaign.archived_at is not null or campaign.sender_id is null or not private.has_operator_capability(campaign.sender_id,'marketing.manage',false) then reason_value:='sender_permission';
 else
  select * into segment from private.customer_segments where id=campaign.segment_id for share;
  if not found or segment.archived_at is not null or segment.revision<>campaign.segment_revision or segment.rule_hash<>campaign.rule_hash or not private.customer_segment_references_available(campaign.rule) then reason_value:='segment_changed';
  elsif not private.marketing_content_available(campaign.content) then reason_value:='product_unavailable';end if;
 end if;
 execution_at:=coalesce(p_at,clock_timestamp());
 if reason_value is not null then
  update private.marketing_runs set state='blocked',reason=reason_value,completed_at=execution_at where id=p_run_id;
  update private.marketing_recipients set state='excluded',reason=reason_value where run_id=p_run_id and state='pending';
  return jsonb_build_object('processed',true,'state','blocked','reason',reason_value);
 end if;
 if run.state='queued' and run.scheduled_at+interval '1 hour'<execution_at then
  update private.marketing_runs set state='expired',reason='start_deadline',completed_at=execution_at where id=p_run_id;return jsonb_build_object('processed',true,'state','expired');end if;
 if (execution_at at time zone 'Asia/Seoul')::time<time '08:00' or (execution_at at time zone 'Asia/Seoul')::time>=time '20:00' then
  if run.state='processing' then
   update private.marketing_recipients set state='excluded',reason='delivery_window_ended' where run_id=p_run_id and state='pending';
   update private.marketing_runs set state='completed',reason='delivery_window_ended',completed_at=execution_at where id=p_run_id;return jsonb_build_object('processed',true,'state','completed');
  end if;return jsonb_build_object('processed',false);
 end if;
 if run.state='queued' then
  insert into private.marketing_recipients(run_id,customer_id)
   select p_run_id,m.customer_id from private.customer_segment_members(campaign.rule,execution_at)m where m.marketing_consent;
  get diagnostics inserted_count=row_count;
  update private.marketing_runs set state=case when inserted_count=0 then 'completed' else 'processing' end,started_at=execution_at,candidate_count=inserted_count,completed_at=case when inserted_count=0 then execution_at end where id=p_run_id;
  return jsonb_build_object('processed',true,'state',case when inserted_count=0 then 'completed' else 'processing' end,'candidateCount',inserted_count,'sentCount',0);
 end if;
 -- Resolve the full segment once per batch after all selected profile locks.
 select coalesce(array_agg(m.customer_id),'{}'::uuid[]) into eligible_ids from private.customer_segment_members(campaign.rule,execution_at)m where m.marketing_consent and m.customer_id=any(coalesce(subjects,'{}'));
 for rec in select * from private.marketing_recipients where id=any(coalesce(recipient_ids,'{}')) and run_id=p_run_id and state='pending' order by id for update loop
  reason_value:=null;
  if rec.customer_id is null or not(rec.customer_id=any(eligible_ids)) then reason_value:='customer_no_longer_eligible';
  elsif campaign.exclusion<>'none' and exists(select 1 from private.marketing_recipients prior join private.marketing_runs earlier on earlier.id=prior.run_id left join public.notifications n on n.id=prior.notification_id
   where earlier.campaign_id=campaign.id and earlier.id<>run.id and prior.customer_id=rec.customer_id and prior.state='sent' and (campaign.exclusion='received' or n.read_at is not null)) then reason_value:='already_'||campaign.exclusion;end if;
  if reason_value is not null then
   update private.marketing_recipients set state='excluded',reason=reason_value where id=rec.id;excluded_count:=excluded_count+1;
  else
   insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(rec.customer_id,'marketing_message',campaign.content->>'title',campaign.content->>'body','/notifications/marketing/'||rec.id,'marketing_campaign',campaign.id::text,'marketing:'||rec.id)
   on conflict(user_id,dedupe_key) do update set dedupe_key=excluded.dedupe_key returning id into notification;
   update private.marketing_recipients set state='sent',notification_id=notification,registered_at=execution_at where id=rec.id;inserted_count:=inserted_count+1;
  end if;
 end loop;
 if not exists(select 1 from private.marketing_recipients where run_id=p_run_id and state='pending') then update private.marketing_runs set state='completed',completed_at=execution_at where id=p_run_id;end if;
 return jsonb_build_object('processed',true,'state',(select state from private.marketing_runs where id=p_run_id),'sentCount',inserted_count,'excludedCount',excluded_count);
end $$;
revoke all on function private.process_marketing_run(uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.process_due_marketing_campaigns(p_campaign_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run_id uuid; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='service_role_required';end if;
 select r.id into run_id from private.marketing_runs r where r.state in ('queued','processing') and r.scheduled_at<=statement_timestamp()
  and (p_campaign_id is null or r.campaign_id=p_campaign_id) order by r.scheduled_at,r.id limit 1;
 if run_id is null then return jsonb_build_object('processed',false);end if;
 result:=private.process_marketing_run(run_id,null);return result||jsonb_build_object('runId',run_id);
end $$;
revoke all on function public.process_due_marketing_campaigns(uuid) from public,anon,authenticated,service_role;
grant execute on function public.process_due_marketing_campaigns(uuid) to service_role;

create function public.get_my_marketing_message(p_recipient_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or private.is_account_write_fenced(auth.uid()) then return null;end if;
 select jsonb_build_object('id',rec.id,'registeredAt',rec.registered_at,'content',c.content,
  'goodIds',coalesce((select jsonb_agg(g.id order by choice.position)
    from jsonb_array_elements_text(c.content->'goodIds') with ordinality choice(id,position) join public.goods g on g.id=choice.id join public.ips i on i.id=g.ip_id
    where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null),'[]'::jsonb)) into result
 from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id join private.marketing_campaigns c on c.id=r.campaign_id
 where rec.id=p_recipient_id and rec.customer_id=auth.uid() and rec.state='sent' and exists(select 1 from public.profiles where id=auth.uid() and suspended_at is null);
 return result;
end $$;
revoke all on function public.get_my_marketing_message(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_marketing_message(uuid) to authenticated;

-- Keep images referenced by archived campaigns: existing recipients can still open them.
create or replace function private.goods_photo_references(target_path text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
  select g.id,g.name,'good'::text kind from public.goods g where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}')||coalesce(g.description_image_paths,'{}'),null))
  union all select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
  union all select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
  union all select d.id::text,'개인 임시저장 상품','draft' from public.admin_goods_drafts d where d.archived_at is null and target_path=any(d.image_paths)
  union all select s.id::text,s.title,'story' from public.shopping_stories s where target_path=any(s.body_image_paths)
  union all select r.id::text,r.title,'relation' from public.goods_relations r where target_path=r.image_path
  union all select c.id::text,c.name,'marketing' from private.marketing_campaigns c where target_path=c.content->>'imagePath'
 ) refs;
$$;
revoke all on function private.goods_photo_references(text) from public,anon,authenticated,service_role;
do $$declare f regprocedure;begin
 perform private.register_operator_rpc_contract('public.admin_save_marketing_campaign(uuid,integer,uuid,jsonb,boolean,uuid)'::regprocedure,'marketing.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_change_marketing_campaign(uuid,integer,uuid,text)'::regprocedure,'marketing.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_marketing_campaigns(text,text,integer,date,date)'::regprocedure,'marketing.manage','read',false);
 perform private.register_operator_rpc_contract('public.admin_marketing_product_options(text,integer)'::regprocedure,'marketing.manage','read',false);
 perform private.register_operator_rpc_contract('public.admin_get_marketing_campaign(uuid)'::regprocedure,'marketing.manage','read',false);
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and
  (p.proname in ('normalize_marketing_content','process_marketing_run','goods_photo_references') or p.proname like 'marketing_%') loop perform private.register_operator_internal_contract(f);end loop;
 perform private.register_operator_internal_contract('public.process_due_marketing_campaigns(uuid)'::regprocedure);
 perform private.register_operator_internal_contract('public.get_my_marketing_message(uuid)'::regprocedure);
end $$;
