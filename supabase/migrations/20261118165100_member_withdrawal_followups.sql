-- 문의로 받은 회원 탈퇴 처리의 후속(원장 CUS-035·CUS-036 리뷰).
--
-- 1. 정지 회원도 '계정' 유형 1:1 문의로 탈퇴를 요청할 수 있게 좁게 연다. 다른 유형의 새 문의와 다른 보호 액션은 그대로 막고,
--    하루 20건 상한·본인 주문 연결 같은 기존 제한은 그대로다. 이어 쓰기도 계정 문의에만 허용한다(지금까지 DB는 정지 회원의
--    이어 쓰기를 따로 막지 않았다 — 앱만 막았다). 온보딩 미완료 회원은 DB가 원래 막지 않으므로 앱이 계정 문의만 연다.
-- 2. 탈퇴 처리 직후 남은 access token(최대 1시간)으로 PostgREST를 직접 불러 마케팅 정보 수신에 다시 동의하거나 재입고 알림을
--    신청하지 못하게 한다. 정지 회원은 동의 '켜기'(동의하지 않은 수단을 동의로 바꾸기)와 재입고 알림 신청만 거절한다 —
--    동의 철회는 언제나 받는다(정보통신망법 제50조). 회원이 consents.marketing을 직접 쓰는 옛 경로도 켜는 값은 받지 않는다.
-- 3. 처리 전 확인창이 문의 번호의 제목·유형·작성일을 대조할 수 있게 읽기 RPC를 둔다.
begin;

create function private.t10_followup_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't10 followup patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1-a. 새 문의: 정지 회원은 '계정' 유형만 접수한다.
select private.t10_followup_patch_function('private.create_inquiry_before_system_notice(text,text,text,uuid,text,text[])'::regprocedure, array[
$a$      and profile.suspended_at is not null
  ) then
    raise insufficient_privilege using message = 'account_suspended';$a$,
$a$      and profile.suspended_at is not null
  ) and v_category <> 'account' then
    -- 정지 회원은 계정 문의(탈퇴 요청·정지 문의)만 접수한다 — 탈퇴 경로가 막히지 않게(원장 CUS-035).
    raise insufficient_privilege using message = 'account_suspended';$a$
]);

-- 1-b. 이어 쓰기: 정지 회원은 자기 계정 문의에만 이어 쓴다.
select private.t10_followup_patch_function('public.append_inquiry_message(uuid,text,text[])'::regprocedure, array[
$a$  if v_status = 'closed' then$a$,
$a$  -- 정지 회원은 계정 문의(탈퇴 요청·정지 문의)에만 이어 쓴다.
  if exists (select 1 from public.profiles as profile where profile.id = v_actor and profile.suspended_at is not null)
    and (select thread.category from public.inquiries as thread where thread.id = target_inquiry_id) <> 'account' then
    raise insufficient_privilege using message = 'account_suspended';
  end if;

  if v_status = 'closed' then$a$
]);

