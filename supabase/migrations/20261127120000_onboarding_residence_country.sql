begin;

-- 기존 회원은 미수집(NULL) 그대로 두고, 신규 가입은 사용자가 선택한 ISO 3166-1 alpha-2 코드만 받는다.
alter table public.profiles
  add column residence_country_code text
  constraint profiles_residence_country_code_valid check (residence_country_code is null or (birth_date is not null and residence_country_code in (
    'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX',
    'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ',
    'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK',
    'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
    'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
    'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS',
    'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN',
    'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
    'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
    'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ',
    'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI',
    'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
    'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC',
    'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV',
    'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR',
    'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
    'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
  )));

-- profiles의 기존 self-only SELECT/UPDATE RLS와 열 단위 권한을 사용한다.
grant select (residence_country_code), update (residence_country_code) on public.profiles to authenticated;

-- 탈퇴 익명화가 생년월일을 파기하는 동일 쓰기에서 거주 국가도 제거한다.
create function private.guard_member_residence_country() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.birth_date is null then
    new.residence_country_code := null;
  elsif old.onboarded_at is not null and new.residence_country_code is null then
    raise check_violation using message = 'onboarding_residence_country_required';
  end if;
  return new;
end $$;
revoke all on function private.guard_member_residence_country() from public, anon, authenticated, service_role;
create trigger profiles_guard_member_residence_country before update of birth_date, residence_country_code on public.profiles
  for each row when (old.residence_country_code is not null and (new.birth_date is null or new.residence_country_code is null))
  execute function private.guard_member_residence_country();

-- DB가 앱보다 먼저 배포되는 동안 기존 서버도 완료할 수 있게 기존 RPC를 보존한다.
create function public.service_complete_member_onboarding_v2(p_user_id uuid, p_require_phone boolean)
returns timestamptz language plpgsql volatile security invoker set search_path = '' as $$
declare
  member record;
begin
  select p.residence_country_code, p.onboarded_at into member
  from public.profiles p where p.id = p_user_id for update;
  if found and member.onboarded_at is null and member.residence_country_code is null then
    raise check_violation using message = 'onboarding_residence_country_required';
  end if;
  return public.service_complete_member_onboarding(p_user_id, p_require_phone);
end $$;
revoke all on function public.service_complete_member_onboarding_v2(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.service_complete_member_onboarding_v2(uuid, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
