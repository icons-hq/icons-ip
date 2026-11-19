-- 운영 알림 요약 메일(원장 CUS-071·CUS-076·OPS-095·OPS-039·OPS-040·PAY-064).
--
-- 앱 안 운영 알림 벨(private.admin_operation_alerts)은 어드민 탭이 열려 있을 때만 보인다. 업무 외 시간이나 탭을
-- 닫은 동안의 새 문의·상품 문의·자동 작업 멈춤을 아무도 모른다. 이 migration은 5분마다 도는 cron이 그 알림 원장을 읽어
-- 운영 메일 주소로 '한 통의 요약'을 보내게 한다.
--
--   · 범주: 새 1:1 문의(inquiries), 새 상품 문의(questions), 답변 지연(delay), 시스템 장애(system). 설정으로 고른다.
--   · 새 알림은 커서((created_at,id) 순서)로 한 번씩만 센다. 켤 때 커서를 지금으로 옮겨 옛 알림이 쏟아지지 않는다.
--     커밋이 늦은 알림을 놓치지 않도록 30초 안쪽 알림은 다음 틱에 센다. 요약은 10분에 한 통까지다(넘친 알림은 다음 요약에 묶인다).
--   · 답변 지연: 답변을 기다리는(open) 1:1 문의와 답변 없는 상품 문의가 설정 시간(기본 4시간, 1~72)을 넘으면 그 문의당
--     한 번만(문의, 마지막 고객 활동 시각) 요약에 넣는다. 고객이 다시 문의를 열어 또 늦으면 다시 센다. 7일 넘게 묵은 것은 세지 않는다.
--   · 메일에는 건수·분류·어드민 링크·자동 작업 이름만 싣는다. 문의 제목·본문·고객 이름·연락처는 싣지 않는다.
--   · 발송은 안전재고 요약 메일처럼 durable dispatcher(전용 gate = 이 설정의 '사용')와 (실행, 주소)당 한 행의 멱등 키를 쓴다.
--   · 기본은 꺼짐이다. 이 migration은 메일을 보내지 않는다.
-- 시스템 장애 알림의 근원: Vercel cron 실패(service_record_system_job_run)와 pg_cron 실패 점검이 이미
-- category='system' 알림 행을 만든다(20261118162000). 앱의 notifySystemIncident는 그 원장 경로에 기대며 메일을 직접 보내지 않는다.
begin;

create table private.ops_alert_digest_settings (
  singleton boolean primary key default true check(singleton),
  revision bigint not null default 1 check(revision>0),
  enabled boolean not null default false,
  recipients text[] not null default '{}'::text[] check(cardinality(recipients)<=10),
  categories text[] not null default array['inquiries','questions','delay','system']::text[]
    check(cardinality(categories)>=1 and categories<@array['inquiries','questions','delay','system']::text[]),
  delay_hours integer not null default 4 check(delay_hours between 1 and 72),
  -- 마지막으로 센 운영 알림 위치. 이보다 뒤에 생긴 알림만 센다.
  cursor_at timestamptz not null default clock_timestamp(),
  cursor_id uuid not null default '00000000-0000-0000-0000-000000000000',
  enabled_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  check(not enabled or enabled_at is not null)
);
insert into private.ops_alert_digest_settings(singleton) values(true);

create table private.ops_alert_digest_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  settings_revision bigint not null,
  -- {inquiries,questions,delayedInquiries,delayedQuestions,system}. 메일 내용의 진실원이다(재시도도 같은 내용).
  counts jsonb not null check(jsonb_typeof(counts)='object'),
  system_titles jsonb not null default '[]'::jsonb check(jsonb_typeof(system_titles)='array'),
  delayed jsonb not null default '[]'::jsonb check(jsonb_typeof(delayed)='array'),
  delivery_count integer not null default 0 check(delivery_count>=0)
);
create index ops_alert_digest_runs_created on private.ops_alert_digest_runs(created_at desc);

