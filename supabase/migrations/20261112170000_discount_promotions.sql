-- 1014-109·110·X37 할인 프로모션 묶음(사용자 2026-11-11 결정 "할인 프로모션 묶음", '한두 개'는 "그 상품만 다른 율").
--
-- 이름·기간·대상(기획전(캠페인) 상품·IP·선택 상품)·일괄 할인·상품별 예외(율·금액·예외가·제외)를 한 번에 건다.
-- 결과는 새 가격층이 아니라 기존 옵션 기간할인 원장(private.goods_variant_price_periods)에 출처(promotion_id)와 함께
-- 쓴다. resolver(private.resolve_goods_variant_price)·겹침 금지 가드(private.guard_goods_price_period)·견적·주문 계산은
-- 그대로라 가격 계산 순서(ADR-0021)가 바뀌지 않는다 — 한 옵션·한 시점에 할인가는 하나다. 기간이 겹치는 활성 할인이 있는
-- 상품은 미리보기에서 건너뛰기로 고정하고 이유를 보인다(일괄 즉시할인과 같은 판정).
-- 중지는 그 프로모션이 만든 진행·예정 할인(promotion_id)만 끈다. 개별로 건 할인(promotion_id null)은 그대로다.
-- 미리보기 → 확정은 일괄 변경(goods_bulk)과 같은 계약이다: 운영자·세션 결속, 15분 유효, 확정 직전 가격 지문 재검사,
-- 같은 요청번호의 영수증 재생(멱등), 실패도 영수증으로 남겨 불명확한 응답을 재실행하지 않는다.
begin;

