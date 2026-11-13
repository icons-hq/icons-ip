-- QA 라운드 2(T14d): 다른 예약 상품과 함께 묶인 배송 건이 그 상품의 예정일 때문에 입력한 새 날짜로 바뀌지 못해 지금 날짜와 같아지면
-- 제외 사유가 '이미 같은 발송 예정일(unchanged)'로 보였다(입력 날짜와 지금 날짜는 다른데도). 이 경우의 진짜 이유는 묶음 상품의 예정일이므로
-- other_preorder로 먼저 판정한다. 입력 날짜가 지금 날짜와 정말 같아서 바뀔 것이 없는 건(묶음 배송이어도)은 그대로 unchanged다.
-- 미리보기와 확정이 같은 계획 함수를 쓰므로 둘 다 바뀐다. 앵커 치환은 정확히 1회 일치해야 하고 아니면 migration이 멈춘다.
do $patch$
declare
  def text := pg_get_functiondef('private.goods_preorder_schedule_plan(text,uuid,date)'::regprocedure);
  anchor text := $a$    when d.new_date=d.current_date_value and not d.notice_only then 'unchanged'$a$;
  replacement text := $r$    when d.other_bound is not null and p_to_date<d.other_bound and p_to_date<>d.current_date_value
      and d.new_date=d.current_date_value and not d.notice_only then 'other_preorder'
    when d.new_date=d.current_date_value and not d.notice_only then 'unchanged'$r$;
begin
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'preorder_schedule_exclusion_reason_order anchor must match exactly once';
  end if;
  execute replace(def, anchor, replacement);
end
$patch$;

revoke all on function private.goods_preorder_schedule_plan(text,uuid,date) from public, anon, authenticated, service_role;
