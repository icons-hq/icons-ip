-- 상품의 수령 방식·주문 후 제작: 설정 근거와 확인 체크 없이 저장한다(2026-11-25 결정 — 저장 = 적용).
--
-- 두 저장 함수는 p_values에 '설정 근거'(evidence, 2자 이상)와 확인 체크(confirmed=true)가 있어야 저장했다.
-- 화면에서 그 칸을 걷어 내므로 두 함수의 필수 검사만 없앤다. 누가 언제 무엇으로 바꿨는지는 감사 기록(audit_log)이 그대로 남긴다.
--   - 인자 시그니처는 그대로다. p_values의 evidence·confirmed는 보내지 않아도 되고(null도 된다), 보내는 옛 호출
--     (배송 설정 템플릿 적용 admin_apply_shipping_settings_template_v3 포함)도 전과 같이 저장된다.
--   - 이미 저장된 근거 값은 지우지 않는다. 근거를 보내지 않은 저장은 저장돼 있던 값을 그대로 두고, 처음 저장하는 상품은 빈 값이다.
--   - confirmed는 받기만 하고 쓰지 않는다. 그 밖의 키는 전처럼 거절한다.
--   - 나머지 조건은 그대로다: 권한(catalog.manage)·로그인 확인, 값 형식, 예약판매·디지털 파일과의 충돌, 확인한 파일만 연결,
--     다른 사람이 먼저 바꿨을 때의 거절(PT409), 같은 작업 번호 재시도, 감사 기록.
--   - 등록 화면의 한 번에 저장(admin_save_good_workspace)은 섹션 값을 이 두 함수에 그대로 넘기므로 따로 고치지 않는다.

