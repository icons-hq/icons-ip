-- IP coupons follow each good's current IP, including goods added to that IP later.
-- The eligibility helper gains an IP argument; existing coupon callers are patched
-- in place (asserted substrings, not whole-body hashes) so checkout bodies owned by
-- other changes are not redefined here.
begin;
alter table public.coupons add column target_ip_ids text[] not null default '{}';
alter table public.coupons drop constraint coupons_goods_scope_check;
alter table public.coupons add constraint coupons_goods_scope_check check(goods_scope in ('all','selected_goods','selected_categories','selected_ips'));
alter table public.coupons drop constraint coupon_goods_scope_ready;
alter table public.coupons add constraint coupon_goods_scope_ready check(
 (goods_scope='all' and cardinality(target_good_ids)=0 and cardinality(target_category_ids)=0 and cardinality(target_ip_ids)=0)
 or (goods_scope='selected_goods' and cardinality(target_category_ids)=0 and cardinality(target_ip_ids)=0 and (status='archived' or cardinality(target_good_ids)>0))
 or (goods_scope='selected_categories' and cardinality(target_good_ids)=0 and cardinality(target_ip_ids)=0 and (status='archived' or cardinality(target_category_ids)>0))
 or (goods_scope='selected_ips' and cardinality(target_good_ids)=0 and cardinality(target_category_ids)=0 and (status='archived' or cardinality(target_ip_ids)>0)));
alter table public.coupons add constraint coupon_ip_targets_valid check(cardinality(target_ip_ids)<=100 and array_position(target_ip_ids,null) is null);

-- The IP argument is separate so the four-argument contract keeps its meaning.
-- An unpatched four-argument caller treats an IP coupon conservatively (no match).
create function private.coupon_good_matches(p_scope text,p_goods text[],p_categories uuid[],p_ips text[],p_good text) returns boolean
language plpgsql volatile set search_path='' as $$
begin
 if p_scope='selected_ips' then
  return exists(select 1 from public.goods g where g.id=p_good and g.ip_id=any(coalesce(p_ips,'{}')));
 end if;
 return private.coupon_good_matches(p_scope,p_goods,p_categories,p_good);
end $$;

create function public.admin_coupon_target_ips(target_coupon public.coupons) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',selected.id,'title',coalesce(ip.title,'정보 미확인'),'blocked',ip.id is null or ip.archived_at is not null) order by coalesce(ip.title,selected.id),selected.id),'[]') into result
 from public.coupons source cross join lateral unnest(source.target_ip_ids) selected(id)
 left join public.ips ip on ip.id=selected.id where source.code=target_coupon.code;
 return result;
end $$;

create function public.admin_search_coupon_ips(p_query text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;needle text:=btrim(coalesce(p_query,''));
begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_coupon_ip_search';end if;
 with filtered as materialized(select ip.id,ip.title,false as blocked from public.ips ip
   where ip.archived_at is null and (needle='' or strpos(lower(ip.title),lower(needle))>0 or strpos(ip.id,lower(needle))>0)),
 rows as(select * from filtered order by title,id limit 20 offset(p_page-1)*20)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(rows) order by title,id) from rows),'[]'),'total',(select count(*) from filtered),'page',p_page,'pageSize',20) into result;
 return result;
end $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_coupon_targeted(target_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid()); previous public.coupons; saved public.coupons;
  normalized_code text:=upper(btrim(target_payload->>'target_code')); previous_code text:=nullif(upper(btrim(target_payload->>'target_previous_code')),'');
  segment text:=target_payload->>'target_recipient_segment'; scope text:=target_payload->>'target_goods_scope'; good_ids text[]; category_ids uuid[]; ip_ids text[]; issue_mode text;
  next_status text:=coalesce(target_payload->>'target_status','active');
