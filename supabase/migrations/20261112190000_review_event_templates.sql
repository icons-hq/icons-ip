-- SHEET-017(MD-0013 "리뷰이벤트에 탬플릿 등록 가능할까요?", 11/11 결정 "문구 템플릿 저장·불러오기").
-- 리뷰이벤트 이벤트명·내용 문구를 템플릿으로 저장·수정·삭제하고, 등록 화면에서 불러와 이벤트 칸에 복사한다.
-- 템플릿은 문구만 담는다(대상·기간·적립금·배너 없음). 불러온 문구는 복사본이라 템플릿을 고치거나 지워도
-- 이미 저장한 이벤트는 바뀌지 않는다. 적립금 정책과 무관하게 저장된다 — 정책 검사는 이벤트 저장
-- (public.admin_save_review_event)에만 있고 이 migration은 그 함수를 건드리지 않는다.
-- 길이·제어 문자 규칙은 이벤트 칸과 같고(private.review_event_values_valid), 앞뒤 공백은 앱 규칙(lib/review-events.ts의
-- text(): JS String.prototype.trim)과 같게 더 엄격히 본다 — btrim은 보통 공백만 자르므로 NBSP(U+00A0)·전각 공백(U+3000)·
-- BOM(U+FEFF)이 앞뒤에 남은 문구를 DB가 받으면 앱이 그 행을 읽지 못한다. 불러온 문구는 그대로 이벤트 저장 검사도 통과한다.

/** JS trim이 자르는 공백(ASCII 공백·제어 공백, 유니코드 공백 구분자 Zs, 줄·문단 구분자, BOM)이 앞뒤에 없어야 한다. */
create function private.review_event_template_text_valid(p_value text,p_max integer)
returns boolean language sql immutable set search_path='' as $$
 select p_value is not null and p_max is not null and char_length(p_value) between 1 and p_max and p_value!~'[[:cntrl:]]'
  and p_value!~E'^[\u0009\u000A\u000B\u000C\u000D    -     　﻿]'
  and p_value!~E'[\u0009\u000A\u000B\u000C\u000D    -     　﻿]$';
$$;
revoke all on function private.review_event_template_text_valid(text,integer) from public,anon,authenticated,service_role;

create table private.review_event_templates (
 id uuid primary key,
 title text not null check(private.review_event_template_text_valid(title,15)),
 description text not null check(private.review_event_template_text_valid(description,30)),
 revision integer not null default 1 check(revision>0),
 created_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null,
 updated_at timestamptz not null default clock_timestamp()
);
create index review_event_templates_updated_idx on private.review_event_templates(updated_at desc,id);
alter table private.review_event_templates enable row level security;
revoke all on private.review_event_templates from public,anon,authenticated,service_role;
comment on table private.review_event_templates is
 'Shared review-event wording templates (event title 1-15, description 1-30; no control characters and no leading/trailing whitespace as JS trim sees it, so every stored row loads in the app). Copied into the editor on load; no link to saved events. No direct client access; cs.manage RPCs only.';

create function private.review_event_template_document(p_row private.review_event_templates)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'title',p_row.title,'description',p_row.description,'revision',p_row.revision,
  'createdAt',p_row.created_at,'updatedAt',p_row.updated_at);
$$;
revoke all on function private.review_event_template_document(private.review_event_templates) from public,anon,authenticated,service_role;

create function public.admin_list_review_event_templates(p_query text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; needle text;
begin
 if not private.has_operator_capability(auth.uid(),'cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_review_event_template_search';end if;
 needle:=lower(btrim(p_query));
 with filtered as materialized (
  select t.id,t.updated_at from private.review_event_templates t
  where needle='' or strpos(lower(t.title),needle)>0 or strpos(lower(t.description),needle)>0),
 page as (select id,updated_at from filtered order by updated_at desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,
  'rows',coalesce((select jsonb_agg(private.review_event_template_document(t) order by t.updated_at desc,t.id)
   from private.review_event_templates t join page on page.id=t.id),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_list_review_event_templates(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_review_event_templates(text,integer) to authenticated;

-- 새 템플릿은 p_expected_revision=0, 수정은 읽은 revision이다. 같은 operation id 재요청은 같은 결과를 돌려주고
-- (운영자 감사 로그 재생), 다른 운영자가 먼저 바꾸거나 지웠으면 PT409로 덮어쓰기를 막는다.
create function public.admin_save_review_event_template(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_title text,p_description text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.review_event_templates; saved private.review_event_templates; request jsonb; receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'cs.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or private.review_event_template_text_valid(p_title,15) is distinct from true or private.review_event_template_text_valid(p_description,30) is distinct from true
 then raise invalid_parameter_value using message='invalid_review_event_template';end if;
 request:=jsonb_build_object('id',p_id,'expectedRevision',p_expected_revision,'title',p_title,'description',p_description);
 perform pg_advisory_xact_lock(hashtextextended('review-event-template:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.template.saved',request);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('review-event-template:'||p_id::text,0));
 select * into previous from private.review_event_templates where id=p_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='review_event_template_changed';end if;
 if previous.id is null then
  insert into private.review_event_templates(id,title,description,created_by,updated_by) values(p_id,p_title,p_description,actor,actor) returning * into saved;
 else
  update private.review_event_templates set title=p_title,description=p_description,revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
  where id=p_id returning * into saved;
 end if;
 receipt:=private.review_event_template_document(saved);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.template.saved','review_event_template:'||p_id,
  jsonb_build_object('request',request,'before',case when previous.id is null then null else private.review_event_template_document(previous) end,'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_review_event_template(uuid,integer,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_review_event_template(uuid,integer,uuid,text,text) to authenticated;

-- 삭제는 행을 지운다. 지운 문구는 감사 로그(before)에 남는다. 이미 불러와 저장한 이벤트 문구는 복사본이라 그대로다.
create function public.admin_delete_review_event_template(p_id uuid,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.review_event_templates; request jsonb; receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'cs.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 then raise invalid_parameter_value using message='invalid_review_event_template';end if;
 request:=jsonb_build_object('id',p_id,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('review-event-template:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.template.deleted',request);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('review-event-template:'||p_id::text,0));
 select * into previous from private.review_event_templates where id=p_id for update;
 if previous.id is null or previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='review_event_template_changed';end if;
 delete from private.review_event_templates where id=p_id;
 receipt:=jsonb_build_object('id',p_id,'deleted',true);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.template.deleted','review_event_template:'||p_id,
  jsonb_build_object('request',request,'before',private.review_event_template_document(previous),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_delete_review_event_template(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_delete_review_event_template(uuid,integer,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_list_review_event_templates(text,integer)'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_review_event_template(uuid,integer,uuid,text,text)'::regprocedure,'cs.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_delete_review_event_template(uuid,integer,uuid)'::regprocedure,'cs.manage','manual',false);
select private.register_operator_internal_contract('private.review_event_template_document(private.review_event_templates)'::regprocedure);
select private.register_operator_internal_contract('private.review_event_template_text_valid(text,integer)'::regprocedure);
notify pgrst,'reload schema';
