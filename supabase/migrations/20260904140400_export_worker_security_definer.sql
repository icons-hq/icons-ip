-- D-4 ⑤ — 워커 함수를 security definer 로 (설계서 v2 §1-7)
--
-- 워커 함수는 execute 권한(service_role 전용)으로 이미 잠겨 있지만, 표 자체에는 어느 역할도
-- 쓰기 권한이 없다(쓰기는 RPC 로만). 그래서 함수가 호출자 권한으로 돌면 자기 표를 못 만진다 —
-- 이 프로젝트의 다른 처리 함수들과 같게 definer 로 돌리고, 잠금은 execute grant 가 맡는다.

alter function public.claim_export_job(text) security definer;
alter function public.finish_export_job(uuid, text, integer, bigint, text) security definer;
alter function public.fail_export_job(uuid, text) security definer;
alter function public.requeue_stale_export_jobs() security definer;
alter function public.export_rows_for_job(uuid, jsonb, integer) security definer;
alter function private.export_rows(uuid, jsonb, jsonb, integer, boolean) security definer;

-- 워커가 양식의 열 정의를 읽어야 파일을 만든다. 양식은 설정이지 개인정보가 아니므로
-- 서버 신뢰 경계(service role)에 읽기만 연다 — 쓰기는 그대로 RPC 뿐이다.
grant select on public.export_templates to service_role;