begin
  perform private.require_operator_capability('marketing.manage',false);

 perform private.assert_active_user(actor);
 if not public.has_operator_capability('marketing.manage',false) or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='staff_required'; end if;
 if jsonb_typeof(target_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(target_payload) k
    where k not in ('target_code','target_name','target_discount_type','target_discount_value','target_max_discount_amount','target_min_subtotal','target_starts_at','target_ends_at','target_issue_limit','target_status','target_grade_benefit','target_previous_code','target_recipient_segment','target_goods_scope','target_good_ids','target_expected_revision','target_category_ids','target_issuance_mode','target_ip_ids'))
    or segment is null or segment not in ('all','first_purchase','repeat_purchase') or scope is null or scope not in ('all','selected_goods','selected_categories','selected_ips')
    or next_status not in ('active','archived')
    or jsonb_typeof(target_payload->'target_good_ids') is distinct from 'array' or jsonb_array_length(target_payload->'target_good_ids')>1000
    or exists(select 1 from jsonb_array_elements(target_payload->'target_good_ids') e where jsonb_typeof(e)<>'string' or length(e#>>'{}') not between 1 and 200)
    then raise invalid_parameter_value using message='invalid_coupon_targeting'; end if;
 select coalesce(array_agg(distinct btrim(value) order by btrim(value)),'{}') into good_ids from jsonb_array_elements_text(target_payload->'target_good_ids');
 if scope<>'selected_goods' and cardinality(good_ids)>0 then raise invalid_parameter_value using message='invalid_coupon_targeting'; end if;
 if scope='selected_goods' and next_status='active' and cardinality(good_ids)=0 then raise check_violation using message='coupon_goods_scope_ready'; end if;
 if previous_code is not null and previous_code is distinct from normalized_code then raise invalid_parameter_value using message='catalog_id_immutable'; end if;
 -- Per-code lock covers a new definition before its row exists and prevents a
 -- concurrent creator from being converted into an update.
 perform pg_advisory_xact_lock(hashtextextended('coupon_admin:'||normalized_code,0));
 select * into previous from public.coupons where code=normalized_code for update;
 if previous_code is null and found then raise unique_violation using message='catalog_id_taken'; end if;
 if previous_code is not null then
   if previous.code is null then raise no_data_found using message='catalog_record_missing'; end if;
   if (target_payload->>'target_expected_revision')::integer is distinct from previous.terms_revision then raise exception using errcode='PT409',message='coupon_terms_changed'; end if;
 end if;
 issue_mode:=coalesce(target_payload->>'target_issuance_mode',previous.issuance_mode,'code');
 if issue_mode not in ('code','targeted') or (target_payload?'target_issuance_mode' and jsonb_typeof(target_payload->'target_issuance_mode') is distinct from 'string') then raise invalid_parameter_value using message='invalid_coupon_targeting';end if;
 if target_payload?'target_category_ids' then
  if jsonb_typeof(target_payload->'target_category_ids') is distinct from 'array' or jsonb_array_length(target_payload->'target_category_ids')>100
   or exists(select 1 from jsonb_array_elements(target_payload->'target_category_ids') e where jsonb_typeof(e)<>'string' or e#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise invalid_parameter_value using message='invalid_coupon_category_targeting';end if;
  select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into category_ids from jsonb_array_elements_text(target_payload->'target_category_ids');
 else category_ids:=case when scope='selected_categories' then coalesce(previous.target_category_ids,'{}') else '{}' end;end if;
 if (scope<>'selected_categories' and cardinality(category_ids)>0) or (scope='selected_categories' and next_status='active' and cardinality(category_ids)=0) then raise check_violation using message='coupon_category_scope_ready';end if;
 if target_payload?'target_ip_ids' then
  if jsonb_typeof(target_payload->'target_ip_ids') is distinct from 'array' or jsonb_array_length(target_payload->'target_ip_ids')>100
   or exists(select 1 from jsonb_array_elements(target_payload->'target_ip_ids') e where jsonb_typeof(e)<>'string' or e#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,99}$') then raise invalid_parameter_value using message='invalid_coupon_ip_targeting';end if;
  select coalesce(array_agg(distinct value order by value),'{}') into ip_ids from jsonb_array_elements_text(target_payload->'target_ip_ids');
 else ip_ids:=case when scope='selected_ips' then coalesce(previous.target_ip_ids,'{}') else '{}' end;end if;
 if (scope<>'selected_ips' and cardinality(ip_ids)>0) or (scope='selected_ips' and next_status='active' and cardinality(ip_ids)=0) then raise check_violation using message='coupon_ip_scope_ready';end if;
 -- An archived IP may stay on an existing definition (its goods are not sold), but cannot be newly targeted.
 if exists(select 1 from unnest(ip_ids) selected(id) left join public.ips ip on ip.id=selected.id
   where ip.id is null or ip.archived_at is not null and not selected.id=any(coalesce(previous.target_ip_ids,'{}'))) then raise check_violation using message='coupon_target_ip_unavailable';end if;
 if issue_mode='targeted' and nullif(target_payload->>'target_grade_benefit','') is not null then raise check_violation using message='coupon_targeted_grade_exclusive';end if;
 if cardinality(category_ids)>0 then
  if not pg_try_advisory_xact_lock_shared(hashtextextended('catalog_category_tree',0)) then raise exception using errcode='PT409',message='coupon_category_changed';end if;
  if exists(select 1 from unnest(category_ids) selected(id) left join private.coupon_category_catalog() c on c.id=selected.id
   where c.id is null or c.blocked and not selected.id=any(coalesce(previous.target_category_ids,'{}'))) then raise check_violation using message='coupon_target_category_unavailable';end if;
 end if;
 if exists(select 1 from unnest(good_ids) target(id) where not exists(select 1 from public.goods g where g.id=target.id and (g.archived_at is null or target.id=any(previous.target_good_ids))))
   then raise check_violation using message='coupon_target_good_unavailable'; end if;
 -- Install validated targeting, issuance mode and status together before the
 -- legacy definition writer. A single transaction preserves grade/status checks
 -- during mode changes and never exposes partially updated terms.
 if previous.code is not null then
   update public.coupons set status=next_status,recipient_segment=segment,goods_scope=scope,target_good_ids=good_ids,target_category_ids=category_ids,target_ip_ids=ip_ids,issuance_mode=issue_mode,grade_benefit=case when issue_mode='targeted' then null else grade_benefit end where code=normalized_code;
 end if;
 perform public.admin_upsert_coupon(
   normalized_code,target_payload->>'target_name',target_payload->>'target_discount_type',(target_payload->>'target_discount_value')::integer,
   (target_payload->>'target_max_discount_amount')::integer,(target_payload->>'target_min_subtotal')::integer,
   (target_payload->>'target_starts_at')::timestamptz,(target_payload->>'target_ends_at')::timestamptz,
   (target_payload->>'target_issue_limit')::integer,next_status,(target_payload->>'target_grade_benefit')::public.loyalty_grade,previous_code);
 update public.coupons set recipient_segment=segment,goods_scope=scope,target_good_ids=good_ids,target_category_ids=category_ids,target_ip_ids=ip_ids,issuance_mode=issue_mode where code=normalized_code returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'commerce.coupon.targeting_updated','coupons:'||normalized_code,
   jsonb_build_object('before',case when previous.code is null then null else jsonb_build_object('recipientSegment',previous.recipient_segment,'goodsScope',previous.goods_scope,'targetGoodIds',previous.target_good_ids,'targetCategoryIds',previous.target_category_ids,'targetIpIds',previous.target_ip_ids,'issuanceMode',previous.issuance_mode,'revision',previous.terms_revision) end,
     'after',jsonb_build_object('recipientSegment',saved.recipient_segment,'goodsScope',saved.goods_scope,'targetGoodIds',saved.target_good_ids,'targetCategoryIds',saved.target_category_ids,'targetIpIds',saved.target_ip_ids,'issuanceMode',saved.issuance_mode,'revision',saved.terms_revision)));
 return jsonb_build_object('code',saved.code,'revision',saved.terms_revision);
end $function$
;

-- Exact substring patches: each replacement must match exactly the expected
-- number of times, so a concurrent redefinition that changes the coupon call
-- fails here instead of silently dropping IP eligibility.
do $patch$
declare source text;
 procedure_name regprocedure;
 old_text text;new_text text;expected integer;found_count integer;
 patches jsonb:=jsonb_build_array(
  jsonb_build_array('private.touch_coupon_terms_revision()',$o$new.target_category_ids,new.issuance_mode)$o$,$n$new.target_category_ids,new.issuance_mode,new.target_ip_ids)$n$,1),
  jsonb_build_array('private.touch_coupon_terms_revision()',$o$old.target_category_ids,old.issuance_mode)$o$,$n$old.target_category_ids,old.issuance_mode,old.target_ip_ids)$n$,1),
  jsonb_build_array('private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamp with time zone)',
   $o$private.coupon_good_matches(coupon.goods_scope,coupon.target_good_ids,coupon.target_category_ids,line.good_id)$o$,
   $n$private.coupon_good_matches(coupon.goods_scope,coupon.target_good_ids,coupon.target_category_ids,coupon.target_ip_ids,line.good_id)$n$,1),
  jsonb_build_array('private.evaluate_coupon_target_lines_at(uuid,uuid,jsonb,uuid,timestamp with time zone)',
   $o$||case when coupon.issuance_mode='targeted' then$o$,
   $n$||case when coupon.goods_scope='selected_ips' then jsonb_build_object('targetIpIds',coupon.target_ip_ids) else '{}'::jsonb end
  ||case when coupon.issuance_mode='targeted' then$n$,1),
  jsonb_build_array('private.calculate_goods_transaction_combined_locked(uuid,jsonb,jsonb,jsonb,uuid[],bigint,timestamp with time zone,jsonb,uuid)',
   $o$private.coupon_good_matches(definition.goods_scope,definition.target_good_ids,definition.target_category_ids,$o$,
   $n$private.coupon_good_matches(definition.goods_scope,definition.target_good_ids,definition.target_category_ids,definition.target_ip_ids,$n$,2),
  jsonb_build_array('private.calculate_goods_transaction_locked(uuid,jsonb,jsonb,jsonb,uuid,bigint,timestamp with time zone,jsonb,uuid)',
   $o$array(select jsonb_array_elements_text(coalesce(coupon_data#>'{termsSnapshot,targetCategoryIds}','[]'))::uuid),value->>'goodId')$o$,
   $n$array(select jsonb_array_elements_text(coalesce(coupon_data#>'{termsSnapshot,targetCategoryIds}','[]'))::uuid),
    array(select jsonb_array_elements_text(coalesce(coupon_data#>'{termsSnapshot,targetIpIds}','[]'))),value->>'goodId')$n$,1));
 patch jsonb;
begin
 for patch in select value from jsonb_array_elements(patches) loop
  procedure_name:=to_regprocedure(patch->>0);
  if procedure_name is null then raise exception 'coupon IP dependency missing: %',patch->>0;end if;
  old_text:=patch->>1;new_text:=patch->>2;expected:=(patch->>3)::integer;
  select pg_get_functiondef(procedure_name) into source;
  found_count:=(length(source)-length(replace(source,old_text,'')))/length(old_text);
  if found_count<>expected then raise exception 'coupon IP dependency changed: % (% of % matches)',patch->>0,found_count,expected;end if;
  execute replace(source,old_text,new_text);
 end loop;
end $patch$;

CREATE OR REPLACE FUNCTION public.admin_search_coupon_console_v4(p_query text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(code text, name text, discount_type text, discount_value integer, max_discount_amount integer, min_subtotal integer, starts_at timestamp with time zone, ends_at timestamp with time zone, issue_limit integer, issued_count integer, status text, grade_benefit loyalty_grade, used_count bigint, total_count bigint, recipient_segment text, goods_scope text, target_good_ids text[], terms_revision integer, target_goods jsonb, issue_starts_at timestamp with time zone, issue_ends_at timestamp with time zone, valid_days integer, benefit_kind text, stackable boolean, target_category_ids uuid[], issuance_mode text, target_categories jsonb, target_ip_ids text[], target_ips jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
  phase text := coalesce(p_filters->>'phase','all');
  discount text := coalesce(p_filters->>'discountType','all');
  segment text := coalesce(p_filters->>'segment','any');
  date_field text := coalesce(p_filters->>'dateField','created');
  sort_key text := coalesce(p_filters->>'sort','created_desc');
  date_from date := nullif(p_filters->>'from','')::date;
  date_to date := nullif(p_filters->>'to','')::date;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if length(needle) > 100
     or normalized_status not in ('all', 'active', 'archived')
     or p_limit is null
     or p_limit not between 1 and 100
     or p_offset is null
     or p_offset < 0 or p_offset > 10000000
     or phase not in ('all','scheduled','live','ended','stopped')
     or discount not in ('all','fixed','percent')
     or segment not in ('any','all','first_purchase','repeat_purchase','grade','targeted')
     or date_field not in ('created','starts')
     or sort_key not in ('created_desc','name_asc','starts_desc','ends_asc')
     or (date_from is not null and date_to is not null and date_from > date_to) then
    raise invalid_parameter_value using message = 'invalid_coupon_search';
  end if;

  -- `%`와 `_`는 검색어가 아니라 와일드카드로 해석되지 않게 한다.
  pattern := '%' || replace(
    replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_'
  ) || '%';

  return query
    select
      coupon.code,
      coupon.name,
      coupon.discount_type,
      coupon.discount_value,
      coupon.max_discount_amount,
      coupon.min_subtotal,
      coupon.starts_at,
      coupon.ends_at,
      coupon.issue_limit,
      coupon.issued_count,
      coupon.status,
      coupon.grade_benefit,
      (
        select count(*)::bigint
        from public.coupon_redemptions as redemption
        where redemption.coupon_code = coupon.code
          and redemption.status = 'applied'
      ) as used_count,
      count(*) over () as total_count,
      coupon.recipient_segment,coupon.goods_scope,coupon.target_good_ids,coupon.terms_revision,public.admin_coupon_target_goods(coupon),coupon.issue_starts_at,coupon.issue_ends_at,coupon.valid_days,coupon.benefit_kind,coupon.stackable,coupon.target_category_ids,coupon.issuance_mode,public.admin_coupon_target_categories(coupon),
      coupon.target_ip_ids,public.admin_coupon_target_ips(coupon)
    from public.coupons as coupon
    where (needle = ''
      or coupon.code ilike pattern escape E'\\'
      or coupon.name ilike pattern escape E'\\')
      and (normalized_status = 'all' or coupon.status = normalized_status)
      and (discount='all' or coupon.discount_type=discount)
      and (segment='any' or (segment='grade' and coupon.grade_benefit is not null) or (segment='targeted' and coupon.issuance_mode='targeted') or (coupon.issuance_mode='code' and coupon.recipient_segment=segment))
      and (phase='all' or (phase='stopped' and coupon.status='archived')
        or (coupon.status='active' and ((phase='scheduled' and coalesce(coupon.issue_starts_at,coupon.starts_at)>now())
        or (phase='ended' and least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=now())
        or (phase='live' and coalesce(coupon.issue_starts_at,coupon.starts_at)<=now() and (least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end) is null or least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)>now())))))
      and (date_from is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) >= (date_from::timestamp at time zone 'Asia/Seoul'))
      and (date_to is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) < ((date_to+1)::timestamp at time zone 'Asia/Seoul'))
    order by case when sort_key='name_asc' then coupon.name end asc,
      case when sort_key='starts_desc' then coupon.starts_at end desc,
      case when sort_key='ends_asc' then coupon.ends_at end asc nulls last,
      coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$function$
;

revoke all on function private.coupon_good_matches(text,text[],uuid[],text[],text) from public,anon,authenticated,service_role;
revoke all on function public.admin_coupon_target_ips(public.coupons),public.admin_search_coupon_ips(text,integer),public.admin_search_coupon_console_v4(text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_coupon_target_ips(public.coupons),public.admin_search_coupon_ips(text,integer),public.admin_search_coupon_console_v4(text,text,integer,integer,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_coupon_target_ips(public.coupons)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_search_coupon_ips(text,integer)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_search_coupon_console_v4(text,text,integer,integer,jsonb)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_upsert_coupon_targeted(jsonb)'::regprocedure,'marketing.manage','write',false);
select private.register_operator_internal_contract(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('coupon_good_matches','admin_coupon_target_ips','admin_search_coupon_ips','admin_search_coupon_console_v4','admin_upsert_coupon_targeted','touch_coupon_terms_revision','evaluate_coupon_target_lines_at','calculate_goods_transaction_combined_locked','calculate_goods_transaction_locked');
notify pgrst,'reload schema';
commit;
