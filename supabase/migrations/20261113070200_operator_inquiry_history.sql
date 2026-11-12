-- 1014-105 운영자별 처리 이력.
-- 원래 요청(10/14 회의): "히스토리를 (불명확) 수 있어요? / 네네네. 혼내려는 건 아니에요." — 앞뒤 맥락은 "누가 남겼는지 계정별로",
-- "자기 이름 뜨게, 남아서 기록 뜨게".
-- 사용자 결정(2026-11-12 묶음 18) "운영자별 처리 이력" — 누가 언제 답변·완료했는지 운영자별 목록.
-- 오케스트레이터 판단(위임 원칙 ③·④): 운영자별 집계 목록은 운영자 관리 권한(operators.manage — 통합·주매니저, 호환 단계 admin)
-- 으로만 열고 열람을 감사한다(운영자 활동 기록이라 개인정보 쪽이 안전한 선택). 좁힘을 피하려고 문의마다의 처리 이력
-- (담당 지정·변경·답변·완료 — 누가·언제)은 그 문의를 열 수 있는 모든 운영자(cs.manage)에게 보인다.
--
-- 처리 기록의 원본은 이미 쌓이는 감사 기록이다: admin.inquiry.answered(답변 — 문의 관리 답변과 상담하기 전송 모두),
-- admin.inquiry.closed(완료), admin.inquiry.reassigned(담당 변경·인계), admin.inquiry.assigned(첫 답변으로 담당 자동 지정).
-- 7일 무응답 자동 종결은 감사 기록이 없어 문의의 종결 시각으로 '자동 종결'을 보인다. 새 기록 표나 트리거를 만들지 않는다.
-- 운영자별 집계는 답변·완료·담당 변경만 센다(첫 답변 자동 지정은 답변의 결과라 따로 세지 않는다).
--
-- 순서: 첫 답변의 담당 지정(트리거)과 답변 감사는 한 트랜잭션의 now()라 시각이 같다. 시각이 같으면 처리 순서
-- (담당 지정 0 → 답변 1 → 담당 변경 2 → 완료 3)로 정하고, 그다음에야 감사 ID로 고정한다(ID만으로는 순서가 무작위다).

-- 집계·운영자별 목록이 감사 기록 전체를 훑지 않게 문의 처리 기록만 담는 부분 인덱스를 둔다.
create index audit_log_inquiry_processing_idx on public.audit_log (created_at, actor_id)
  where action in ('admin.inquiry.answered', 'admin.inquiry.closed', 'admin.inquiry.reassigned');

