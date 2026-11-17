-- 캠페인 노출 설정(20261117130200)의 두 가지 후속(PR2 리뷰 C m1·m2).
--
-- 1) updated_by(저장한 운영자 uid)가 anon·authenticated 에게 열려 있었다. 표 전체 SELECT 를 거두고 고객·어드민 화면이 읽는
--    공개 열(campaign_id, popup_mode, popup_location, card_link_path, updated_at)만 열 단위로 연다. 누가 고쳤는지는 감사 기록
--    (audit_log.actor_id)이 이미 남긴다. 쓰기 경로(admin_save_campaign_presentation)와 RLS 정책은 그대로다.
--    앱의 select 목록(lib/campaigns.server.ts·lib/popups.server.ts·lib/admin/campaigns.server.ts)은 이미 위 열만 쓴다.
-- 2) card_link_path 검증에 점 조각(`/./`·`/../`·끝의 `/.`·`/..`, 퍼센트 인코딩 `%2e` 포함)과 역슬래시를 거절한다.
--    `/..//evil.example` 같은 값이 URL 로 정규화되면 `//evil.example` 이 되어 깨진 링크(드물게 외부 이동)가 되었다.
--    점 조각은 쿼리·해시 앞의 경로 부분에서만 본다(`?`·`#` 뒤의 `/..` 는 경로가 아니다).
--    표의 CHECK 와 저장 RPC 의 검증을 같은 식으로 맞추고, RPC 는 본문 한 곳만 앵커 치환한다(없거나 둘 이상이면 예외).
begin;

-- 새 CHECK 가 기존 행을 거절하면 migration 을 멈춰 운영자가 먼저 값을 정리하게 한다(조용히 지우거나 고치지 않는다).
do $$
begin
  if exists (
    select 1 from public.campaign_presentations
    where card_link_path is not null
      and (card_link_path ~ '\\' or card_link_path ~* '^[^?#]*/(\.|%2e){1,2}([/?#]|$)')
  ) then
    raise exception 'campaign_presentations_link_dot_segment_rows_exist: % rows', (
      select count(*) from public.campaign_presentations
      where card_link_path is not null
        and (card_link_path ~ '\\' or card_link_path ~* '^[^?#]*/(\.|%2e){1,2}([/?#]|$)')
    );
  end if;
end $$;

alter table public.campaign_presentations drop constraint campaign_presentations_card_link_path_check;
alter table public.campaign_presentations add constraint campaign_presentations_card_link_path_check
  check (card_link_path is null or (
    char_length(card_link_path) <= 300
    and card_link_path ~ '^/(?![/\\])[^\s\\]*$'
    and card_link_path !~* '^[^?#]*/(\.|%2e){1,2}([/?#]|$)'
  ));

do $$
declare
  body text;
  anchor constant text := $a$normalized_link !~ '^/(?![/\\])[^\s]*$'$a$;
  replacement constant text := $a$(normalized_link !~ '^/(?![/\\])[^\s\\]*$' or normalized_link ~* '^[^?#]*/(\.|%2e){1,2}([/?#]|$)')$a$;
begin
  body := pg_get_functiondef('public.admin_save_campaign_presentation(text,text,text,text)'::regprocedure);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'campaign_presentations_link_anchor_missing: %', anchor;
  end if;
  execute replace(body, anchor, replacement);
end $$;

revoke all on function public.admin_save_campaign_presentation(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_campaign_presentation(text, text, text, text) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_campaign_presentation(text,text,text,text)'::regprocedure, 'promotion.manage', 'write', false);

-- 열 단위 SELECT: 표 전체 권한을 먼저 거둔 뒤(열 권한도 함께 사라진다) 공개 열만 anon·authenticated 에 연다.
revoke select on table public.campaign_presentations from public, anon, authenticated, service_role;
grant select (campaign_id, popup_mode, popup_location, card_link_path, updated_at) on table public.campaign_presentations to anon, authenticated;

commit;
