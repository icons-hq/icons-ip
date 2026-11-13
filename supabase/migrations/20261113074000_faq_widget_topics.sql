-- 0901-044 상담 위젯의 '버튼형 자주 묻는 질문'(2026-11-11 사용자 결정 "버튼형 자주 묻는 질문 (Recommended)").
--
-- 고객 상담 위젯의 FAQ 위에 유형 버튼(배송 언제 오나요·취소·교환/반품)을 두고, 누르면 그 유형의 대표 FAQ를
-- 바로 보여 준다. 대표 FAQ는 운영자가 FAQ 관리에서 지정한다. 지정하지 않았거나 지정한 FAQ가 비공개면
-- 위젯은 연결된 카테고리의 공개 FAQ 목록을 대신 보인다(앱 lib/faq.server.ts).
--
-- 답변 문구의 정본은 운영 FAQ다. 이 migration은 '어느 FAQ가 어느 버튼의 답인가'만 저장한다.
--
-- 저장 경로:
--   · 본문 저장은 기존 public.admin_save_faq_entry를 그대로 부른다 — 검증·동시 수정 409(faq_conflict)·
--     감사(faq.create/faq.update)가 한 벌로 남는다(20261110130000의 단건 RPC 재사용과 같은 방식).
--   · 같은 트랜잭션에서 버튼 지정을 바꾼다. 버튼마다 대표는 하나라서(부분 유일 인덱스) 다른 FAQ가 가진
--     버튼을 지정하면 그 FAQ의 지정을 풀고, 그 FAQ의 열린 편집 폼이 옛 지정으로 되돌리지 못하게 updated_at을
--     올린다(다음 저장은 faq_conflict). 지정 변경은 faq.widget_topic으로 감사한다.
--   · 버튼 지정 변경은 전역 advisory 잠금으로 직렬화한다. 두 운영자가 같은 버튼을 동시에 지정해도 유일 인덱스
--     위반 오류 대신 나중 저장이 이기고, 두 FAQ의 지정을 맞바꾸는 동시 저장도 교착에 빠지지 않는다.
--
-- 공개 읽기는 기존 RLS(faq_published_read)와 표 SELECT 권한을 그대로 쓴다. 새 열은 공개 FAQ의 메타데이터다.

begin;

alter table public.faq_entries
  add column widget_topic text;

alter table public.faq_entries
  add constraint faq_entries_widget_topic_check
  check (widget_topic is null or widget_topic in ('delivery', 'cancel', 'return'));

comment on column public.faq_entries.widget_topic is
  '상담 위젯 FAQ 위 유형 버튼의 대표 답변 지정(delivery=배송 언제 오나요, cancel=취소, return=교환/반품). 버튼마다 하나. 공개 FAQ만 고객에게 보인다.';

create unique index faq_entries_widget_topic_key
  on public.faq_entries (widget_topic)
  where widget_topic is not null;

create function public.admin_save_faq_entry_with_widget_topic(
  target_id uuid,
  target_category text,
  target_question text,
  target_answer text,
  target_sort_order integer,
  target_published boolean,
  expected_updated_at timestamptz,
  target_widget_topic text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  saved_id uuid;
  previous_topic text;
  displaced_id uuid;
begin
  perform private.require_operator_capability('cs.manage', false);

  if actor is null or not public.has_operator_capability('cs.manage', false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_widget_topic is not null and target_widget_topic not in ('delivery', 'cancel', 'return') then
    raise invalid_parameter_value using message = 'invalid_faq_widget_topic';
  end if;

  -- 버튼을 지정하는 저장끼리는 줄을 세운다(잠금 전에는 어떤 FAQ 행도 잡지 않는다).
  if target_widget_topic is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.faq_entries.widget_topic', 0));
  end if;

  saved_id := public.admin_save_faq_entry(
    target_id, target_category, target_question, target_answer,
    target_sort_order, target_published, expected_updated_at
  );

  select entry.widget_topic into previous_topic
  from public.faq_entries as entry
  where entry.id = saved_id
  for update;

  if previous_topic is not distinct from target_widget_topic then
    return saved_id;
  end if;

  if target_widget_topic is not null then
    update public.faq_entries as entry
    set widget_topic = null,
      updated_at = greatest(clock_timestamp(), entry.updated_at + interval '1 microsecond')
    where entry.widget_topic = target_widget_topic
      and entry.id <> saved_id
    returning entry.id into displaced_id;

    if displaced_id is not null then
      insert into public.audit_log(actor_id, action, target, diff)
      values (actor, 'faq.widget_topic', 'faq:' || displaced_id::text,
        jsonb_build_object('before', target_widget_topic, 'after', null, 'replacedBy', saved_id));
    end if;
  end if;

  update public.faq_entries
  set widget_topic = target_widget_topic
  where id = saved_id;

  insert into public.audit_log(actor_id, action, target, diff)
  values (actor, 'faq.widget_topic', 'faq:' || saved_id::text,
    jsonb_build_object('before', previous_topic, 'after', target_widget_topic, 'replaced', displaced_id));

  return saved_id;
end;
$$;

revoke all on function public.admin_save_faq_entry_with_widget_topic(uuid, text, text, text, integer, boolean, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_faq_entry_with_widget_topic(uuid, text, text, text, integer, boolean, timestamptz, text)
  to authenticated;

select private.register_operator_rpc_contract(
  'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamp with time zone,text)'::regprocedure,
  'cs.manage',
  'write',
  false
);

commit;
