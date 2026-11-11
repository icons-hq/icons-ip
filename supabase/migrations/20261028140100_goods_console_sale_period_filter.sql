-- 10/27 회의 MD-0026(R16): 상품 목록·엑셀 내보내기의 판매기간 필터.
-- private.admin_goods_console_matches(유일한 정의 20261020085132)에 p_filters 키 salePeriod(all|scheduled|ended)를 더한다.
-- 판정은 고객 화면의 판매기간 상태(private.goods_sale_period_json)와 같다: scheduled = 지금 < 시작, ended = 지금 >= 종료.
-- 기간이 없는 상품(무제한)과 판매 중인 상품은 둘 다 아니다. 판매중지와 품절의 구분은 데이터 모델 변경이라 범위 밖이다.
-- 목록(admin_search_goods_console)과 내보내기(admin_goods_console_export_candidates)가 이 함수 하나를 쓰므로 함께 반영된다.
begin;

do $patch$
declare definition text; anchor text; replacement text; patch record;
begin
 definition:=pg_get_functiondef('private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)'::regprocedure);
 for patch in select * from (values
  ('declare',
   $old$restriction_value text := coalesce(p_filters->>'restriction', 'all');$old$,
   $new$restriction_value text := coalesce(p_filters->>'restriction', 'all');
  sale_period_value text := coalesce(p_filters->>'salePeriod', 'all');$new$),
  ('keys',
   $old$('field','dateField','sort','payment','saleType','image','restriction','from','to','originId'))$old$,
   $new$('field','dateField','sort','payment','saleType','image','restriction','from','to','originId','salePeriod'))$new$),
  ('values',
   $old$or restriction_value not in ('all','none','adult')$old$,
   $new$or restriction_value not in ('all','none','adult')
    or sale_period_value not in ('all','scheduled','ended')$new$),
  ('predicate',
   $old$and (restriction_value = 'all' or (source.good).sale_restriction::text = restriction_value)$old$,
   $new$and (restriction_value = 'all' or (source.good).sale_restriction::text = restriction_value)
      and case sale_period_value
        when 'scheduled' then (source.good).sale_starts_at is not null and now() < (source.good).sale_starts_at
        when 'ended' then (source.good).sale_ends_at is not null and now() >= (source.good).sale_ends_at
        else true end$new$)
 ) supplied(name,old_text,new_text) loop
  anchor:=patch.old_text; replacement:=patch.new_text;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'goods_console_sale_period_anchor_changed: %',patch.name;
  end if;
  definition:=replace(definition,anchor,replacement);
 end loop;
 execute definition;
end $patch$;

-- create or replace는 ACL을 유지하지만 계약(postgres 전용)을 다시 봉인한다.
revoke all on function private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb) to postgres;

do $$declare fn regprocedure:='private.admin_goods_console_matches(text,text,text,text,uuid,text,jsonb)'::regprocedure;contract record;begin
 select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
 if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
 elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
  perform private.register_operator_internal_contract(fn);
 end if;
end $$;

commit;
notify pgrst,'reload schema';