-- 1. 원장 -----------------------------------------------------------------------------------------------------------
create table private.discount_promotions (
  id uuid primary key,
  name text not null check (name=btrim(name) and char_length(name) between 1 and 60),
  state text not null default 'active' check (state in ('active','stopped')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  target_kind text not null check (target_kind in ('campaign','ip','goods')),
  target_ids text[] not null check (cardinality(target_ids) between 1 and 1000),
  -- 확정 시점의 기획전 제목·IP 이름. 이후 이름이 바뀌어도 이 묶음이 무엇이었는지 읽힌다.
  target_label text check (target_label is null or char_length(target_label) between 1 and 200),
  default_rule jsonb not null,
  request jsonb not null,
  goods_count integer not null check (goods_count between 1 and 1000),
  applied_count integer not null,
  revision integer not null default 1 check (revision>0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  stopped_by uuid references public.profiles(id),
  stopped_at timestamptz,
  stop_operation_id uuid,
  stop_receipt jsonb,
  check (starts_at<ends_at),
  check (applied_count between 1 and goods_count),
  check ((state='stopped')=(stopped_by is not null and stopped_at is not null and stop_operation_id is not null and stop_receipt is not null))
);
alter table private.discount_promotions enable row level security;
revoke all on table private.discount_promotions from public,anon,authenticated,service_role;
create index discount_promotions_created_idx on private.discount_promotions(created_at desc,id);
create index discount_promotions_campaign_idx on private.discount_promotions((target_ids[1])) where target_kind='campaign';

-- 대상 상품 한 줄 = 그 상품에 건 규칙(일괄/예외)과 건너뛴 이유. 할인을 실제로 건 상품은 기간할인 원장이 진실원이다.
create table private.discount_promotion_goods (
  promotion_id uuid not null references private.discount_promotions(id),
  good_id text not null references public.goods(id) on update cascade on delete cascade,
  position integer not null check (position between 1 and 1000),
  name text not null,
  code text,
  rule jsonb not null,
  skip_reason text check (skip_reason is null or skip_reason ~ '^[a-z][a-z0-9_]{0,100}$'),
  primary key (promotion_id,good_id)
);
alter table private.discount_promotion_goods enable row level security;
revoke all on table private.discount_promotion_goods from public,anon,authenticated,service_role;

create table private.discount_promotion_operations (
  id uuid primary key,
  actor_id uuid not null,
  session_id uuid not null,
  request jsonb not null,
  guards jsonb not null,
  preview jsonb not null,
  receipt jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);
alter table private.discount_promotion_operations enable row level security;
revoke all on table private.discount_promotion_operations from public,anon,authenticated,service_role;

-- 출처. null은 상품 수정·일괄 즉시할인처럼 개별로 건 할인이다. 한 번 정해진 출처는 바꾸지 않는다.
alter table private.goods_variant_price_periods add column promotion_id uuid references private.discount_promotions(id);
create index goods_variant_price_periods_promotion_idx on private.goods_variant_price_periods(promotion_id,good_id) where promotion_id is not null;

create function private.guard_goods_price_period_promotion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  raise check_violation using message='price_period_identity_immutable';
end $$;
revoke all on function private.guard_goods_price_period_promotion() from public,anon,authenticated,service_role;
create trigger goods_price_period_promotion_guard before update on private.goods_variant_price_periods
  for each row when (new.promotion_id is distinct from old.promotion_id) execute function private.guard_goods_price_period_promotion();

-- 2. 요청 검증·가격 계산 -----------------------------------------------------------------------------------------------
create function private.discount_promotion_validate(p_request jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare kind text; ids jsonb; rule jsonb; starts timestamptz; ends timestamptz; item jsonb; id_pattern text;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or not p_request ?& array['name','startsAt','endsAt','target','rule','exceptions'] or (select count(*) from jsonb_object_keys(p_request))<>6
    or jsonb_typeof(p_request->'name') is distinct from 'string' or p_request->>'name'<>btrim(p_request->>'name')
    or char_length(p_request->>'name') not between 1 and 60 or p_request->>'name' ~ '[[:cntrl:]]'
    or jsonb_typeof(p_request->'target') is distinct from 'object'
    or not (p_request->'target') ?& array['kind','ids'] or (select count(*) from jsonb_object_keys(p_request->'target'))<>2
    or jsonb_typeof(p_request#>'{target,kind}') is distinct from 'string' or p_request#>>'{target,kind}' not in ('campaign','ip','goods')
    or jsonb_typeof(p_request#>'{target,ids}') is distinct from 'array'
    or jsonb_typeof(p_request->'rule') is distinct from 'object' or jsonb_typeof(p_request->'exceptions') is distinct from 'array'
    or jsonb_typeof(p_request->'startsAt') is distinct from 'string' or jsonb_typeof(p_request->'endsAt') is distinct from 'string'
    or p_request->>'startsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' or p_request->>'endsAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise invalid_parameter_value using message='discount_promotion_invalid';
  end if;
  kind:=p_request#>>'{target,kind}'; ids:=p_request#>'{target,ids}';
  id_pattern:=case kind when 'campaign' then '^[a-z0-9][a-z0-9-]{1,63}$' when 'ip' then '^[a-z0-9][a-z0-9-]{0,99}$' else '^[a-z0-9][a-z0-9-]{0,63}$' end;
  if (kind in ('campaign','ip') and jsonb_array_length(ids)<>1) or (kind='goods' and jsonb_array_length(ids) not between 1 and 1000)
    or exists(select 1 from jsonb_array_elements(ids) value where jsonb_typeof(value)<>'string' or value#>>'{}' !~ id_pattern)
    or (select count(distinct value) from jsonb_array_elements(ids) value)<>jsonb_array_length(ids) then
    raise invalid_parameter_value using message='discount_promotion_invalid';
  end if;
  begin
    starts:=(p_request->>'startsAt')::timestamptz; ends:=(p_request->>'endsAt')::timestamptz;
  exception when others then raise invalid_parameter_value using message='discount_promotion_invalid';
  end;
  if not isfinite(starts) or not isfinite(ends) or starts>=ends then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  -- 일괄 규칙은 율·금액만, 예외는 율·금액·예외가(기준 판매가의 할인 후 가격)·제외를 받는다.
  rule:=p_request->'rule';
  if not rule ?& array['mode','value'] or (select count(*) from jsonb_object_keys(rule))<>2
    or jsonb_typeof(rule->'mode') is distinct from 'string' or rule->>'mode' not in ('rate','amount')
    or jsonb_typeof(rule->'value') is distinct from 'number' or rule->>'value' !~ '^[1-9][0-9]*$' or (rule->>'value')::numeric>2147483647
    or (rule->>'mode'='rate' and (rule->>'value')::numeric>=100) then
    raise invalid_parameter_value using message='discount_promotion_invalid';
  end if;
  if jsonb_array_length(p_request->'exceptions')>1000 then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  for item in select value from jsonb_array_elements(p_request->'exceptions') loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'goodId') is distinct from 'string'
      or item->>'goodId' !~ '^[a-z0-9][a-z0-9-]{0,63}$' or jsonb_typeof(item->'mode') is distinct from 'string'
      or item->>'mode' not in ('rate','amount','price','exclude')
      or (item->>'mode'='exclude' and ((select count(*) from jsonb_object_keys(item))<>2 or not item ?& array['goodId','mode']))
      or (item->>'mode'<>'exclude' and ((select count(*) from jsonb_object_keys(item))<>3 or not item ?& array['goodId','mode','value']
        or jsonb_typeof(item->'value') is distinct from 'number' or item->>'value' !~ '^[1-9][0-9]*$' or (item->>'value')::numeric>2147483647
        or (item->>'mode'='rate' and (item->>'value')::numeric>=100))) then
      raise invalid_parameter_value using message='discount_promotion_invalid';
    end if;
  end loop;
  if (select count(distinct value->>'goodId') from jsonb_array_elements(p_request->'exceptions') value)<>jsonb_array_length(p_request->'exceptions') then
    raise invalid_parameter_value using message='discount_promotion_invalid';
  end if;
end $$;

-- 옵션 하나의 할인가. 할인가가 1원 미만이거나 그 옵션 판매가 이상이면 null(그 상품은 건너뛴다).
-- 율·금액은 일괄 즉시할인과 같은 계산(private.goods_bulk_discount_price)이다. 예외가는 기준 판매가(goods.price)를 그 값으로
-- 내리는 할인 금액을 모든 옵션에 같게 뺀다 — 옵션 추가금에는 할인을 붙이지 않는 상품 할인 규칙과 같은 모양이다.
create function private.discount_promotion_price(p_good_price integer,p_variant_price integer,p_rule jsonb) returns integer
language plpgsql immutable set search_path='' as $$
declare amount bigint;
begin
  if p_rule->>'mode' in ('rate','amount') then
    return private.goods_bulk_discount_price(p_variant_price,jsonb_build_object('mode',p_rule->>'mode','value',p_rule->'value'));
  elsif p_rule->>'mode'='price' then
    amount:=p_good_price::bigint-(p_rule->>'value')::bigint;
    if amount<1 then return null; end if;
    return private.goods_bulk_discount_price(p_variant_price,jsonb_build_object('mode','amount','value',amount));
  end if;
  return null;
end $$;

-- 프로모션이 만든 기간할인 한 행. 원장 트리거(겹침·정상가·랜덤 판매 조건)를 그대로 지나고, 상품 기록에는 개별 저장과
-- 같은 감사 행을 남긴다(출처는 after.promotion_id로 읽힌다).
create function private.insert_discount_promotion_period(p_promotion_id uuid,p_good_id text,p_variant_id uuid,p_discount_price integer,
  p_starts timestamptz,p_ends timestamptz,p_actor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare variant public.goods_variants; saved private.goods_variant_price_periods;
begin
  perform 1 from public.goods where id=p_good_id for update;
  select * into variant from public.goods_variants where id=p_variant_id and good_id=p_good_id for update;
  if not found then raise check_violation using message='goods_variant_not_found'; end if;
  insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by,promotion_id)
  values(p_good_id,p_variant_id,'active',variant.price,p_discount_price,p_starts,p_ends,p_actor,p_actor,p_promotion_id)
  returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'admin.good.price_period_saved','goods:'||p_good_id,
    jsonb_build_object('before',null,'after',to_jsonb(saved)));
  return saved.id;
end $$;

-- 목록·상세가 같은 요약을 쓴다. 상태 이름(예정·진행·종료)은 화면이 기간과 조회 시각으로 정한다.
create function private.discount_promotion_summary(p_promotion private.discount_promotions) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p_promotion.id,'name',p_promotion.name,'state',p_promotion.state,
    'startsAt',p_promotion.starts_at,'endsAt',p_promotion.ends_at,
    'target',jsonb_build_object('kind',p_promotion.target_kind,'id',case when p_promotion.target_kind<>'goods' then p_promotion.target_ids[1] end,
      'label',p_promotion.target_label),
    'rule',p_promotion.default_rule,'goodsCount',p_promotion.goods_count,'appliedCount',p_promotion.applied_count,
    'exceptionCount',(select count(*) from private.discount_promotion_goods line where line.promotion_id=p_promotion.id and line.rule->>'source'='exception'),
    'discounts',(select jsonb_build_object(
        'active',count(*) filter (where period.state='active' and period.ends_at>statement_timestamp()),
        'ended',count(*) filter (where period.state='active' and period.ends_at<=statement_timestamp()),
        'disabled',count(*) filter (where period.state='disabled'))
      from private.goods_variant_price_periods period where period.promotion_id=p_promotion.id),
    'revision',p_promotion.revision,'createdAt',p_promotion.created_at,
    'createdByName',(select nickname from public.profiles where id=p_promotion.created_by),
    'stoppedAt',p_promotion.stopped_at,'stoppedByName',(select nickname from public.profiles where id=p_promotion.stopped_by));
$$;

-- 3. 미리보기·확정·결과 조회 -------------------------------------------------------------------------------------------
create function public.admin_preview_discount_promotion(p_id uuid,p_request jsonb,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.discount_promotion_operations; kind text; target_ids text[]; ids text[]; label text; g public.goods;
  rows jsonb:='[]'; guards jsonb:='{}'; applied integer:=0; window_range tstzrange; rule jsonb; skip text; overlap jsonb;
  min_price integer; max_price integer; next_min integer; next_max integer; expires timestamptz; result jsonb;
begin
  perform private.require_goods_group_identity(p_actor,p_session);
  perform private.discount_promotion_validate(p_request);
  if p_id is null then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('discount-promotion:'||p_id::text,0));
  select * into prior from private.discount_promotion_operations where id=p_id;
  if found then
    if prior.actor_id<>p_actor or prior.session_id<>p_session or prior.request<>p_request then
      raise sqlstate 'PT409' using message='discount_promotion_operation_conflict';
    end if;
    if prior.receipt is not null or prior.expires_at<=clock_timestamp() then
      raise sqlstate 'PT409' using message='discount_promotion_preview_expired';
    end if;
    return prior.preview;
  end if;
  if (p_request->>'endsAt')::timestamptz<=clock_timestamp() then raise check_violation using message='discount_promotion_period_ended'; end if;
  kind:=p_request#>>'{target,kind}';
  target_ids:=array(select value from jsonb_array_elements_text(p_request#>'{target,ids}') with ordinality item(value,ordinality) order by ordinality);
  if kind='campaign' then
    select title into label from public.campaigns where id=target_ids[1];
    if not found then raise check_violation using message='discount_promotion_campaign_unavailable'; end if;
    -- 기획전 본문의 굿즈 블록 순서대로, 처음 나온 자리를 쓴다. 지금 없는 상품 ID는 대상이 아니다.
    ids:=array(select entry.good_id from (
        select item.value good_id,min(section.ordinality*100+item.ordinality) first_seen
        from public.campaigns campaign
        cross join lateral jsonb_array_elements(campaign.sections) with ordinality section(value,ordinality)
        cross join lateral jsonb_array_elements_text(case when section.value->>'type'='goods' and jsonb_typeof(section.value->'good_ids')='array'
          then section.value->'good_ids' else '[]'::jsonb end) with ordinality item(value,ordinality)
        where campaign.id=target_ids[1] and exists(select 1 from public.goods where id=item.value)
        group by item.value) entry order by entry.first_seen,entry.good_id);
  elsif kind='ip' then
    select title into label from public.ips where id=target_ids[1] and archived_at is null;
    if not found then raise check_violation using message='discount_promotion_ip_unavailable'; end if;
    ids:=array(select id from public.goods where ip_id=target_ids[1] and archived_at is null order by id);
  else
    ids:=target_ids;
    if (select count(*) from public.goods where id=any(ids))<>cardinality(ids) then
      raise check_violation using message='discount_promotion_good_unavailable';
    end if;
  end if;
  if coalesce(cardinality(ids),0)=0 then raise check_violation using message='discount_promotion_no_goods'; end if;
  if cardinality(ids)>1000 then raise check_violation using message='discount_promotion_target_limit'; end if;
  if exists(select 1 from jsonb_array_elements(p_request->'exceptions') item where not (item->>'goodId'=any(ids))) then
    raise check_violation using message='discount_promotion_exception_outside_target';
  end if;
  window_range:=tstzrange((p_request->>'startsAt')::timestamptz,(p_request->>'endsAt')::timestamptz,'[)');
  -- 요약과 지문을 같은 시점에 고정한다(일괄 변경과 같은 잠금). 판매로 인한 재고 변동은 지문에 들지 않는다.
  begin
    perform 1 from public.goods where id=any(ids) order by id for share nowait;
    perform 1 from public.goods_variants where good_id=any(ids) order by id for share nowait;
  exception when lock_not_available then raise sqlstate 'PT409' using message='discount_promotion_busy';
  end;
  for g in select goods.* from unnest(ids) with ordinality target(id,ordinality) join public.goods goods on goods.id=target.id order by target.ordinality loop
    rule:=coalesce(
      (select jsonb_build_object('source','exception','mode',item->>'mode','value',item->'value')
        from jsonb_array_elements(p_request->'exceptions') item where item->>'goodId'=g.id),
      jsonb_build_object('source','default','mode',p_request#>>'{rule,mode}','value',p_request#>'{rule,value}'));
    select min(price),max(price) into min_price,max_price from public.goods_variants where good_id=g.id and archived_at is null;
    skip:=null; overlap:=null; next_min:=null; next_max:=null;
    if rule->>'mode'='exclude' then skip:='discount_promotion_excluded';
    elsif g.archived_at is not null then skip:='good_archived';
    elsif min_price is null then skip:='price_period_variant_inactive';
    else
      select jsonb_build_object('promotionId',period.promotion_id,'promotionName',promotion.name,'startsAt',period.starts_at,'endsAt',period.ends_at)
        into overlap
      from public.goods_variants variant
      join private.goods_variant_price_periods period on period.variant_id=variant.id and period.good_id=variant.good_id
      left join private.discount_promotions promotion on promotion.id=period.promotion_id
      where variant.good_id=g.id and variant.archived_at is null and period.state='active'
        and tstzrange(period.starts_at,period.ends_at,'[)') && window_range
      order by period.starts_at,period.id limit 1;
      if overlap is not null then skip:='price_period_overlap';
      elsif exists(select 1 from public.goods_variants variant where variant.good_id=g.id and variant.archived_at is null
          and private.discount_promotion_price(g.price,variant.price,rule) is null) then skip:='goods_bulk_price_invalid';
      else
        select min(private.discount_promotion_price(g.price,variant.price,rule)),max(private.discount_promotion_price(g.price,variant.price,rule))
          into next_min,next_max from public.goods_variants variant where variant.good_id=g.id and variant.archived_at is null;
      end if;
    end if;
    if skip is null then
      applied:=applied+1;
      guards:=guards||jsonb_build_object(g.id,private.goods_bulk_price_fingerprint(g.id));
    end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('id',g.id,'name',g.name,'code',g.code,'price',g.price,
      'priceMin',min_price,'priceMax',max_price,'nextMin',next_min,'nextMax',next_max,
      'published',g.published_at is not null,'archived',g.archived_at is not null,'rule',rule,'skip',skip,'overlap',overlap));
  end loop;
  if applied=0 then raise check_violation using message='discount_promotion_all_skipped'; end if;
  expires:=clock_timestamp()+interval '15 minutes';
  result:=jsonb_build_object('state','ready','operationId',p_id,'request',p_request,
    'target',jsonb_build_object('kind',kind,'ids',to_jsonb(target_ids),'label',label),'goods',rows,'expiresAt',expires);
  insert into private.discount_promotion_operations(id,actor_id,session_id,request,guards,preview,expires_at)
  values(p_id,p_actor,p_session,p_request,guards,result,expires);
  return result;
end $$;

create function public.admin_commit_discount_promotion(p_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation private.discount_promotion_operations; applied_ids text[]; id_value text; line jsonb; g public.goods;
  variant public.goods_variants; starts timestamptz; ends timestamptz; period_count integer:=0; skipped jsonb; result jsonb; failure text;
begin
  perform private.require_goods_group_identity(p_actor,p_session);
  if p_id is null then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('discount-promotion:'||p_id::text,0));
  select * into operation from private.discount_promotion_operations where id=p_id for update;
  if not found or operation.actor_id<>p_actor or operation.session_id<>p_session then
    raise insufficient_privilege using message='discount_promotion_operation_unavailable';
  end if;
  if operation.receipt is not null then return operation.receipt; end if;
  starts:=(operation.request->>'startsAt')::timestamptz; ends:=(operation.request->>'endsAt')::timestamptz;
  applied_ids:=array(select key from jsonb_object_keys(operation.guards) key order by key);
  select coalesce(jsonb_agg(jsonb_build_object('id',item->>'id','name',item->>'name','code',item->'code','reason',item->>'skip') order by ordinality),'[]'::jsonb)
    into skipped from jsonb_array_elements(operation.preview->'goods') with ordinality goods(item,ordinality) where nullif(item->>'skip','') is not null;
  begin
    foreach id_value in array applied_ids loop
      if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||id_value,0)) then
        raise sqlstate 'PT409' using message='discount_promotion_busy';
      end if;
    end loop;
    begin
      perform 1 from public.goods where id=any(applied_ids) order by id for update nowait;
      perform 1 from public.goods_variants where good_id=any(applied_ids) order by id for update nowait;
      perform 1 from private.goods_variant_price_periods where good_id=any(applied_ids) order by id for update nowait;
    exception when lock_not_available then raise sqlstate 'PT409' using message='discount_promotion_busy';
    end;
    -- 잠근 뒤 다시 본다: 유효기간, 그리고 옵션 가격·옵션 구성·기간할인이 비교 이후 바뀌었는지(재고 변동은 보지 않는다).
    if operation.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='discount_promotion_preview_expired'; end if;
    if exists(select 1 from unnest(applied_ids) id where private.goods_bulk_price_fingerprint(id) is distinct from operation.guards->>id) then
      raise sqlstate 'PT409' using message='discount_promotion_changed';
    end if;
    if ends<=clock_timestamp() then raise check_violation using message='discount_promotion_period_ended'; end if;
    insert into private.discount_promotions(id,name,state,starts_at,ends_at,target_kind,target_ids,target_label,default_rule,request,
      goods_count,applied_count,created_by)
    values(p_id,operation.request->>'name','active',starts,ends,operation.preview#>>'{target,kind}',
      array(select value from jsonb_array_elements_text(operation.preview#>'{target,ids}') with ordinality item(value,ordinality) order by ordinality),
      operation.preview#>>'{target,label}',operation.request->'rule',operation.request,
      jsonb_array_length(operation.preview->'goods'),cardinality(applied_ids),p_actor);
    insert into private.discount_promotion_goods(promotion_id,good_id,position,name,code,rule,skip_reason)
    select p_id,item->>'id',ordinality,item->>'name',item->>'code',item->'rule',nullif(item->>'skip','')
    from jsonb_array_elements(operation.preview->'goods') with ordinality goods(item,ordinality);
    for line in select item from jsonb_array_elements(operation.preview->'goods') with ordinality goods(item,ordinality)
      where nullif(item->>'skip','') is null order by ordinality loop
      select * into g from public.goods where id=line->>'id';
      for variant in select * from public.goods_variants where good_id=g.id and archived_at is null order by id loop
        perform private.insert_discount_promotion_period(p_id,g.id,variant.id,private.discount_promotion_price(g.price,variant.price,line->'rule'),
          starts,ends,p_actor);
        period_count:=period_count+1;
      end loop;
    end loop;
    result:=jsonb_build_object('state','completed','operationId',p_id,'promotionId',p_id,'goodsCount',cardinality(applied_ids),
      'periodCount',period_count,'skipped',skipped,'error',null);
    insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'catalog.discount_promotion.created','discount_promotion:'||p_id::text,
      jsonb_build_object('request',operation.request,'preview',operation.preview,'receipt',result));
  exception when others then
    -- 하위 트랜잭션이 프로모션·기간할인·감사 행을 모두 되돌린다. 거절도 영수증으로 남겨 불명확한 응답을 재실행하지 않는다.
    get stacked diagnostics failure=message_text;
    result:=jsonb_build_object('state','rejected','operationId',p_id,'promotionId',null,'goodsCount',0,'periodCount',0,'skipped','[]'::jsonb,
      'error',case when failure ~ '^[a-z][a-z0-9_]{0,100}$' then failure else 'discount_promotion_rejected' end);
  end;
  update private.discount_promotion_operations set receipt=result where id=p_id;
  return result;
end $$;

create function public.admin_read_discount_promotion_operation(p_id uuid,p_actor uuid,p_session uuid,p_seal boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation private.discount_promotion_operations; result jsonb;
begin
  perform private.require_goods_group_identity(p_actor,p_session);
  if p_id is null or p_seal is null then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('discount-promotion:'||p_id::text,0));
  select * into operation from private.discount_promotion_operations where id=p_id for update;
  if not found or operation.actor_id<>p_actor or operation.session_id<>p_session then
    raise insufficient_privilege using message='discount_promotion_operation_unavailable';
  end if;
  if operation.receipt is not null then return operation.receipt; end if;
  result:=jsonb_build_object('state',case when p_seal then 'sealed' else 'unresolved' end,'operationId',p_id,'promotionId',null,
    'goodsCount',0,'periodCount',0,'skipped','[]'::jsonb,'error',null);
  if p_seal then update private.discount_promotion_operations set receipt=result where id=p_id; end if;
  return result;
end $$;

-- 4. 중지 ----------------------------------------------------------------------------------------------------------------
-- 이 프로모션이 만든 진행·예정 할인만 끈다. 이미 끝난 기간 행은 그대로 두어 실제로 진행된 이력을 남긴다.
-- 개별로 건 할인과 다른 프로모션의 할인은 promotion_id가 달라 닿지 않는다. 같은 요청번호의 재시도는 저장된 영수증을 돌려준다.
create function public.admin_stop_discount_promotion(p_promotion_id uuid,p_operation_id uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare promotion private.discount_promotions; period private.goods_variant_price_periods; ids text[]; id_value text;
  disabled integer:=0; result jsonb;
begin
  perform private.require_goods_group_identity(p_actor,p_session);
  if p_promotion_id is null or p_operation_id is null then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('discount-promotion:'||p_promotion_id::text,0));
  select * into promotion from private.discount_promotions where id=p_promotion_id for update;
  if not found then raise no_data_found using message='discount_promotion_not_found'; end if;
  if promotion.state='stopped' then
    if promotion.stop_operation_id=p_operation_id then return promotion.stop_receipt; end if;
    raise sqlstate 'PT409' using message='discount_promotion_already_stopped';
  end if;
  ids:=array(select distinct good_id from private.goods_variant_price_periods
    where promotion_id=p_promotion_id and state='active' and ends_at>clock_timestamp() order by good_id);
  if cardinality(ids)=0 and promotion.ends_at<=clock_timestamp() then raise check_violation using message='discount_promotion_ended'; end if;
  foreach id_value in array ids loop
    if not pg_try_advisory_xact_lock(hashtextextended('admin_good:'||id_value,0)) then
      raise sqlstate 'PT409' using message='discount_promotion_busy';
    end if;
  end loop;
  begin
    perform 1 from public.goods where id=any(ids) order by id for update nowait;
    perform 1 from public.goods_variants where good_id=any(ids) order by id for update nowait;
    perform 1 from private.goods_variant_price_periods where good_id=any(ids) order by id for update nowait;
  exception when lock_not_available then raise sqlstate 'PT409' using message='discount_promotion_busy';
  end;
  for period in select * from private.goods_variant_price_periods
    where promotion_id=p_promotion_id and state='active' and ends_at>clock_timestamp() order by good_id,variant_id,id loop
    perform public.admin_save_goods_price_period(period.good_id,period.variant_id,period.id,jsonb_build_object('state','disabled',
      'discountPrice',period.discount_price,'startsAt',period.starts_at,'endsAt',period.ends_at),period.revision);
    disabled:=disabled+1;
  end loop;
  result:=jsonb_build_object('state','completed','operationId',p_operation_id,'promotionId',p_promotion_id,
    'disabledCount',disabled,'goodsCount',cardinality(ids),'stoppedAt',clock_timestamp());
  update private.discount_promotions set state='stopped',stopped_by=p_actor,stopped_at=clock_timestamp(),stop_operation_id=p_operation_id,
    stop_receipt=result,revision=revision+1 where id=p_promotion_id;
  insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'catalog.discount_promotion.stopped','discount_promotion:'||p_promotion_id::text,
    jsonb_build_object('before',to_jsonb(promotion),'receipt',result));
  return result;
end $$;

-- 5. 조회 ----------------------------------------------------------------------------------------------------------------
create function public.admin_list_discount_promotions(p_campaign text default null,p_limit integer default 50,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000
    or (p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9-]{1,63}$') then
    raise invalid_parameter_value using message='discount_promotion_invalid';
  end if;
  return jsonb_build_object('checkedAt',statement_timestamp(),
    'total',(select count(*) from private.discount_promotions promotion
      where p_campaign is null or (promotion.target_kind='campaign' and promotion.target_ids[1]=p_campaign)),
    'rows',coalesce((select jsonb_agg(private.discount_promotion_summary(promotion) order by promotion.created_at desc,promotion.id)
      from private.discount_promotions promotion
      where promotion.id in (select page.id from private.discount_promotions page
        where p_campaign is null or (page.target_kind='campaign' and page.target_ids[1]=p_campaign)
        order by page.created_at desc,page.id limit p_limit offset p_offset)),'[]'::jsonb));
end $$;

create function public.admin_get_discount_promotion(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare promotion private.discount_promotions;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_id is null then raise invalid_parameter_value using message='discount_promotion_invalid'; end if;
  select * into promotion from private.discount_promotions where id=p_id;
  if not found then raise no_data_found using message='discount_promotion_not_found'; end if;
  return private.discount_promotion_summary(promotion)||jsonb_build_object('checkedAt',statement_timestamp(),
    'stopReceipt',promotion.stop_receipt,
    'goods',coalesce((select jsonb_agg(jsonb_build_object('id',line.good_id,'name',coalesce(good.name,line.name),'code',coalesce(good.code,line.code),
        'archived',coalesce(good.archived_at is not null,true),'rule',line.rule,'skip',line.skip_reason,
        'priceMin',(select min(variant.price) from public.goods_variants variant where variant.good_id=line.good_id and variant.archived_at is null),
        'priceMax',(select max(variant.price) from public.goods_variants variant where variant.good_id=line.good_id and variant.archived_at is null),
        'discounts',(select jsonb_build_object(
            'active',count(*) filter (where period.state='active' and period.ends_at>statement_timestamp()),
            'ended',count(*) filter (where period.state='active' and period.ends_at<=statement_timestamp()),
            'disabled',count(*) filter (where period.state='disabled'),
            'minPrice',min(period.discount_price),'maxPrice',max(period.discount_price))
          from private.goods_variant_price_periods period where period.promotion_id=line.promotion_id and period.good_id=line.good_id))
        order by line.position)
      from private.discount_promotion_goods line left join public.goods good on good.id=line.good_id where line.promotion_id=promotion.id),'[]'::jsonb));
end $$;

-- 새 프로모션 입력의 대상 고르기 목록. 기획전 상품 수는 본문 굿즈 블록의 ID 수이고, 실제 대상은 미리보기가 정한다.
create function public.admin_discount_promotion_target_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  return jsonb_build_object(
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',recent.id,'title',recent.title,'status',recent.status,
        'startsAt',recent.starts_at,'endsAt',recent.ends_at,
        'goodsCount',(select count(distinct item.value) from jsonb_array_elements(recent.sections) section(value)
          cross join lateral jsonb_array_elements_text(case when section.value->>'type'='goods' and jsonb_typeof(section.value->'good_ids')='array'
            then section.value->'good_ids' else '[]'::jsonb end) item(value)))
        order by recent.starts_at desc,recent.id)
      from (select * from public.campaigns order by starts_at desc,id limit 200) recent),'[]'::jsonb),
    'ips',coalesce((select jsonb_agg(jsonb_build_object('id',ip.id,'title',ip.title,
        'goodsCount',(select count(*) from public.goods good where good.ip_id=ip.id and good.archived_at is null)) order by ip.title,ip.id)
      from public.ips ip where ip.archived_at is null),'[]'::jsonb));
end $$;

-- 6. 전시 상품 고르기의 여러 줄·엑셀 추가(1014-112) ---------------------------------------------------------------------
-- 붙여 넣은 값(상품번호 또는 판매자상품코드)을 한 번에 상품으로 바꾼다. 입력 순서대로 한 줄에 한 결과를 돌려준다.
-- 보관하지 않은 상품은 관련상품 찾기 검색(admin_search_shopping_story_goods_filtered)과 같은 행 모양·지표로 돌려줘
-- 선택기가 검색 결과와 같은 방식으로 담는다. 보관 상품·보관 IP는 찾았지만 고를 수 없는 결과로 알려 준다.
create function public.admin_resolve_goods_references(p_refs text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if p_refs is null or cardinality(p_refs) not between 1 and 1000 or array_position(p_refs,null) is not null
    or exists(select 1 from unnest(p_refs) ref where ref<>btrim(ref) or char_length(ref) not between 1 and 200) then
    raise invalid_parameter_value using message='invalid_goods_references';
  end if;
  with refs as materialized (
    select input.ref,input.ordinality from unnest(p_refs) with ordinality input(ref,ordinality)
  ), hits as materialized (
    select refs.ordinality,good.id,case when good.id=refs.ref then 'id' else 'code' end matched_by
    from refs join public.goods good on good.id=refs.ref or good.code=upper(refs.ref)
  ), resolved as materialized (
    select refs.ref,refs.ordinality,count(distinct hits.id) hit_count,min(hits.id) good_id,min(hits.matched_by) matched_by
    from refs left join hits on hits.ordinality=refs.ordinality group by refs.ref,refs.ordinality
  ), base as materialized (
    select g as good,g.id,g.name,g.code,g.archived_at is not null or ip.archived_at is not null as archived,
      ip.published_at is not null as ip_published,
      g.published_at is not null and ip.published_at is not null and g.archived_at is null and ip.archived_at is null and g.sale_restriction='none' as is_published
    from public.goods g join public.ips ip on ip.id=g.ip_id
    where g.id in (select good_id from resolved where hit_count=1)
  ), eligible as materialized (
    select b.*,coalesce(s.price,(b.good).price) as current_price,coalesce(s.available,0)<=0 as sold_out,coalesce(s.preorder,false) as preorder,
      coalesce(s.discounted,false) or coalesce((b.good).compare_at_price>(b.good).price,false) as discounted,
      (private.calculate_goods_shipping(jsonb_build_array(jsonb_build_object('origin_id',(b.good).origin_id,'good_id',b.id,'qty',1,
        'unit_price',coalesce(s.price,(b.good).price),'fee_type',(b.good).shipping_fee_type,'individual_fee',(b.good).individual_fee)))->>'totalFee')::bigint=0 as free_shipping
    from base b cross join lateral (
      select min(price.effective_price) price,sum(supply.available_qty) available,bool_or(v.preorder_policy_id is not null) preorder,
        bool_or(price.effective_price<price.regular_price) discounted
      from public.goods_variants v
      cross join lateral private.resolve_goods_variant_price(v.id,statement_timestamp()) price
      cross join lateral private.resolve_goods_variant_supply(v.id,statement_timestamp()) supply
      where v.good_id=b.id and v.archived_at is null
    ) s
    where not b.archived
  ), review_metrics as (
    select r.good_id,count(*) review_count,avg(r.rating)::numeric rating_average from public.reviews r join eligible g on g.id=r.good_id where r.status='visible' group by r.good_id
  ), wishes as (
    select w.good_id,count(*) wish_count from public.wishlists w join eligible g on g.id=w.good_id group by w.good_id
  ), paid_orders as materialized (
    -- 관련상품 찾기 검색·홈 판매 순위와 같은 결제 근거와 취소·반품 완료 제외다.
    select o.id,min(approval.approved_at) approved_at
    from public.orders o
    join public.payments p on p.purpose='order' and p.ref_id=o.id and p.status='paid' and p.user_id=o.user_id and p.amount=o.total
    join public.payment_attempts a on a.payment_id=p.id and a.purpose='order' and a.ref_id=o.id and a.state='approved' and a.amount=p.amount and a.provider=p.provider and a.user_id=o.user_id
    cross join lateral (select coalesce(
      (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
      (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id and a.provider='bank_transfer')) approved_at) approval
    where o.status in ('paid','confirmed','shipping','delivered','done') and approval.approved_at is not null
      and exists(select 1 from public.order_items item join eligible g on g.id=item.good_id where item.order_id=o.id)
      and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.claim_type in ('cancel','return') and (c.status='completed' or c.stage='completed'))
    group by o.id
  ), sales as (
    select item.good_id,sum(item.qty::bigint) quantity from paid_orders p join public.order_items item on item.order_id=p.id join eligible g on g.id=item.good_id
    where p.approved_at>=statement_timestamp()-interval '30 days' and p.approved_at<statement_timestamp() group by item.good_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('ref',r.ref,
      'status',case when r.hit_count=0 then 'not_found' when r.hit_count>1 then 'ambiguous' else 'found' end,
      'matchedBy',case when r.hit_count=1 then r.matched_by end,
      'id',b.id,'name',b.name,'code',b.code,'archived',coalesce(b.archived,false),'published',coalesce(b.is_published,false),
      'candidate',case when e.id is null then null else private.shopping_story_admin_good(e.good,e.ip_published,false)||jsonb_build_object(
        'reviewCount',coalesce(rm.review_count,0),'ratingAverage',round(rm.rating_average,2),'wishCount',coalesce(w.wish_count,0),
        'salesQuantity',coalesce(s.quantity,0),'freeShipping',e.free_shipping,'discounted',e.discounted,
        'saleType',case when e.preorder then 'preorder' else 'stock' end) end) order by r.ordinality),'[]'::jsonb) into result_value
  from resolved r
  left join base b on b.id=r.good_id and r.hit_count=1
  left join eligible e on e.id=b.id
  left join review_metrics rm on rm.good_id=e.id
  left join wishes w on w.good_id=e.id
  left join sales s on s.good_id=e.id;
  return result_value;
end $$;

-- 7. 권한 봉인·운영자 계약 ---------------------------------------------------------------------------------------------
revoke all on function private.discount_promotion_validate(jsonb),private.discount_promotion_price(integer,integer,jsonb),
  private.insert_discount_promotion_period(uuid,text,uuid,integer,timestamptz,timestamptz,uuid),
  private.discount_promotion_summary(private.discount_promotions) from public,anon,authenticated,service_role;
grant execute on function private.discount_promotion_validate(jsonb),private.discount_promotion_price(integer,integer,jsonb),
  private.insert_discount_promotion_period(uuid,text,uuid,integer,timestamptz,timestamptz,uuid),
  private.discount_promotion_summary(private.discount_promotions) to postgres;
revoke all on function public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid),public.admin_commit_discount_promotion(uuid,uuid,uuid),
  public.admin_read_discount_promotion_operation(uuid,uuid,uuid,boolean),public.admin_stop_discount_promotion(uuid,uuid,uuid,uuid),
  public.admin_list_discount_promotions(text,integer,integer),public.admin_get_discount_promotion(uuid),
  public.admin_discount_promotion_target_options(),public.admin_resolve_goods_references(text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid),public.admin_commit_discount_promotion(uuid,uuid,uuid),
  public.admin_read_discount_promotion_operation(uuid,uuid,uuid,boolean),public.admin_stop_discount_promotion(uuid,uuid,uuid,uuid),
  public.admin_list_discount_promotions(text,integer,integer),public.admin_get_discount_promotion(uuid),
  public.admin_discount_promotion_target_options(),public.admin_resolve_goods_references(text[]) to authenticated;

select private.register_operator_rpc_contract('public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_commit_discount_promotion(uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_discount_promotion_operation(uuid,uuid,uuid,boolean)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_stop_discount_promotion(uuid,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_list_discount_promotions(text,integer,integer)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_get_discount_promotion(uuid)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_discount_promotion_target_options()'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_resolve_goods_references(text[])'::regprocedure,'catalog.read','read',false);
select private.register_operator_internal_contract(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('discount_promotion_validate','discount_promotion_price','insert_discount_promotion_period',
    'discount_promotion_summary','guard_goods_price_period_promotion');
notify pgrst,'reload schema';
commit;