create or replace function public.admin_save_goods_production(p_good text,p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old private.goods_production_settings;prior public.audit_log;request jsonb;result jsonb;dates date[];entry jsonb;begin
 perform private.production_identity(p_actor,p_session,null,'catalog.manage');
 if p_operation is null or p_revision is null or p_revision<0 or jsonb_typeof(p_values) is distinct from 'object'
  or not private.transaction_json_keys(p_values-array['evidence','confirmed'],array['enabled','leadDays','dayBasis','closedDates','publicNote'])
  or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or coalesce(p_values->>'dayBasis','') not in('calendar','business')
  or p_values->'leadDays'<>'null'::jsonb and(jsonb_typeof(p_values->'leadDays')<>'number' or p_values->>'leadDays'!~'^[1-9][0-9]*$' or (p_values->>'leadDays')::numeric>365)
  or p_values->'enabled'='true'::jsonb and p_values->'leadDays'='null'::jsonb
  or jsonb_typeof(p_values->'closedDates') is distinct from 'array' or jsonb_array_length(p_values->'closedDates')>1000
  or jsonb_typeof(p_values->'publicNote') is distinct from 'string' or char_length(p_values->>'publicNote')>1000
  or p_values ? 'evidence' and(jsonb_typeof(p_values->'evidence') not in('string','null') or char_length(btrim(coalesce(p_values->>'evidence','')))>1000)
  or p_values ? 'confirmed' and jsonb_typeof(p_values->'confirmed') not in('boolean','null')
  or (coalesce(p_values->>'evidence','')||(p_values->>'publicNote'))~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 dates:='{}';
 for entry in select value from jsonb_array_elements(p_values->'closedDates') loop
  if jsonb_typeof(entry)<>'string' or entry#>>'{}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_parameter_value;end if;
  begin dates:=array_append(dates,(entry#>>'{}')::date);exception when others then raise invalid_parameter_value;end;
 end loop;
 if cardinality(dates)<>(select count(distinct d) from unnest(dates)d) then raise invalid_parameter_value;end if;
 if p_values->>'dayBasis'='calendar' and cardinality(dates)>0 then raise invalid_parameter_value;end if;
 perform 1 from public.goods where id=p_good and archived_at is null for update;if not found then raise no_data_found;end if;
 select * into old from private.goods_production_settings where good_id=p_good for update;
 request:=jsonb_build_object('goodId',p_good,'values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then if prior.actor_id is distinct from p_actor or prior.action<>'admin.goods.production_policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;return prior.diff->'result';end if;
 if coalesce(old.revision,0)<>p_revision then raise sqlstate 'PT409' using message='production_changed';end if;
 if p_values->'enabled'='true'::jsonb then
  perform private.assert_goods_transaction_runtime();
  if exists(select 1 from public.goods_variants where good_id=p_good and preorder_policy_id is not null and archived_at is null) then raise check_violation using message='production_preorder_conflict';end if;
 end if;
 -- 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다(없으면 빈 값).
 insert into private.goods_production_settings(good_id,revision,enabled,lead_days,day_basis,closed_dates,public_note,evidence)
 values(p_good,p_revision+1,(p_values->>'enabled')::boolean,(p_values->>'leadDays')::integer,p_values->>'dayBasis',array(select d from unnest(dates)d order by d),btrim(p_values->>'publicNote'),
  coalesce(nullif(btrim(p_values->>'evidence'),''),old.evidence,''))
 on conflict(good_id) do update set revision=excluded.revision,enabled=excluded.enabled,lead_days=excluded.lead_days,day_basis=excluded.day_basis,
  closed_dates=excluded.closed_dates,public_note=excluded.public_note,evidence=excluded.evidence,updated_at=clock_timestamp();
 result:=private.goods_production_document(p_good);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'admin.goods.production_policy','good:'||p_good,jsonb_build_object('request',request,'result',result));return result;
end $$;

create or replace function public.admin_save_goods_fulfillment(p_good text,p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old private.goods_fulfillment_settings;prior public.audit_log;request jsonb;result jsonb;method jsonb;asset_ids uuid[];good public.goods;begin
 perform private.production_identity(p_actor,p_session,null,'catalog.manage');
 if p_revision is null or p_revision<0 or p_operation is null or jsonb_typeof(p_values) is distinct from 'object'
  or not private.transaction_json_keys(p_values-array['evidence','confirmed'],array['mode','methods','assetIds','publicNote'])
  or coalesce(p_values->>'mode','') not in('shipping','no_delivery','digital')
  or jsonb_typeof(p_values->'methods') is distinct from 'array' or jsonb_array_length(p_values->'methods') not between 1 and 5
  or jsonb_typeof(p_values->'assetIds') is distinct from 'array' or jsonb_array_length(p_values->'assetIds')>10
  or jsonb_typeof(p_values->'publicNote') is distinct from 'string' or char_length(p_values->>'publicNote')>1000
  or p_values ? 'evidence' and(jsonb_typeof(p_values->'evidence') not in('string','null') or char_length(btrim(coalesce(p_values->>'evidence','')))>1000)
  or p_values ? 'confirmed' and jsonb_typeof(p_values->'confirmed') not in('boolean','null')
  or ((p_values->>'publicNote')||coalesce(p_values->>'evidence',''))~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 if (select count(distinct value->>'method') from jsonb_array_elements(p_values->'methods'))<>jsonb_array_length(p_values->'methods') then raise invalid_parameter_value;end if;
 for method in select value from jsonb_array_elements(p_values->'methods') loop
  if not private.transaction_json_keys(method,array['method','feeAmount','feeBasis','installationFee'])
   or coalesce(method->>'method','') not in('parcel','quick','pickup','direct','freight','none','digital')
   or coalesce(method->>'feeBasis','') not in('per_order','per_item')
   or jsonb_typeof(method->'installationFee') is distinct from 'number' or method->>'installationFee'!~'^(0|[1-9][0-9]*)$' or (method->>'installationFee')::numeric>1000000
   or (method->>'method'='parcel') is distinct from (method->'feeAmount'='null'::jsonb)
   or method->>'method'<>'parcel' and (jsonb_typeof(method->'feeAmount') is distinct from 'number' or method->>'feeAmount'!~'^(0|[1-9][0-9]*)$' or (method->>'feeAmount')::numeric>1000000)
   or method->>'method' in('pickup','none','digital') and (method->'feeAmount'<>'0'::jsonb or method->'installationFee'<>'0'::jsonb)
   or method->>'method'='parcel' and method->>'feeBasis'<>'per_order'
   or p_values->>'mode'='shipping' and method->>'method' not in('parcel','quick','pickup','direct','freight')
   or p_values->>'mode'='no_delivery' and method->>'method'<>'none'
   or p_values->>'mode'='digital' and method->>'method'<>'digital' then raise invalid_parameter_value;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_values->'assetIds') a where jsonb_typeof(a)<>'string' or a#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise invalid_parameter_value;end if;
 select coalesce(array_agg((a#>>'{}')::uuid),'{}') into asset_ids from jsonb_array_elements(p_values->'assetIds') a;
 if cardinality(asset_ids)<>(select count(distinct a) from unnest(asset_ids)a) or (p_values->>'mode'='digital') is distinct from (cardinality(asset_ids)>0) then raise invalid_parameter_value;end if;
 select * into good from public.goods where id=p_good and archived_at is null for update;if not found then raise no_data_found;end if;
 select * into old from private.goods_fulfillment_settings where good_id=p_good for update;
 request:=jsonb_build_object('goodId',p_good,'values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then if prior.actor_id is distinct from p_actor or prior.action<>'goods.fulfillment.settings' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;return prior.diff->'result';end if;
 if coalesce(old.revision,0)<>p_revision then raise sqlstate 'PT409' using message='fulfillment_changed';end if;
 perform private.assert_goods_transaction_runtime();
 if p_values->>'mode'='digital' and (exists(select 1 from private.goods_production_settings where good_id=p_good and enabled)
  or exists(select 1 from public.goods_variants where good_id=p_good and preorder_policy_id is not null and archived_at is null)) then raise check_violation using message='digital_supply_conflict';end if;
 -- Files are immutable after verification; replacing a product's selection does
 -- not replace files purchased under an earlier order contract.
 perform id from private.goods_digital_assets where id=any(asset_ids) order by id for share;
 if (select count(*) from private.goods_digital_assets where id=any(asset_ids) and state='verified')<>cardinality(asset_ids) then raise check_violation using message='digital_asset_unavailable';end if;
 -- 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다(없으면 빈 값).
 insert into private.goods_fulfillment_settings(good_id,revision,mode,methods,asset_ids,public_note,evidence)
 values(p_good,p_revision+1,p_values->>'mode',p_values->'methods',asset_ids,btrim(p_values->>'publicNote'),
  coalesce(nullif(btrim(p_values->>'evidence'),''),old.evidence,''))
 on conflict(good_id) do update set revision=excluded.revision,mode=excluded.mode,methods=excluded.methods,asset_ids=excluded.asset_ids,
 public_note=excluded.public_note,evidence=excluded.evidence,updated_at=clock_timestamp();
 result:=private.goods_fulfillment_document(p_good,true);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'goods.fulfillment.settings','good:'||p_good,jsonb_build_object('request',request,'result',result));return result;
end $$;

-- 같은 시그니처를 다시 정의해 실행 권한은 그대로지만, 봉인을 한 번 더 적어 둔다(authenticated만 실행).
revoke all on function public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid),public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid),public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)
  to authenticated;

-- 다시 정의한 두 함수의 본문 지문을 운영자 계약에 재등록한다(권한·구분은 전과 같다).
select private.register_operator_rpc_contract('public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
