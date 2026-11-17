-- 캠페인 노출 설정(스펙 C §4.3): EVENT·POP-UP 어디에 보일지, POP-UP 장소, 카드·배너 바로가기.
--
-- 캠페인 본문(public.campaigns, admin_upsert_campaign)은 건드리지 않는다. 노출 설정은 캠페인 저장과 별개로
-- admin_save_campaign_presentation 한 곳에서만 쓴다(권한 promotion.manage, 감사 기록).
--  * popup_mode 가 있으면 POP-UP 캠페인이다(온라인·오프라인·온·오프라인). 없으면 EVENT 에 보인다.
--  * popup_location 은 POP-UP 일 때만 의미가 있다(고객 화면 기간 옆 한 줄).
--  * card_link_path 가 있으면 EVENT·POP-UP 카드와 배너가 캠페인 랜딩 대신 그 사이트 안 경로로 바로 간다.
-- 캠페인 id 는 admin_upsert_campaign 이 바꿀 수 없다(target_previous_id 가 다르면 catalog_id_immutable). 그래도
-- on update cascade 로 직접 id 가 바뀌어도 행이 따라간다.
begin;

create table public.campaign_presentations (
  campaign_id text primary key references public.campaigns(id) on update cascade on delete cascade,
  popup_mode text check (popup_mode in ('online', 'offline', 'hybrid')),
  popup_location text check (popup_location is null or char_length(popup_location) between 1 and 120),
  card_link_path text check (card_link_path is null or (char_length(card_link_path) <= 300 and card_link_path ~ '^/(?![/\\])[^\s]*$')),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (popup_mode is not null or popup_location is null)
);

-- 읽기 노출은 캠페인과 같다: 게시된(draft 가 아닌) 캠페인의 행은 공개, draft 캠페인의 행은 promotion.manage 운영자만.
-- 정책 식은 campaigns_public_read 와 같은 모양(운영자 식별은 has_operator_capability 로만 — is_staff 분기 금지)이고
-- 운영자 정책 계약에 등록한다.
alter table public.campaign_presentations enable row level security;
create policy campaign_presentations_public_read on public.campaign_presentations
  for select
  to anon, authenticated
  using (exists(
    select 1 from public.campaigns c
    where c.id = campaign_id
      and (c.status <> 'draft' or (select public.has_operator_capability('promotion.manage')))
  ));

-- 쓰기 정책은 두지 않는다. 쓰기는 admin_save_campaign_presentation(소유자 권한 definer)만 지난다.
revoke all on table public.campaign_presentations from public, anon, authenticated, service_role;
grant select on table public.campaign_presentations to anon, authenticated;

-- 저장: 값을 정리하고(공백 제거·빈 문자열 → null) 모두 비면 행을 지운다. 감사 기록에 전후 값을 남긴다.
-- 머리말은 admin_upsert_campaign 과 같은 순서다(운영자 권한 → 인증 → 권한 재확인). 캠페인 행을 잠가
-- 같은 캠페인의 동시 저장이 직렬화되게 하고, 감사 기록의 이전 값이 어긋나지 않게 한다.
create function public.admin_save_campaign_presentation(
  target_campaign_id text,
  target_popup_mode text,
  target_popup_location text,
  target_card_link_path text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_id text := btrim(coalesce(target_campaign_id, ''), E' \t\n\r\f\v');
  normalized_mode text := nullif(btrim(coalesce(target_popup_mode, ''), E' \t\n\r\f\v'), '');
  normalized_location text := nullif(btrim(coalesce(target_popup_location, ''), E' \t\n\r\f\v'), '');
  normalized_link text := nullif(btrim(coalesce(target_card_link_path, ''), E' \t\n\r\f\v'), '');
  before_value jsonb;
  after_value jsonb;
begin
  perform private.require_operator_capability('promotion.manage', false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('promotion.manage', false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform 1 from public.campaigns where id = normalized_id for update;

  if not found then
    raise exception 'campaign_not_found' using errcode = 'P0002';
  end if;

  -- POP-UP 에 싣지 않으면 장소도 없다.
  if normalized_mode is null then
    normalized_location := null;
  end if;

  if (normalized_mode is not null and normalized_mode not in ('online', 'offline', 'hybrid'))
    or (normalized_location is not null and char_length(normalized_location) > 120)
    or (normalized_link is not null
      and (char_length(normalized_link) > 300 or normalized_link !~ '^/(?![/\\])[^\s]*$')) then
    raise exception 'invalid_campaign_presentation' using errcode = '22023';
  end if;

  select jsonb_build_object('popupMode', p.popup_mode, 'popupLocation', p.popup_location, 'cardLinkPath', p.card_link_path)
  into before_value
  from public.campaign_presentations p
  where p.campaign_id = normalized_id;

  if normalized_mode is null and normalized_location is null and normalized_link is null then
    delete from public.campaign_presentations where campaign_id = normalized_id;
    after_value := null;
  else
    insert into public.campaign_presentations (campaign_id, popup_mode, popup_location, card_link_path, updated_at, updated_by)
    values (normalized_id, normalized_mode, normalized_location, normalized_link, now(), actor_id)
    on conflict (campaign_id) do update set
      popup_mode = excluded.popup_mode,
      popup_location = excluded.popup_location,
      card_link_path = excluded.card_link_path,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
    after_value := jsonb_build_object('popupMode', normalized_mode, 'popupLocation', normalized_location, 'cardLinkPath', normalized_link);
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.campaign.presentation_saved',
    'campaigns:' || normalized_id,
    jsonb_build_object('before', before_value, 'after', after_value)
  );
end;
$$;

-- 새 public 함수는 네 롤 모두에서 걷은 뒤 필요한 롤에만 연다(Supabase 기본 권한이 anon·service_role 까지 자동 부여한다).
revoke all on function public.admin_save_campaign_presentation(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_campaign_presentation(text, text, text, text) to authenticated;

-- 운영자 계약 지문: 관리자 RPC(promotion.manage 쓰기)와 읽기 정책.
select private.register_operator_rpc_contract('public.admin_save_campaign_presentation(text,text,text,text)'::regprocedure, 'promotion.manage', 'write', false);
select private.register_operator_policy_contract('public.campaign_presentations'::regclass, 'campaign_presentations_public_read', 'promotion.manage');

commit;
