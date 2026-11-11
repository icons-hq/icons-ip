-- 안전재고 하루 1회 요약 메일(QNA-014, 사용자 결정 '하루 1회 요약 메일(운영자·서원)').
--
-- 매일 설정 시각(KST, 기본 09:00)이 지나면 그날 한 번, 안전재고 기준 이하인 사용 중 옵션을 모아
-- 운영자 수신 주소(전체 목록)와 출고지 담당자 주소(그 출고지 상품만)로 보낸다.
-- 기본값 09:00: 국내 업무 시작 시각이라 담당자가 그날 안에 실재고를 확인하고, 자동 발주확인·출고 마감
-- 기본 시각(16:30, ADR-0025) 전에 보충·품절 처리를 할 수 있다. 전날 저녁 주문까지 반영된다.
--
-- 멱등: 날짜당 실행 행 하나(digest_date PK)와 (날짜, 수신 주소)당 발송 행 하나. 한 주소가 운영자와
-- 출고지 담당자 양쪽에 있으면 전체 목록 한 통만 간다. 발송은 기존 durable dispatcher(#191)를 쓰고,
-- 주문 지연 안내처럼 전용 gate(이 설정의 '사용')로 연다. 수신 주소가 비어 있거나 대상 옵션이 없으면 보내지 않는다.
-- 기본은 꺼짐이다. 이 migration은 메일을 보내지 않는다.
begin;

create table private.stock_safety_digest_settings (
  singleton boolean primary key default true check(singleton),
  revision bigint not null default 1 check(revision>0),
  enabled boolean not null default false,
  send_time time(0) not null default '09:00' check(extract(second from send_time)=0),
  operator_recipients text[] not null default '{}'::text[] check(cardinality(operator_recipients)<=10),
  enabled_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  check(not enabled or enabled_at is not null)
);
insert into private.stock_safety_digest_settings(singleton) values(true);

create table private.stock_safety_digest_origin_recipients (
  origin_id uuid primary key references public.fulfillment_origins(id) on delete cascade,
  revision bigint not null default 1 check(revision>0),
  recipients text[] not null default '{}'::text[] check(cardinality(recipients)<=5),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

create table private.stock_safety_digest_runs (
  digest_date date primary key,
  settings_revision bigint not null,
  send_time time(0) not null,
  created_at timestamptz not null default clock_timestamp(),
  item_count integer not null check(item_count>=0),
  delivery_count integer not null default 0 check(delivery_count>=0),
  -- 발송 내용의 진실원. 재시도는 이 목록을 다시 읽어 같은 내용을 보낸다.
  items jsonb not null check(jsonb_typeof(items)='array')
);

create table private.stock_safety_digest_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  digest_date date not null references private.stock_safety_digest_runs(digest_date) on delete cascade,
  audience text not null check(audience in ('operator','origin')),
  -- 실행 기록이다. 출고지가 바뀌어도 그날 보낸 대상은 그대로 둔다.
  origin_id uuid,
  origin_name text,
  recipient text not null check(char_length(recipient) between 3 and 254),
  item_count integer not null check(item_count>0),
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
  unique(digest_date,recipient),
  check((audience='origin')=(origin_id is not null))
);
create index stock_safety_digest_jobs on private.stock_safety_digest_deliveries(available_at,id)
  where email_status in ('queued','processing','unknown');

alter table private.stock_safety_digest_settings enable row level security;
alter table private.stock_safety_digest_origin_recipients enable row level security;
alter table private.stock_safety_digest_runs enable row level security;
alter table private.stock_safety_digest_deliveries enable row level security;
revoke all on private.stock_safety_digest_settings,private.stock_safety_digest_origin_recipients,
  private.stock_safety_digest_runs,private.stock_safety_digest_deliveries from public,anon,authenticated,service_role;

-- 수신 주소: 앞뒤 공백 제거·소문자·중복 제거(처음 순서 유지). 형식이 틀리거나 상한을 넘으면 거절한다.
create function private.normalize_stock_digest_recipients(p_values text[],p_limit integer)
returns text[] language plpgsql immutable set search_path='' as $$
declare value text;normalized text[]:='{}'::text[];
begin
  if p_values is null then raise invalid_parameter_value using message='invalid_stock_digest_recipient';end if;
  foreach value in array p_values loop
    value:=lower(btrim(coalesce(value,''),E' \t\n\r\f\v'));
    if value='' then continue;end if;
    if char_length(value)>254 or value!~'^[^@[:space:][:cntrl:],;<>"]{1,64}@[^@[:space:][:cntrl:],;<>"]+\.[^@[:space:][:cntrl:],;<>".]+$' then
      raise invalid_parameter_value using message='invalid_stock_digest_recipient';
    end if;
    if not value=any(normalized) then normalized:=normalized||value;end if;
  end loop;
  if cardinality(normalized)>p_limit then raise invalid_parameter_value using message='stock_digest_recipient_limit';end if;
  return normalized;
end $$;
revoke all on function private.normalize_stock_digest_recipients(text[],integer) from public,anon,authenticated,service_role;

-- 지금 안전재고 기준 이하인 옵션. 보관 상품·판매 중지 상품·사용 중지 옵션은 뺀다.
create function private.stock_safety_digest_items()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('variantId',v.id,'goodId',g.id,'goodsCode',g.code,'goodsName',g.name,
      'optionName',v.name,'optionCode',v.code,'erpCode',e.erp_code,'erpName',e.erp_name,'barcode',e.barcode,
      'stockQty',v.stock_qty,'threshold',v.low_stock_threshold,'originId',g.origin_id,'originName',o.name)
    order by o.name nulls last,g.name,v.sort_order,v.id),'[]'::jsonb)
  from public.goods_variants v
  join public.goods g on g.id=v.good_id
  left join public.fulfillment_origins o on o.id=g.origin_id
  left join private.goods_variant_external_identity e on e.variant_id=v.id
  where v.archived_at is null and v.low_stock_threshold is not null and v.stock_qty<=v.low_stock_threshold
    and g.archived_at is null and g.stock<>'soldout';