create table private.ops_alert_digest_delay_marks (
  kind text not null check(kind in ('inquiry','question')),
  target_id uuid not null,
  activity_at timestamptz not null,
  run_id uuid not null references private.ops_alert_digest_runs(id) on delete cascade,
  primary key(kind,target_id,activity_at)
);

create table private.ops_alert_digest_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references private.ops_alert_digest_runs(id) on delete cascade,
  recipient text not null check(char_length(recipient) between 3 and 254),
  email_status text not null default 'queued' check(email_status in ('queued','processing','sent','failed','unknown','suppressed')),
  email_intent_id uuid unique references private.email_intents(id) on delete set null,
  error_code text,
  retryable boolean not null default false,
  claim_token uuid,
  lease_until timestamptz,
  available_at timestamptz default clock_timestamp(),
  attempts integer not null default 0 check(attempts between 0 and 100),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(run_id,recipient)
);
create index ops_alert_digest_jobs on private.ops_alert_digest_deliveries(available_at,id)
  where email_status in ('queued','processing','unknown');

alter table private.ops_alert_digest_settings enable row level security;
alter table private.ops_alert_digest_runs enable row level security;
alter table private.ops_alert_digest_delay_marks enable row level security;
alter table private.ops_alert_digest_deliveries enable row level security;
revoke all on private.ops_alert_digest_settings,private.ops_alert_digest_runs,private.ops_alert_digest_delay_marks,
  private.ops_alert_digest_deliveries from public,anon,authenticated,service_role;

create function private.normalize_ops_alert_recipients(p_values text[])
returns text[] language plpgsql immutable set search_path='' as $$
declare value text;normalized text[]:='{}'::text[];
begin
  if p_values is null then raise invalid_parameter_value using message='invalid_ops_alert_recipient';end if;
  foreach value in array p_values loop
    value:=lower(btrim(coalesce(value,''),E' \t\n\r\f\v'));
    if value='' then continue;end if;
    if char_length(value)>254 or value!~'^[^@[:space:][:cntrl:],;<>"]{1,64}@[^@[:space:][:cntrl:],;<>"]+\.[^@[:space:][:cntrl:],;<>".]+$' then
      raise invalid_parameter_value using message='invalid_ops_alert_recipient';
    end if;
    if not value=any(normalized) then normalized:=normalized||value;end if;
  end loop;
  if cardinality(normalized)>10 then raise invalid_parameter_value using message='ops_alert_recipient_limit';end if;
  return normalized;
end $$;
revoke all on function private.normalize_ops_alert_recipients(text[]) from public,anon,authenticated,service_role;

-- 고른 범주를 허용 목록 안에서 중복 없이 고정 순서로 정리한다. 비었거나 모르는 값이 있으면 거절한다.
create function private.normalize_ops_alert_categories(p_values text[])
returns text[] language plpgsql immutable set search_path='' as $$
declare allowed text[]:=array['inquiries','questions','delay','system'];value text;picked text[]:='{}'::text[];
begin
  if p_values is null or cardinality(p_values)=0 then raise invalid_parameter_value using message='invalid_ops_alert_category';end if;
  foreach value in array p_values loop
    if value is null or not value=any(allowed) then raise invalid_parameter_value using message='invalid_ops_alert_category';end if;
  end loop;
  foreach value in array allowed loop if value=any(p_values) then picked:=picked||value;end if;end loop;
  return picked;
end $$;
revoke all on function private.normalize_ops_alert_categories(text[]) from public,anon,authenticated,service_role;

create function private.ops_alert_digest_document(p_now timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'revision',s.revision,'enabled',s.enabled,'recipients',to_jsonb(s.recipients),'categories',to_jsonb(s.categories),
    'delayHours',s.delay_hours,'enabledAt',s.enabled_at,'updatedAt',s.updated_at,'updatedByName',updater.nickname,
    'runs',coalesce((select jsonb_agg(jsonb_build_object('runId',run.id,'createdAt',run.created_at,'counts',run.counts,
        'deliveries',coalesce((select jsonb_agg(jsonb_build_object('recipient',d.recipient,'status',d.email_status,
            'errorCode',d.error_code,'attempts',d.attempts,'updatedAt',d.updated_at) order by d.recipient)
          from private.ops_alert_digest_deliveries d where d.run_id=run.id),'[]'::jsonb)) order by run.created_at desc)
      from (select * from private.ops_alert_digest_runs order by created_at desc limit 10) run),'[]'::jsonb))
  from private.ops_alert_digest_settings s left join public.profiles updater on updater.id=s.updated_by
  where s.singleton;
