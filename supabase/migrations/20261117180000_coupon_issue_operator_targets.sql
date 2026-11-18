-- 쿠폰 지정 발급(운영자가 고객을 골라 주는 발급)의 대상에 운영자 계정(staff·admin)을 더한다.
--
-- 2026-11-17 사용자 결정: 어드민에서 지정 고객 쿠폰을 시험하던 중 운영자 테스트 계정이 고객 조회에 나오지 않았다.
-- 원인은 조회(admin_find_coupon_issue_customers)와 발급 판정(private.coupon_issue_rows)이 일반 회원(role=user)만
-- 받던 정책이었다. 결정은 '운영자 계정도 발급 허용'이다.
--
-- 바뀌는 것은 운영자가 고객을 직접 고르는 지정 발급(고객 목록)뿐이다. 세그먼트 대상·매월 등급 쿠폰·카카오톡 채널
-- 친구 쿠폰·리뷰 보상처럼 '고객'을 자동으로 고르는 경로는 그대로 일반 회원만 받는다
-- (private.customer_segment_members·private.monthly_grade_coupon_recipient 등은 손대지 않는다).
-- 정지·탈퇴 봉인·온보딩 미완료·만 14세 미만은 운영자 계정이어도 지금처럼 받지 않는다.
-- 운영자가 자기 계정에 발급해도 발급 확인·실행은 지금과 같은 감사 로그(admin.coupon.issue_*)에 남는다.
--
-- 조회 결과에 operator(운영자 계정 여부)를 더해 화면이 '운영자 계정'임을 표시한다.

begin;

create or replace function public.admin_find_coupon_issue_customers(p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(btrim(p_query)) not between 2 and 200 then raise invalid_parameter_value;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'maskedEmail',case when strpos(email,'@')>0 then left(email,1)||'***@'||split_part(email,'@',2) else '' end,'operator',role<>'user'::public.user_role) order by nickname,id),'[]')
  from (select p.id,p.nickname,p.email,p.role from public.profiles p where p.role in ('user'::public.user_role,'staff'::public.user_role,'admin'::public.user_role) and p.suspended_at is null and p.onboarded_at is not null and p.birth_date<=((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '14 years')::date
   and not private.is_account_write_fenced(p.id) and (p.id::text=btrim(p_query) or lower(p.email)=lower(btrim(p_query)) or strpos(lower(p.nickname),lower(btrim(p_query)))>0)
   order by nickname,id limit 50) customers);
end $$;
revoke all on function public.admin_find_coupon_issue_customers(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_find_coupon_issue_customers(text) to authenticated;

-- 발급 판정은 매월 등급 쿠폰 migration(20261112180000)이 이미 앵커 치환으로 고친 본문이다. 같은 방식으로 역할 조건
-- 한 곳만 바꾼다 — 앵커가 정확히 한 번 나오지 않으면 멈춘다.
do $patch$
declare
  v_source text := pg_get_functiondef('private.coupon_issue_rows(public.coupons,uuid[])'::regprocedure);
  v_old constant text := $o$p.role<>'user'$o$;
  v_new constant text := $n$p.role not in ('user','staff','admin')$n$;
begin
  if (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'coupon_issue_rows role anchor must appear exactly once';
  end if;
  execute replace(v_source, v_old, v_new);
end;
$patch$;
revoke all on function private.coupon_issue_rows(public.coupons,uuid[]) from public,anon,authenticated,service_role;

select private.register_operator_rpc_contract('public.admin_find_coupon_issue_customers(text)'::regprocedure,'marketing.manage','read',false);

notify pgrst, 'reload schema';

commit;