-- 2-a. 마케팅 정보 수신 동의: 정지 회원은 동의하지 않은 수단을 새로 켜지 못한다. 철회·이미 동의 중인 수단 유지는 받는다.
select private.t10_followup_patch_function('public.set_my_marketing_consents(boolean,boolean,text,text)'::regprocedure, array[
$a$ if not found then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;$a$,
$a$ if not found then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 -- 정지 회원은 새로 동의할 수 없다(탈퇴 처리 직후 남은 토큰 포함). 철회는 언제나 받는다.
 if exists(select 1 from public.profiles p where p.id=actor and p.suspended_at is not null)
  and ((p_email and not exists(select 1 from private.customer_marketing_consents c where c.user_id=actor and c.channel='email' and c.agreed))
   or (p_sms and not exists(select 1 from private.customer_marketing_consents c where c.user_id=actor and c.channel='sms' and c.agreed))) then
  raise insufficient_privilege using message='account_suspended'; end if;$a$
]);
select private.t10_followup_patch_function('public.set_my_marketing_consents_v2(boolean,boolean,boolean,text,text)'::regprocedure, array[
$a$ if not found then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;$a$,
$a$ if not found then raise insufficient_privilege using message='marketing_consent_auth_required'; end if;
 -- 정지 회원은 새로 동의할 수 없다(탈퇴 처리 직후 남은 토큰 포함). 철회는 언제나 받는다.
 if exists(select 1 from public.profiles p where p.id=actor and p.suspended_at is not null)
  and ((p_email and not exists(select 1 from private.customer_marketing_consents c where c.user_id=actor and c.channel='email' and c.agreed))
   or (p_sms and not exists(select 1 from private.customer_marketing_consents c where c.user_id=actor and c.channel='sms' and c.agreed))
   or (p_kakao and not exists(select 1 from private.customer_marketing_consents c where c.user_id=actor and c.channel='kakao' and c.agreed))) then
  raise insufficient_privilege using message='account_suspended'; end if;$a$
]);
-- 회원이 consents.marketing을 직접 쓰는 옛 경로(Data API 열 권한)도 정지 중에는 켜는 값을 받지 않는다(이전 값을 유지한다).
select private.t10_followup_patch_function('private.keep_marketing_consent_shape()'::regprocedure, array[
$a$ end if;
 return new;$a$,
$a$ end if;
 if new.suspended_at is not null and new.consents->'marketing' = 'true'::jsonb
  and old.consents->'marketing' is distinct from 'true'::jsonb then
  new.consents:=jsonb_set(coalesce(new.consents,'{}'::jsonb),'{marketing}',coalesce(old.consents->'marketing','false'::jsonb),true);
 end if;
 return new;$a$
]);

-- 2-b. 재입고 알림: 정지 회원의 신청은 받지 않는다(알림·메일이 정지와 무관하게 나가므로).
select private.t10_followup_patch_function('public.request_restock_alert(text)'::regprocedure, array[
$a$    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;$a$,
$a$    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;

  if exists (select 1 from public.profiles as profile where profile.id = actor_id and profile.suspended_at is not null) then
    raise insufficient_privilege using message = 'account_suspended';
  end if;$a$
]);
select private.t10_followup_patch_function('public.request_variant_restock_alert(text,uuid)'::regprocedure, array[
$a$    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;$a$,
$a$    raise object_not_in_prerequisite_state using message = 'account_deletion_write_fenced';
  end if;

  if exists (select 1 from public.profiles as profile where profile.id = actor_id and profile.suspended_at is not null) then
    raise insufficient_privilege using message = 'account_suspended';
  end if;$a$
]);

-- 3. 처리 전 대조용 문의 요약. 그 회원이 쓴 문의가 아니면 null이다. STABLE이라 잠그는 권한 검사를 쓰지 않는다.
create function public.admin_member_withdrawal_inquiry(target_profile_id uuid, target_inquiry_reference bigint)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_operator_capability('platform.manage', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if target_profile_id is null or target_inquiry_reference is null or target_inquiry_reference < 1 then
    raise invalid_parameter_value using message = 'invalid_member_withdrawal';
  end if;
  return (select jsonb_build_object('reference', i.reference, 'category', i.category, 'title', i.title,
      'status', i.status, 'createdAt', i.created_at)
    from public.inquiries i where i.reference = target_inquiry_reference and i.user_id = target_profile_id);
end $$;
alter function public.admin_member_withdrawal_inquiry(uuid, bigint) owner to postgres;
revoke all on function public.admin_member_withdrawal_inquiry(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_member_withdrawal_inquiry(uuid, bigint) to authenticated;
select private.register_operator_rpc_contract('public.admin_member_withdrawal_inquiry(uuid,bigint)'::regprocedure, 'platform.manage', 'read', false);

drop function private.t10_followup_patch_function(regprocedure, text[]);

notify pgrst, 'reload schema';

commit;