$$;
revoke all on function private.stock_safety_digest_items() from public,anon,authenticated,service_role;

create function private.stock_safety_digest_document(p_now timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  with s as (select * from private.stock_safety_digest_settings where singleton),
  day as (select (p_now at time zone 'Asia/Seoul')::date as today),
  due as (select ((day.today+s.send_time) at time zone 'Asia/Seoul') as today_at,((day.today+1+s.send_time) at time zone 'Asia/Seoul') as next_at from s,day)
  select jsonb_build_object(
    'revision',s.revision,'enabled',s.enabled,'sendTime',to_char(s.send_time,'HH24:MI'),
    'operatorRecipients',to_jsonb(s.operator_recipients),'enabledAt',s.enabled_at,'updatedAt',s.updated_at,
    'updatedByName',updater.nickname,
    'nextSendAt',case when not s.enabled then null
      when exists(select 1 from private.stock_safety_digest_runs r,day where r.digest_date=day.today) then due.next_at
      when p_now>=due.today_at then p_now else due.today_at end,
    'lowStockCount',(select jsonb_array_length(private.stock_safety_digest_items())),
    'origins',coalesce((select jsonb_agg(jsonb_build_object('originId',o.id,'originCode',o.code,'originName',o.name,'active',o.is_active,
        'revision',coalesce(r.revision,0),'recipients',coalesce(to_jsonb(r.recipients),'[]'::jsonb)) order by o.is_active desc,o.name,o.id)
      from public.fulfillment_origins o left join private.stock_safety_digest_origin_recipients r on r.origin_id=o.id),'[]'::jsonb),
    'runs',coalesce((select jsonb_agg(jsonb_build_object('digestDate',run.digest_date,'createdAt',run.created_at,
        'itemCount',run.item_count,'deliveries',coalesce((select jsonb_agg(jsonb_build_object('audience',d.audience,
            'originName',d.origin_name,'recipient',d.recipient,'itemCount',d.item_count,'status',d.email_status,
            'errorCode',d.error_code,'attempts',d.attempts,'updatedAt',d.updated_at) order by d.audience desc,d.origin_name,d.recipient)
          from private.stock_safety_digest_deliveries d where d.digest_date=run.digest_date),'[]'::jsonb))
        order by run.digest_date desc)
      from (select * from private.stock_safety_digest_runs order by digest_date desc limit 7) run),'[]'::jsonb))
  from s cross join due left join public.profiles updater on updater.id=s.updated_by;
$$;
revoke all on function private.stock_safety_digest_document(timestamptz) from public,anon,authenticated,service_role;

create function public.admin_get_stock_safety_digest()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('platform.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
  return private.stock_safety_digest_document(clock_timestamp());
end $$;
revoke all on function public.admin_get_stock_safety_digest() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_stock_safety_digest() to authenticated;

create function public.admin_save_stock_safety_digest(p_enabled boolean,p_send_time text,p_operator_recipients text[],
  p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;previous private.stock_safety_digest_settings;recipients text[];request jsonb;receipt jsonb;at_value timestamptz;
begin
  actor:=private.require_operator_capability('platform.manage',false);
  if p_enabled is null or p_send_time is null or p_send_time!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null then
    raise invalid_parameter_value using message='invalid_stock_safety_digest';
  end if;
  recipients:=private.normalize_stock_digest_recipients(p_operator_recipients,10);
  request:=jsonb_build_object('enabled',p_enabled,'sendTime',p_send_time,'operatorRecipients',to_jsonb(recipients),
    'expectedRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('stock-safety-digest-operation:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.stock_safety_digest.settings',request);
  if receipt is not null then return receipt;end if;
  select * into previous from private.stock_safety_digest_settings where singleton for update;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='stock_safety_digest_changed';end if;
  at_value:=clock_timestamp();
  update private.stock_safety_digest_settings set revision=revision+1,enabled=p_enabled,send_time=p_send_time::time,
    operator_recipients=recipients,enabled_at=case when p_enabled and not previous.enabled then at_value
      when p_enabled then previous.enabled_at else null end,
    updated_by=actor,updated_at=at_value where singleton;
  receipt:=private.stock_safety_digest_document(at_value);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.stock_safety_digest.settings','stock_safety_digest',
    jsonb_build_object('request',request,'before',jsonb_build_object('enabled',previous.enabled,'sendTime',to_char(previous.send_time,'HH24:MI'),
      'operatorRecipients',to_jsonb(previous.operator_recipients)),'result',receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_stock_safety_digest(boolean,text,text[],bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_stock_safety_digest(boolean,text,text[],bigint,uuid) to authenticated;

-- 출고지 담당자 주소. 처음 저장할 때 기대 버전은 0이다.
create function public.admin_save_stock_safety_digest_origin(p_origin_id uuid,p_recipients text[],p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;previous private.stock_safety_digest_origin_recipients;recipients text[];request jsonb;receipt jsonb;at_value timestamptz;
begin
  actor:=private.require_operator_capability('platform.manage',false);
  if p_origin_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then
    raise invalid_parameter_value using message='invalid_stock_safety_digest_origin';
  end if;
  recipients:=private.normalize_stock_digest_recipients(p_recipients,5);
  request:=jsonb_build_object('originId',p_origin_id,'recipients',to_jsonb(recipients),'expectedRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended('stock-safety-digest-operation:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.stock_safety_digest.origin',request);
  if receipt is not null then return receipt;end if;
  perform 1 from public.fulfillment_origins where id=p_origin_id for share;
  if not found then raise no_data_found using message='fulfillment_origin_not_found';end if;
  perform pg_advisory_xact_lock(hashtextextended('stock-safety-digest-origin:'||p_origin_id::text,0));
  select * into previous from private.stock_safety_digest_origin_recipients where origin_id=p_origin_id for update;
  if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='stock_safety_digest_changed';end if;
  at_value:=clock_timestamp();
  insert into private.stock_safety_digest_origin_recipients(origin_id,revision,recipients,updated_by,updated_at)
    values(p_origin_id,1,recipients,actor,at_value)
    on conflict(origin_id) do update set revision=private.stock_safety_digest_origin_recipients.revision+1,
      recipients=excluded.recipients,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  receipt:=(select e.value from jsonb_array_elements(private.stock_safety_digest_document(at_value)->'origins') e
    where e.value->>'originId'=p_origin_id::text);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.stock_safety_digest.origin',
    'fulfillment_origin:'||p_origin_id,jsonb_build_object('request',request,
      'before',jsonb_build_object('recipients',coalesce(to_jsonb(previous.recipients),'[]'::jsonb)),'result',receipt));
  return receipt;
end $$;
revoke all on function public.admin_save_stock_safety_digest_origin(uuid,text[],bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_stock_safety_digest_origin(uuid,text[],bigint,uuid) to authenticated;

-- 그날 실행을 만든다. 켜져 있고 설정 시각(KST)이 지났고 그날 실행이 없을 때만. 대상 옵션이 없거나
-- 수신 주소가 없으면 발송 행 없이 실행만 남긴다(같은 날 다시 만들지 않는다).
create function private.prepare_stock_safety_digest(p_now timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s private.stock_safety_digest_settings;today date;due timestamptz;items jsonb;recipient text;origin record;
  delivered text[]:='{}'::text[];origin_count integer;deliveries integer:=0;
begin
  if p_now is null then raise invalid_parameter_value using message='invalid_stock_safety_digest_run';end if;
  select * into s from private.stock_safety_digest_settings where singleton;
  if not found or not s.enabled then return jsonb_build_object('status','disabled');end if;
  today:=(p_now at time zone 'Asia/Seoul')::date;
  due:=(today+s.send_time) at time zone 'Asia/Seoul';
  if p_now<due then return jsonb_build_object('status','before_time','dueAt',due);end if;
  if exists(select 1 from private.stock_safety_digest_runs where digest_date=today) then
    return jsonb_build_object('status','already_prepared','digestDate',today);
  end if;
  -- 동시 틱을 직렬화하고 설정 변경과 겹치지 않게 한다.
  perform pg_advisory_xact_lock(hashtextextended('stock-safety-digest-prepare',0));
  select * into s from private.stock_safety_digest_settings where singleton for share;
  if not s.enabled then return jsonb_build_object('status','disabled');end if;
  if exists(select 1 from private.stock_safety_digest_runs where digest_date=today) then
    return jsonb_build_object('status','already_prepared','digestDate',today);
  end if;
  items:=private.stock_safety_digest_items();
  insert into private.stock_safety_digest_runs(digest_date,settings_revision,send_time,item_count,items)
    values(today,s.revision,s.send_time,jsonb_array_length(items),items);
  if jsonb_array_length(items)>0 then
    foreach recipient in array s.operator_recipients loop
      insert into private.stock_safety_digest_deliveries(digest_date,audience,recipient,item_count)
        values(today,'operator',recipient,jsonb_array_length(items));
      delivered:=delivered||recipient;deliveries:=deliveries+1;
    end loop;
    for origin in select o.id,o.name,r.recipients from private.stock_safety_digest_origin_recipients r
      join public.fulfillment_origins o on o.id=r.origin_id where cardinality(r.recipients)>0 order by o.name,o.id loop
      select count(*) into origin_count from jsonb_array_elements(items) i where i->>'originId'=origin.id::text;
      if origin_count=0 then continue;end if;
      foreach recipient in array origin.recipients loop
        if recipient=any(delivered) then continue;end if;
        insert into private.stock_safety_digest_deliveries(digest_date,audience,origin_id,origin_name,recipient,item_count)
          values(today,'origin',origin.id,origin.name,recipient,origin_count);
        delivered:=delivered||recipient;deliveries:=deliveries+1;
      end loop;
    end loop;
  end if;
  update private.stock_safety_digest_runs set delivery_count=deliveries where digest_date=today;
  insert into public.audit_log(actor_id,action,target,diff) values(null,'system.stock_safety_digest.prepared','stock_safety_digest:'||today,
    jsonb_build_object('digestDate',today,'settingsRevision',s.revision,'items',jsonb_array_length(items),'deliveries',deliveries));
  return jsonb_build_object('status','prepared','digestDate',today,'items',jsonb_array_length(items),'deliveries',deliveries);
end $$;
revoke all on function private.prepare_stock_safety_digest(timestamptz) from public,anon,authenticated,service_role;

-- 메일 한 통에 싣는 옵션 상한. 넘치면 본문이 '외 N개'로 끝난다.
create function private.stock_safety_digest_job_items(p_digest_date date,p_origin_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(i order by ordinal),'[]'::jsonb) from (
    select i,ordinal from private.stock_safety_digest_runs r,jsonb_array_elements(r.items) with ordinality as e(i,ordinal)
    where r.digest_date=p_digest_date and (p_origin_id is null or i->>'originId'=p_origin_id::text)
    order by ordinal limit 300) picked;
$$;
revoke all on function private.stock_safety_digest_job_items(date,uuid) from public,anon,authenticated,service_role;

create function public.claim_stock_safety_digest_jobs(batch_limit integer default 25)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  if batch_limit is null or batch_limit not between 1 and 25 then raise invalid_parameter_value using message='invalid_stock_digest_batch';end if;
  perform private.prepare_stock_safety_digest(clock_timestamp());
  -- 꺼져 있으면 새로 선점하지 않는다. 하루가 지난 대기 요약은 보내지 않는다(다음 날 요약이 대신한다).
  -- 결과 불명(unknown)은 공급사가 받았을 수 있어 만료시키지 않고 dispatcher의 24시간 검토 경계를 따른다.
  if not coalesce((select enabled from private.stock_safety_digest_settings where singleton),false) then return '[]'::jsonb;end if;
  update private.stock_safety_digest_deliveries d set email_status='failed',error_code='digest_expired',retryable=false,
    available_at=null,lease_until=null,claim_token=null,updated_at=clock_timestamp()
    from private.stock_safety_digest_runs r
    where r.digest_date=d.digest_date and d.email_status='queued' and r.created_at<clock_timestamp()-interval '20 hours';
  update private.stock_safety_digest_deliveries set email_status='unknown',error_code='delivery_needs_review',retryable=false,
    available_at=null,lease_until=null,claim_token=null,updated_at=clock_timestamp()
    where email_status in ('queued','processing','unknown') and attempts>=100 and (lease_until is null or lease_until<clock_timestamp());
  with selected as (
    select d.id from private.stock_safety_digest_deliveries d
    where d.attempts<100 and ((d.email_status in ('queued','unknown') and d.available_at<=clock_timestamp())
      or (d.email_status='processing' and d.lease_until<clock_timestamp()))
    order by d.available_at nulls last,d.id for update skip locked limit batch_limit
  ), claimed as (
    update private.stock_safety_digest_deliveries d set email_status='processing',claim_token=extensions.gen_random_uuid(),
      lease_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,updated_at=clock_timestamp()
    from selected where d.id=selected.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claimToken',c.claim_token,'audience',c.audience,'originName',c.origin_name,
      'digestDate',c.digest_date,'recipient',c.recipient,'itemCount',c.item_count,
      'items',private.stock_safety_digest_job_items(c.digest_date,c.origin_id)) order by c.id),'[]'::jsonb)
    into result from claimed c;
  return result;
end $$;

create function public.bind_stock_safety_digest_intent(target_id uuid,target_claim uuid,target_intent uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare d private.stock_safety_digest_deliveries%rowtype;i private.email_intents%rowtype;
begin
  select * into d from private.stock_safety_digest_deliveries where id=target_id for update;
  if not found or d.email_status<>'processing' or d.claim_token is distinct from target_claim or d.lease_until<=clock_timestamp() then return false;end if;
  select * into i from private.email_intents where id=target_intent for update;
  if not found or i.source<>'stock_safety_digest' or i.message_kind<>'stock_safety_digest' or i.content_revision<>'stock_safety_digest_v1'
    or (d.email_intent_id is not null and d.email_intent_id<>i.id) then raise check_violation using message='stock_digest_intent_mismatch';end if;
  update private.stock_safety_digest_deliveries set email_intent_id=i.id where id=d.id;
  return true;
end $$;

create function public.finish_stock_safety_digest_job(target_id uuid,target_claim uuid,target_status text,target_error text,target_retryable boolean)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare d private.stock_safety_digest_deliveries%rowtype;i private.email_intents%rowtype;status text:=target_status;code text:=target_error;can_retry boolean:=target_retryable;
begin
  if target_status is null or target_status not in ('sent','queued','failed','unknown','suppressed') or target_retryable is null
    or target_error is not null and target_error not in ('provider_suppressed','provider_rejected','delivery_disabled','delivery_in_progress',
      'delivery_needs_review','delivery_outcome_unknown','provider_retryable','provider_not_configured')
  then raise invalid_parameter_value using message='invalid_stock_digest_result';end if;
  select * into d from private.stock_safety_digest_deliveries where id=target_id for update;
  if not found or d.email_status<>'processing' or d.claim_token is distinct from target_claim then return false;end if;
  select * into i from private.email_intents where id=d.email_intent_id for update;
  -- 공급사 수락이 커밋됐으면 응답 유실과 무관하게 그 결과가 이긴다.
  if i.state in ('accepted','sent','delivered','delayed') then status:='sent';code:=null;can_retry:=false;
  elsif i.state in ('bounced','complained','failed') then status:='failed';code:='provider_rejected';can_retry:=false;
  elsif i.state='suppressed' then status:='suppressed';code:='provider_suppressed';can_retry:=false;
  elsif i.state='needs_review' then status:='unknown';code:='delivery_needs_review';can_retry:=false;
  elsif status='sent' then raise check_violation using message='stock_digest_acceptance_required';
  end if;
  if status='failed' and can_retry then
    -- 재시도 가능한 실패(공급사 일시 오류·발송 설정 대기)는 10분 뒤 다시 줄을 선다. 하루가 지나면 선점 단계가 만료시킨다.
    update private.stock_safety_digest_deliveries set email_status='queued',error_code=code,retryable=true,
      available_at=clock_timestamp()+interval '10 minutes',claim_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=d.id;
  else
    update private.stock_safety_digest_deliveries set email_status=status,error_code=code,retryable=false,
      available_at=case when status='queued' or (status='unknown' and code='delivery_outcome_unknown')
        then clock_timestamp()+interval '2 minutes' end,
      claim_token=null,lease_until=null,updated_at=clock_timestamp()
      where id=d.id;
  end if;
  return true;
end $$;

revoke all on function public.claim_stock_safety_digest_jobs(integer),public.bind_stock_safety_digest_intent(uuid,uuid,uuid),
  public.finish_stock_safety_digest_job(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_stock_safety_digest_jobs(integer),public.bind_stock_safety_digest_intent(uuid,uuid,uuid),
  public.finish_stock_safety_digest_job(uuid,uuid,text,text,boolean) to service_role;

-- #191 dispatcher에 새 출처를 더한다. 다른 출처 목록이 늘어 있어도 끝에 덧붙이고, 앵커가 정확히 한 번
-- 나오지 않으면 실패한다(조용히 덮어쓰지 않는다).
do $$
declare spec record;definition text;anchor text:='''::text])';
begin
  for spec in select * from (values
    ('private.email_intents','email_intents_source_check'),
    ('private.email_intents','email_intents_message_kind_check'),
    ('private.email_intent_fences','email_intent_fences_source_check')) supplied(table_name,constraint_name) loop
    select pg_get_constraintdef(c.oid) into definition from pg_constraint c
      where c.conrelid=spec.table_name::regclass and c.conname=spec.constraint_name;
    if definition is null or position('stock_safety_digest' in definition)>0
      or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'stock digest email constraint changed: %',spec.constraint_name;
    end if;
    execute format('alter table %s drop constraint %I',spec.table_name,spec.constraint_name);
    execute format('alter table %s add constraint %I %s',spec.table_name,spec.constraint_name,
      replace(definition,anchor,'''::text, ''stock_safety_digest''::text])'));
  end loop;
end $$;

do $patch$
declare target record;definition text;patch record;
begin
  for target in select * from (values
    ('public.enqueue_email_intent(text,text,text,text,text)'),
    ('public.claim_email_intent_dispatch(uuid,text)')) supplied(signature) loop
    definition:=pg_get_functiondef(target.signature::regprocedure);
    for patch in select * from (values
      ('public.enqueue_email_intent(text,text,text,text,text)','source_list',
        $old$) then raise check_violation using message='invalid_email_source'$old$,
        $new$,'stock_safety_digest') then raise check_violation using message='invalid_email_source'$new$),
      ('public.enqueue_email_intent(text,text,text,text,text)','kind_list',
        E')\n then raise check_violation using message=''invalid_email_message_kind''',
        E',''stock_safety_digest'')\n then raise check_violation using message=''invalid_email_message_kind'''),
      ('public.enqueue_email_intent(text,text,text,text,text)','kind_pair',
        ' if target_content_revision is null',
        E' if (target_source=''stock_safety_digest'') is distinct from (target_message_kind=''stock_safety_digest'') then raise check_violation using message=''invalid_email_message_kind'';end if;\n if target_content_revision is null'),
      -- 주문 지연 안내와 같은 방식의 전용 gate: 안전재고 요약 메일 설정의 '사용'.
      ('public.claim_email_intent_dispatch(uuid,text)','digest_gate',
        ' else v_control.enabled end',
        ' when v_intent.source=''stock_safety_digest'' then coalesce((select d.enabled from private.stock_safety_digest_settings d where d.singleton),false) else v_control.enabled end')
    ) supplied(signature,name,old_text,new_text) where supplied.signature=target.signature loop
      if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>1 then
        raise exception 'stock digest dispatcher anchor changed: %',patch.name;
      end if;
      definition:=replace(definition,patch.old_text,patch.new_text);
    end loop;
    execute definition;
  end loop;
end $patch$;
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

select private.register_operator_rpc_contract('public.admin_get_stock_safety_digest()'::regprocedure,'platform.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_stock_safety_digest(boolean,text,text[],bigint,uuid)'::regprocedure,'platform.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_stock_safety_digest_origin(uuid,text[],bigint,uuid)'::regprocedure,'platform.manage','write',false);

commit;
notify pgrst,'reload schema';
