-- R6 (10/27 회의 후속): 리뷰이벤트 등록·상세 화면이 적립금 정책 상태를 보여 주려면 cs.manage 운영자가
-- 정책을 읽을 수 있어야 한다. 기존 admin_get_store_credit_policy()는 marketing.manage + profiles.role='admin'
-- 전용이라 deputy·influencer·agency 운영자는 등록 화면에서 정책이 꺼져 있는지 알 방법이 없었다.
-- 이 함수는 리뷰이벤트 저장 검사(admin_save_review_event)가 보는 세 값만 돌려준다. 정책 쓰기 권한은 바꾸지 않는다.
create function public.admin_review_event_credit_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return (select jsonb_build_object('enabled',enabled,'maxBalance',max_balance,'validityDays',validity_days) from private.store_credit_policy where singleton);
end $$;
revoke all on function public.admin_review_event_credit_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_review_event_credit_policy() to authenticated;
select private.register_operator_rpc_contract('public.admin_review_event_credit_policy()'::regprocedure,'cs.manage','read',false);
notify pgrst,'reload schema';
