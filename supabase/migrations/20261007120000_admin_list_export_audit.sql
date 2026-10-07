-- 주문·배송 목록 엑셀 다운로드 감사 기록 (MD 회의 2026-10-07 요청 ⑧).
--
-- 목록 파일에는 구매자·수령인·연락처·주소가 담긴다. 내려받을 때마다 누가·언제·
-- 어느 화면에서·어떤 조건으로·몇 건을 받았는지 audit_log에 남긴다. authenticated는
-- audit_log에 직접 쓸 수 없으므로(select만 허용) staff 검사가 붙은 정의자 함수로만
-- 기록한다. 서버 라우트는 이 기록이 성공해야 파일을 응답한다.

create function public.admin_record_list_export(
  p_screen text,
  p_filters jsonb,
  p_row_count integer,
  p_record_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recorded_id uuid;
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_screen is null or p_screen not in (
    'orders', 'unpaid', 'dispatch', 'shipping',
    'claims-cancels', 'claims-returns', 'claims-exchanges'
  ) then
    raise invalid_parameter_value using message = 'invalid_list_export_screen';
  end if;

  -- 조건은 화면이 정규화한 작은 객체다. 임의 크기의 문서를 감사 로그에 싣지 않는다.
  if p_filters is null
    or jsonb_typeof(p_filters) <> 'object'
    or octet_length(p_filters::text) > 2000
    or exists (
      select 1
      from jsonb_each(p_filters) as field(key, value)
      where length(field.key) > 40
        or jsonb_typeof(field.value) not in ('string', 'null')
    )
  then
    raise invalid_parameter_value using message = 'invalid_list_export_filters';
  end if;

  -- 앱의 한 파일 상한(10,000행)과 같은 값이다. 기록 건수가 행 수보다 많을 수 없다.
  if p_row_count is null or p_row_count not between 0 and 10000
    or p_record_count is null or p_record_count not between 0 and p_row_count
  then
    raise invalid_parameter_value using message = 'invalid_list_export_count';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor,
    'admin.list_export.downloaded',
    'admin_screen:' || p_screen,
    jsonb_build_object(
      'screen', p_screen,
      'filters', p_filters,
      'rowCount', p_row_count,
      'recordCount', p_record_count
    )
  )
  returning id into recorded_id;

  return recorded_id;
end;
$$;

revoke all on function public.admin_record_list_export(text, jsonb, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_record_list_export(text, jsonb, integer, integer)
  to authenticated;

comment on function public.admin_record_list_export(text, jsonb, integer, integer) is
  '주문·배송 목록 엑셀 다운로드 감사 기록. staff만 실행하며 actor는 auth.uid()로 고정한다.';