$$;
revoke all on function private.ops_alert_digest_document(timestamptz) from public,anon,authenticated,service_role;

create function public.admin_get_ops_alert_digest()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
  return private.ops_alert_digest_document(clock_timestamp());
end $$;
revoke all on function public.admin_get_ops_alert_digest() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_ops_alert_digest() to authenticated;

create function public.admin_save_ops_alert_digest(p_enabled boolean,p_recipients text[],p_categories text[],p_delay_hours integer,
  p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;previous private.ops_alert_digest_settings;v_recipients text[];v_categories text[];request jsonb;receipt jsonb;at_value timestamptz;
begin
  actor:=private.require_operator_capability('platform.manage',false);
  if p_enabled is null or p_delay_hours is null or p_delay_hours not between 1 and 72
    or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null then
    raise invalid_parameter_value using message='invalid_ops_alert_digest';
  end if;
  v_recipients:=private.normalize_ops_alert_recipients(p_recipients);
  v_categories:=private.normalize_ops_alert_categories(p_categories);
  request:=jsonb_build_object('enabled',p_enabled,'recipients',to_jsonb(v_recipients),'categories',to_jsonb(v_categories),
    'delayHours',p_delay_hours,'expectedRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('ops-alert-digest-operation:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.ops_alert_digest.settings',request);
  if receipt is not null then return receipt;end if;
  select * into previous from private.ops_alert_digest_settings where singleton for update;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='ops_alert_digest_changed';end if;
  at_value:=clock_timestamp();
  update private.ops_alert_digest_settings set revision=revision+1,enabled=p_enabled,recipients=v_recipients,categories=v_categories,
    delay_hours=p_delay_hours,
    -- 켤 때 커서를 지금으로 옮긴다. 꺼져 있던 동안 쌓인 알림이 한꺼번에 메일로 나가지 않는다.
    cursor_at=case when p_enabled and not previous.enabled then at_value else previous.cursor_at end,
    cursor_id=case when p_enabled and not previous.enabled then '00000000-0000-0000-0000-000000000000'::uuid else previous.cursor_id end,
    enabled_at=case when p_enabled and not previous.enabled then at_value when p_enabled then previous.enabled_at else null end,
    updated_by=actor,updated_at=at_value where singleton;
  receipt:=private.ops_alert_digest_document(at_value);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.ops_alert_digest.settings','ops_alert_digest',
    jsonb_build_object('request',request,'before',jsonb_build_object('enabled',previous.enabled,'recipients',to_jsonb(previous.recipients),
      'categories',to_jsonb(previous.categories),'delayHours',previous.delay_hours),'result',receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_ops_alert_digest(boolean,text[],text[],integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_ops_alert_digest(boolean,text[],text[],integer,bigint,uuid) to authenticated;

-- 새 요약 한 건을 만든다. 켜져 있고 직전 요약이 10분 전이고 보낼 내용이 있을 때만. 알림이 있는데 받는 주소가 없으면
-- 요약 행만 남기고(발송 행 없음) 커서를 넘긴다 — 주소를 넣은 뒤 옛 알림이 쏟아지지 않는다.
create function private.prepare_ops_alert_digest(p_now timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s private.ops_alert_digest_settings;new_cursor_at timestamptz;new_cursor_id uuid;new_run uuid;
  n_inquiries integer:=0;n_questions integer:=0;n_system integer:=0;n_delay_inq integer:=0;n_delay_q integer:=0;
  titles jsonb:='[]'::jsonb;late jsonb:='[]'::jsonb;late_q jsonb;delayed jsonb:='[]'::jsonb;recipient text;deliveries integer:=0;
begin
  if p_now is null then raise invalid_parameter_value using message='invalid_ops_alert_digest_run';end if;
  select * into s from private.ops_alert_digest_settings where singleton;
  if not found or not s.enabled then return jsonb_build_object('status','disabled');end if;
  if exists(select 1 from private.ops_alert_digest_runs where created_at>p_now-interval '10 minutes') then
    return jsonb_build_object('status','throttled');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ops-alert-digest-prepare',0));
  select * into s from private.ops_alert_digest_settings where singleton for update;
  if not s.enabled then return jsonb_build_object('status','disabled');end if;
  if exists(select 1 from private.ops_alert_digest_runs where created_at>p_now-interval '10 minutes') then
    return jsonb_build_object('status','throttled');
  end if;

  -- 새 알림. 모든 범주의 위치로 커서를 옮기되 센 건 고른 범주뿐이다.
  select a.created_at,a.id into new_cursor_at,new_cursor_id from private.admin_operation_alerts a
    where (a.created_at,a.id)>(s.cursor_at,s.cursor_id) and a.created_at<=p_now-interval '30 seconds'
    order by a.created_at desc,a.id desc limit 1;
  if new_cursor_at is not null then
    select count(*) filter(where a.category='inquiries' and 'inquiries'=any(s.categories)),
           count(*) filter(where a.category='questions' and 'questions'=any(s.categories)),
           count(*) filter(where a.category='system' and 'system'=any(s.categories))
      into n_inquiries,n_questions,n_system
      from private.admin_operation_alerts a
      where (a.created_at,a.id)>(s.cursor_at,s.cursor_id) and (a.created_at,a.id)<=(new_cursor_at,new_cursor_id);
    if n_system>0 then
      select coalesce(jsonb_agg(picked.t order by picked.t),'[]'::jsonb) into titles from (
        select distinct a.title as t from private.admin_operation_alerts a
        where a.category='system' and (a.created_at,a.id)>(s.cursor_at,s.cursor_id) and (a.created_at,a.id)<=(new_cursor_at,new_cursor_id)
        order by 1 limit 5) picked;
    end if;
  end if;

  -- 답변 지연. 문의당 한 번만(마지막 고객 활동 시각이 같은 동안). 한 번에 50건까지 센다.
  if 'delay'=any(s.categories) then
    select coalesce(jsonb_agg(jsonb_build_object('kind','inquiry','targetId',x.id,'activityAt',x.last_message_at,
        'href','/admin/cs/inquiries/'||x.id) order by x.last_message_at,x.id),'[]'::jsonb) into late
      from (select i.id,i.last_message_at from public.inquiries i
        where i.status='open' and i.last_message_at<=p_now-make_interval(hours=>s.delay_hours) and i.last_message_at>p_now-interval '7 days'
          and not exists(select 1 from private.ops_alert_digest_delay_marks m where m.kind='inquiry' and m.target_id=i.id and m.activity_at=i.last_message_at)
        order by i.last_message_at,i.id limit 50) x;
    select coalesce(jsonb_agg(jsonb_build_object('kind','question','targetId',x.id,'activityAt',x.created_at,
        'href','/admin/cs/qna?status=unanswered') order by x.created_at,x.id),'[]'::jsonb) into late_q
      from (select q.id,q.created_at from public.product_questions q
        where q.status='visible' and q.answer_body is null and q.created_at<=p_now-make_interval(hours=>s.delay_hours) and q.created_at>p_now-interval '7 days'
          and not exists(select 1 from private.ops_alert_digest_delay_marks m where m.kind='question' and m.target_id=q.id and m.activity_at=q.created_at)
        order by q.created_at,q.id limit greatest(0,50-jsonb_array_length(late))) x;
    late:=late||late_q;
    select count(*) filter(where e->>'kind'='inquiry'),count(*) filter(where e->>'kind'='question') into n_delay_inq,n_delay_q
      from jsonb_array_elements(late) e;
    select coalesce(jsonb_agg(jsonb_build_object('kind',l.e->>'kind','href',l.e->>'href','waitedHours',
        floor(extract(epoch from p_now-(l.e->>'activityAt')::timestamptz)/3600)::integer) order by (l.e->>'activityAt')::timestamptz),'[]'::jsonb)
      into delayed from (select e from jsonb_array_elements(late) e order by (e->>'activityAt')::timestamptz limit 10) l;
  end if;

  if n_inquiries+n_questions+n_system+n_delay_inq+n_delay_q=0 then
    if new_cursor_at is not null then
      update private.ops_alert_digest_settings set cursor_at=new_cursor_at,cursor_id=new_cursor_id where singleton;
    end if;
    return jsonb_build_object('status','nothing_to_send');
  end if;

  insert into private.ops_alert_digest_runs(created_at,settings_revision,counts,system_titles,delayed)
    values(p_now,s.revision,jsonb_build_object('inquiries',n_inquiries,'questions',n_questions,'delayedInquiries',n_delay_inq,
      'delayedQuestions',n_delay_q,'system',n_system),titles,delayed) returning id into new_run;
  insert into private.ops_alert_digest_delay_marks(kind,target_id,activity_at,run_id)
    select e->>'kind',(e->>'targetId')::uuid,(e->>'activityAt')::timestamptz,new_run from jsonb_array_elements(late) e;
  if new_cursor_at is not null then
    update private.ops_alert_digest_settings set cursor_at=new_cursor_at,cursor_id=new_cursor_id where singleton;
  end if;
  foreach recipient in array s.recipients loop
    insert into private.ops_alert_digest_deliveries(run_id,recipient) values(new_run,recipient);
    deliveries:=deliveries+1;
  end loop;
  update private.ops_alert_digest_runs set delivery_count=deliveries where id=new_run;
  insert into public.audit_log(actor_id,action,target,diff) values(null,'system.ops_alert_digest.prepared','ops_alert_digest:'||new_run,
    jsonb_build_object('settingsRevision',s.revision,'inquiries',n_inquiries,'questions',n_questions,'delayedInquiries',n_delay_inq,
      'delayedQuestions',n_delay_q,'system',n_system,'deliveries',deliveries));
  return jsonb_build_object('status','prepared','runId',new_run,'deliveries',deliveries);
end $$;
revoke all on function private.prepare_ops_alert_digest(timestamptz) from public,anon,authenticated,service_role;

create function public.claim_ops_alert_digest_jobs(batch_limit integer default 25)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  if batch_limit is null or batch_limit not between 1 and 25 then raise invalid_parameter_value using message='invalid_ops_alert_digest_batch';end if;
  perform private.prepare_ops_alert_digest(clock_timestamp());
  if not coalesce((select enabled from private.ops_alert_digest_settings where singleton),false) then return '[]'::jsonb;end if;
  -- 운영 알림은 시간이 지나면 의미가 줄어든다. 6시간 넘게 못 보낸 대기분은 보내지 않는다(다음 요약이 새 알림을 맡는다).
  update private.ops_alert_digest_deliveries d set email_status='failed',error_code='digest_expired',retryable=false,
    available_at=null,lease_until=null,claim_token=null,updated_at=clock_timestamp()
    from private.ops_alert_digest_runs r
    where r.id=d.run_id and d.email_status='queued' and r.created_at<clock_timestamp()-interval '6 hours';
  update private.ops_alert_digest_deliveries set email_status='unknown',error_code='delivery_needs_review',retryable=false,
    available_at=null,lease_until=null,claim_token=null,updated_at=clock_timestamp()
    where email_status in ('queued','processing','unknown') and attempts>=100 and (lease_until is null or lease_until<clock_timestamp());
  with selected as (
    select d.id from private.ops_alert_digest_deliveries d
    where d.attempts<100 and ((d.email_status in ('queued','unknown') and d.available_at<=clock_timestamp())
      or (d.email_status='processing' and d.lease_until<clock_timestamp()))
    order by d.available_at nulls last,d.id for update skip locked limit batch_limit
  ), claimed as (
    update private.ops_alert_digest_deliveries d set email_status='processing',claim_token=extensions.gen_random_uuid(),
      lease_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,updated_at=clock_timestamp()
    from selected where d.id=selected.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claimToken',c.claim_token,'recipient',c.recipient,
      'createdAt',r.created_at,'counts',r.counts,'systemTitles',r.system_titles,'delayed',r.delayed) order by c.id),'[]'::jsonb)
    into result from claimed c join private.ops_alert_digest_runs r on r.id=c.run_id;
  return result;
end $$;

create function public.bind_ops_alert_digest_intent(target_id uuid,target_claim uuid,target_intent uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare d private.ops_alert_digest_deliveries%rowtype;i private.email_intents%rowtype;
begin
  select * into d from private.ops_alert_digest_deliveries where id=target_id for update;
  if not found or d.email_status<>'processing' or d.claim_token is distinct from target_claim or d.lease_until<=clock_timestamp() then return false;end if;
  select * into i from private.email_intents where id=target_intent for update;
  if not found or i.source<>'ops_alert_digest' or i.message_kind<>'ops_alert_digest' or i.content_revision<>'ops_alert_digest_v1'
    or (d.email_intent_id is not null and d.email_intent_id<>i.id) then raise check_violation using message='ops_alert_digest_intent_mismatch';end if;
  update private.ops_alert_digest_deliveries set email_intent_id=i.id where id=d.id;
  return true;
end $$;

create function public.finish_ops_alert_digest_job(target_id uuid,target_claim uuid,target_status text,target_error text,target_retryable boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare d private.ops_alert_digest_deliveries%rowtype;i private.email_intents%rowtype;status text:=target_status;code text:=target_error;can_retry boolean:=target_retryable;
begin
  if target_status is null or target_status not in ('sent','queued','failed','unknown','suppressed') or target_retryable is null
    or target_error is not null and target_error not in ('provider_suppressed','provider_rejected','delivery_disabled','delivery_in_progress',
      'delivery_needs_review','delivery_outcome_unknown','provider_retryable','provider_not_configured')
  then raise invalid_parameter_value using message='invalid_ops_alert_digest_result';end if;
  select * into d from private.ops_alert_digest_deliveries where id=target_id for update;
  if not found or d.email_status<>'processing' or d.claim_token is distinct from target_claim then return false;end if;
  select * into i from private.email_intents where id=d.email_intent_id for update;
  -- 공급사 수락이 커밋됐으면 응답 유실과 무관하게 그 결과가 이긴다.
  if i.state in ('accepted','sent','delivered','delayed') then status:='sent';code:=null;can_retry:=false;
  elsif i.state in ('bounced','complained','failed') then status:='failed';code:='provider_rejected';can_retry:=false;
  elsif i.state='suppressed' then status:='suppressed';code:='provider_suppressed';can_retry:=false;
  elsif i.state='needs_review' then status:='unknown';code:='delivery_needs_review';can_retry:=false;
  elsif status='sent' then raise check_violation using message='ops_alert_digest_acceptance_required';
  end if;
  if status='failed' and can_retry then
    update private.ops_alert_digest_deliveries set email_status='queued',error_code=code,retryable=true,
      available_at=clock_timestamp()+interval '10 minutes',claim_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=d.id;
  else
    update private.ops_alert_digest_deliveries set email_status=status,error_code=code,retryable=false,
      available_at=case when status='queued' or (status='unknown' and code='delivery_outcome_unknown')
        then clock_timestamp()+interval '2 minutes' end,
      claim_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=d.id;
  end if;
  return true;
end $$;

revoke all on function public.claim_ops_alert_digest_jobs(integer),public.bind_ops_alert_digest_intent(uuid,uuid,uuid),
  public.finish_ops_alert_digest_job(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_ops_alert_digest_jobs(integer),public.bind_ops_alert_digest_intent(uuid,uuid,uuid),
  public.finish_ops_alert_digest_job(uuid,uuid,text,text,boolean) to service_role;

-- 90일 지난 요약 기록 정리(발송 행·지연 표식은 cascade).
select cron.schedule('ops-alert-digest-retention','23 3 * * *',$job$delete from private.ops_alert_digest_runs where created_at<now()-interval '90 days'$job$);

-- #191 dispatcher에 새 출처를 더한다(안전재고 요약 메일과 같은 방식). 제약은 목록 끝에 덧붙이고, 함수는 앵커가 정확히
-- 한 번 나오지 않으면 멈춘다 — 다른 출처가 늘어 있어도 조용히 덮어쓰지 않는다.
do $$
declare spec record;definition text;anchor text:='''::text])';
begin
  for spec in select * from (values
    ('private.email_intents','email_intents_source_check'),
    ('private.email_intents','email_intents_message_kind_check'),
    ('private.email_intent_fences','email_intent_fences_source_check')) supplied(table_name,constraint_name) loop
    select pg_get_constraintdef(c.oid) into definition from pg_constraint c
      where c.conrelid=spec.table_name::regclass and c.conname=spec.constraint_name;
    if definition is null or position('ops_alert_digest' in definition)>0
      or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'ops alert digest email constraint changed: %',spec.constraint_name;
    end if;
    execute format('alter table %s drop constraint %I',spec.table_name,spec.constraint_name);
    execute format('alter table %s add constraint %I %s',spec.table_name,spec.constraint_name,
      replace(definition,anchor,'''::text, ''ops_alert_digest''::text])'));
  end loop;
end $$;

create function private.o3g_patch_function(p_signature text,p_anchor text,p_replacement text)
returns void language plpgsql volatile set search_path='' as $$
declare body text;found_count integer;
begin
  body:=pg_get_functiondef(p_signature::regprocedure);
  found_count:=(length(body)-length(replace(body,p_anchor,'')))/length(p_anchor);
  if found_count<>1 then raise exception 'o3g_anchor_changed: % (found %)',p_signature,found_count;end if;
  execute replace(body,p_anchor,p_replacement);
end $$;
revoke all on function private.o3g_patch_function(text,text,text) from public,anon,authenticated,service_role;

select private.o3g_patch_function('public.enqueue_email_intent(text,text,text,text,text)',
  $a$) then raise check_violation using message='invalid_email_source'$a$,
  $a$,'ops_alert_digest') then raise check_violation using message='invalid_email_source'$a$);
select private.o3g_patch_function('public.enqueue_email_intent(text,text,text,text,text)',
  E')\n then raise check_violation using message=''invalid_email_message_kind''',
  E',''ops_alert_digest'')\n then raise check_violation using message=''invalid_email_message_kind''');
select private.o3g_patch_function('public.enqueue_email_intent(text,text,text,text,text)',
  ' if target_content_revision is null',
  E' if (target_source=''ops_alert_digest'') is distinct from (target_message_kind=''ops_alert_digest'') then raise check_violation using message=''invalid_email_message_kind'';end if;\n if target_content_revision is null');
-- 전용 gate: 이 설정의 '사용'. 다른 출처의 gate와 섞이지 않는다.
select private.o3g_patch_function('public.claim_email_intent_dispatch(uuid,text)',
  ' else v_control.enabled end',
  ' when v_intent.source=''ops_alert_digest'' then coalesce((select d.enabled from private.ops_alert_digest_settings d where d.singleton),false) else v_control.enabled end');
drop function private.o3g_patch_function(text,text,text);

revoke all on function public.enqueue_email_intent(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_email_intent(text,text,text,text,text) to service_role;
revoke all on function public.claim_email_intent_dispatch(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_email_intent_dispatch(uuid,text) to service_role;
-- 재정의한 함수의 운영자 계약을 새 본문·ACL로 다시 등록한다(등록돼 있지 않으면 아무것도 하지 않는다).
do $$declare fn regprocedure;contract record;begin
  foreach fn in array array['public.enqueue_email_intent(text,text,text,text,text)'::regprocedure,
    'public.claim_email_intent_dispatch(uuid,text)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
    if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

select private.register_operator_rpc_contract('public.admin_get_ops_alert_digest()'::regprocedure,'platform.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_ops_alert_digest(boolean,text[],text[],integer,bigint,uuid)'::regprocedure,'platform.manage','write',false);

commit;
notify pgrst,'reload schema';