-- 문의 하나의 처리 이력. 문의를 여는 운영자(cs.manage) 누구나 읽는다. 읽기만 하므로 STABLE이고 열람 감사는 남기지 않는다
-- (그 문의의 메시지·내부 메모·담당자와 같은 범위다). 이름은 다른 문의 화면과 같은 표시명 규칙(닉네임, 없으면 '운영자_' + ID 앞 6자리)을 쓴다.
create function public.admin_inquiry_processing_history(target_inquiry_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  thread public.inquiries;
  events jsonb;
  total integer;
  event_limit constant integer := 100;
begin
  if not public.has_operator_capability('cs.manage') then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if target_inquiry_id is null then
    raise invalid_parameter_value using message = 'inquiry_history_invalid';
  end if;
  select * into thread from public.inquiries where id = target_inquiry_id;
  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  select count(*) into total from public.audit_log a
  where a.target = 'inquiries:' || thread.id::text
    and a.action in ('admin.inquiry.assigned', 'admin.inquiry.reassigned', 'admin.inquiry.answered', 'admin.inquiry.closed');

  with picked as (
    select a.id, a.created_at, a.action, a.actor_id, a.diff,
      case a.action when 'admin.inquiry.assigned' then 0 when 'admin.inquiry.answered' then 1
        when 'admin.inquiry.reassigned' then 2 else 3 end as step,
      case when a.diff->>'before' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.diff->>'before')::uuid end as before_id,
      case when a.diff->>'after' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.diff->>'after')::uuid end as after_id
    from public.audit_log a
    where a.target = 'inquiries:' || thread.id::text
      and a.action in ('admin.inquiry.assigned', 'admin.inquiry.reassigned', 'admin.inquiry.answered', 'admin.inquiry.closed')
    order by a.created_at desc,
      case a.action when 'admin.inquiry.assigned' then 0 when 'admin.inquiry.answered' then 1
        when 'admin.inquiry.reassigned' then 2 else 3 end desc,
      a.id desc
    limit event_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id::text,
      'at', p.created_at,
      'kind', case p.action when 'admin.inquiry.assigned' then 'assigned' when 'admin.inquiry.reassigned' then 'reassigned'
        when 'admin.inquiry.answered' then 'answered' else 'closed' end,
      'actorName', case when p.actor_id is null then null
        else coalesce(nullif(btrim(actor.nickname), ''), '운영자_' || left(p.actor_id::text, 6)) end,
      'fromName', case when p.action = 'admin.inquiry.reassigned' and p.before_id is not null
        then coalesce(nullif(btrim(before_profile.nickname), ''), '운영자_' || left(p.before_id::text, 6)) end,
      'toName', case when p.action in ('admin.inquiry.reassigned', 'admin.inquiry.assigned') and p.after_id is not null
        then coalesce(nullif(btrim(after_profile.nickname), ''), '운영자_' || left(p.after_id::text, 6)) end,
      'reason', case when p.action = 'admin.inquiry.reassigned' then nullif(btrim(p.diff->>'reason'), '') end
    ) order by p.created_at, p.step, p.id), '[]'::jsonb)
  into events
  from picked p
  left join public.profiles actor on actor.id = p.actor_id
  left join public.profiles before_profile on before_profile.id = p.before_id
  left join public.profiles after_profile on after_profile.id = p.after_id;

  -- 자동 종결(close_stale_answered_inquiries)은 실행자가 없어 감사 기록이 없다. 운영자 완료 기록이 없는 종결 문의만 종결 시각으로 보인다.
  if thread.status = 'closed' and thread.closed_at is not null and not exists (
    select 1 from public.audit_log a where a.target = 'inquiries:' || thread.id::text and a.action = 'admin.inquiry.closed'
  ) then
    events := events || jsonb_build_array(jsonb_build_object('id', 'auto-close:' || thread.id::text, 'at', thread.closed_at,
      'kind', 'auto_closed', 'actorName', null, 'fromName', null, 'toName', null, 'reason', null));
    total := total + 1;
  end if;

  return jsonb_build_object('inquiryId', thread.id, 'events', events, 'total', total, 'limit', event_limit);
end $$;

-- 운영자별 처리 이력. 운영자 관리 권한으로만 열고 열람마다 감사 기록(admin.operator.inquiry_history_viewed)을 남긴다.
-- 기간은 한국 날짜(양 끝 포함) 최대 366일이다. p_operator를 주면 그 운영자의 처리 목록(최신순 50건씩)을 함께 돌려준다.
-- 감사 기록을 쓰므로 VOLATILE이다.
create function public.admin_operator_inquiry_history(p_from date, p_to date, p_operator uuid default null, p_page integer default 1)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid;
  range_start timestamptz;
  range_end timestamptz;
  summary jsonb;
  detail jsonb := null;
  total bigint;
  page integer := null;
  page_size constant integer := 50;
