-- 초안 URL을 바꾸면 FK의 ON UPDATE CASCADE가 이미 만든 테스트 주문까지 바꾼다.
-- 기존 SKU를 예약 주소로 옮기거나 그 주소에서 다른 주소로 옮기는 작업은 모두 막는다.
begin;
do $$
declare
  target constant regprocedure := 'private.guard_goods_public_slug()'::regprocedure;
  definition text := pg_get_functiondef(target);
  anchor constant text := $old$  if tg_op='UPDATE' then$old$;
begin
  if (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then
    raise exception 'admin payment test identity migration anchor changed';
  end if;
  execute replace(definition, anchor, anchor || $new$
    if new.id is distinct from old.id and 'admin-payment-test' in (old.id, new.id) then
      raise check_violation using message='payment_test_slug_locked';
    end if;$new$);
  if exists (select 1 from private.operator_internal_contracts where signature::regprocedure=target) then
    perform private.register_operator_internal_contract(target);
  end if;
end $$;
commit;