begin
  actor := private.require_operator_capability('operators.manage');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise invalid_parameter_value using message = 'operator_inquiry_history_range_invalid';
  end if;
  range_start := p_from::timestamp at time zone 'Asia/Seoul';
  range_end := (p_to + 1)::timestamp at time zone 'Asia/Seoul';

  with grouped as (
    select a.actor_id,
      count(*) filter (where a.action = 'admin.inquiry.answered') as answers,
      count(*) filter (where a.action = 'admin.inquiry.closed') as closes,
      count(*) filter (where a.action = 'admin.inquiry.reassigned') as reassignments,
      count(distinct a.target) as inquiries,
      max(a.created_at) as last_at
    from public.audit_log a
    where a.action in ('admin.inquiry.answered', 'admin.inquiry.closed', 'admin.inquiry.reassigned')
      and a.created_at >= range_start and a.created_at < range_end
      and a.actor_id is not null and a.target like 'inquiries:%'
    group by a.actor_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'operatorId', g.actor_id,
      'name', coalesce(nullif(btrim(p.nickname), ''), '운영자_' || left(g.actor_id::text, 6)),
      'managerRole', m.manager_role,
      'answers', g.answers, 'closes', g.closes, 'reassignments', g.reassignments,
      'inquiries', g.inquiries, 'lastAt', g.last_at
    ) order by g.last_at desc, g.actor_id), '[]'::jsonb)
  into summary
  from grouped g
  left join public.profiles p on p.id = g.actor_id
  left join private.operator_memberships m on m.profile_id = g.actor_id;

  if p_operator is not null then
    select count(*) into total from public.audit_log a
    where a.actor_id = p_operator
      and a.action in ('admin.inquiry.answered', 'admin.inquiry.closed', 'admin.inquiry.reassigned')
      and a.created_at >= range_start and a.created_at < range_end
      and a.target like 'inquiries:%';
    page := least(greatest(coalesce(p_page, 1), 1), greatest(1, (total + page_size - 1) / page_size)::integer);
    select jsonb_build_object(
      'operatorId', p_operator,
      'name', coalesce(nullif(btrim(op.nickname), ''), '운영자_' || left(p_operator::text, 6)),
      'page', page, 'pageSize', page_size, 'total', total,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', r.id::text,
            'at', r.created_at,
            'kind', case r.action when 'admin.inquiry.reassigned' then 'reassigned' when 'admin.inquiry.answered' then 'answered' else 'closed' end,
            'inquiryId', i.id, 'reference', i.reference, 'title', i.title, 'status', i.status,
            'fromName', case when r.action = 'admin.inquiry.reassigned' and r.before_id is not null
              then coalesce(nullif(btrim(before_profile.nickname), ''), '운영자_' || left(r.before_id::text, 6)) end,
            'toName', case when r.action = 'admin.inquiry.reassigned' and r.after_id is not null
              then coalesce(nullif(btrim(after_profile.nickname), ''), '운영자_' || left(r.after_id::text, 6)) end
          ) order by r.created_at desc, r.step desc, r.id desc)
        from (
          select a.id, a.created_at, a.action,
            case a.action when 'admin.inquiry.answered' then 1 when 'admin.inquiry.reassigned' then 2 else 3 end as step,
            case when a.target ~* '^inquiries:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(a.target, 11)::uuid end as inquiry_id,
            case when a.diff->>'before' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.diff->>'before')::uuid end as before_id,
            case when a.diff->>'after' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.diff->>'after')::uuid end as after_id
          from public.audit_log a
          where a.actor_id = p_operator
            and a.action in ('admin.inquiry.answered', 'admin.inquiry.closed', 'admin.inquiry.reassigned')
            and a.created_at >= range_start and a.created_at < range_end
            and a.target like 'inquiries:%'
          order by a.created_at desc,
            case a.action when 'admin.inquiry.answered' then 1 when 'admin.inquiry.reassigned' then 2 else 3 end desc,
            a.id desc
          limit page_size offset (page - 1) * page_size
        ) r
        left join public.inquiries i on i.id = r.inquiry_id
        left join public.profiles before_profile on before_profile.id = r.before_id
        left join public.profiles after_profile on after_profile.id = r.after_id
      ), '[]'::jsonb))
    into detail
    from (select 1) as one
    left join public.profiles op on op.id = p_operator;
  end if;

  insert into public.audit_log(actor_id, action, target, diff)
  values (actor, 'admin.operator.inquiry_history_viewed', 'operators:inquiry_history',
    jsonb_build_object('from', p_from, 'to', p_to, 'operatorId', p_operator, 'page', page));

  return jsonb_build_object('from', p_from, 'to', p_to, 'operators', summary, 'detail', detail);
end $$;

revoke all on function public.admin_inquiry_processing_history(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_inquiry_processing_history(uuid) to authenticated;
revoke all on function public.admin_operator_inquiry_history(date, date, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_operator_inquiry_history(date, date, uuid, integer) to authenticated;

select private.register_operator_rpc_contract('public.admin_inquiry_processing_history(uuid)'::regprocedure, 'cs.manage', 'read', false);
select private.register_operator_rpc_contract('public.admin_operator_inquiry_history(date,date,uuid,integer)'::regprocedure, 'operators.manage', 'read', false);

notify pgrst, 'reload schema';
