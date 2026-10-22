-- 캠페인 본문 블록에 `cta`(이동 버튼)를 더한다 (LFS 패리티 2차 L10 · 11 §8 EV-03 · 12 §4 LD-18).
--
-- 블록 모양: { "type": "cta", "label": "<버튼 문구 1~30자>", "href": "<ICONS 내부 경로 1~300자>" }
-- (모든 블록처럼 선택 키 anchor 1~20자를 받는다.)
--
-- ## 링크는 ICONS 안의 경로만 받는다 (LD-18)
--
-- 외부 링크는 피싱·추적 위험이 있어 운영자 편성으로 열지 않는다. 필요해지면 허용 도메인
-- 목록을 따로 정한다. 판정은 lib/campaigns.ts isCampaignInternalHref 와 1:1이다.
--   - `/` 로 시작해야 한다 — 스킴(`https:`·`javascript:`)과 도메인 주소는 여기서 걸러진다.
--   - `//` 로 시작하면 안 된다 — 브라우저가 프로토콜 상대 주소(다른 호스트)로 읽는다.
--   - 역슬래시·공백·제어문자(0x01–0x20, 0x7F)는 어디에도 둘 수 없다. 브라우저 URL 파서가
--     `\`를 `/`로 바꾸고 탭·줄바꿈을 지우므로 `/\evil.example`·`/<TAB>/evil.example`이
--     `//evil.example`로 바뀐다.
--   - `.`·`..` 경로 조각(`%2e` 포함, 대소문자 무시)도 받지 않는다. `/..//evil.example`은 같은
--     출처지만 정규화된 pathname 이 `//evil.example`이 되어, pathname 을 다시 주소로 읽는
--     소비자가 프로토콜 상대 주소로 오해한다.
--   - label 은 공백만으로 채울 수 없다(그릴 문구가 없는 버튼).
--
-- ## 바뀌는 것은 private 검증 함수 하나다
--
-- admin_upsert_campaign(운영자 RPC 계약 20261020085215:16767)은 본문 검증을
-- private.validate_campaign_sections에 맡긴다. 그 함수 본문만 바꾸므로 공개 RPC의 본문·ACL·
-- 운영자 계약 해시는 그대로다. 기존 캠페인 본문은 이전 8종 규칙을 통과한 값이라 새 규칙에서도
-- 그대로 유효하다(블록 종류를 더할 뿐 기존 블록의 규칙은 바꾸지 않는다).

create or replace function private.validate_campaign_sections(p_sections jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  c_types constant text[] := array[
    'intro', 'image', 'text', 'attendance', 'exchange', 'coupon', 'goods', 'notice', 'cta'
  ];
  v_index integer := -1;
  v_section jsonb;
  v_type text;
  v_allowed text[];
  v_required text[];
  v_text_keys text[];
  v_text_limits integer[];
  v_key text;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'invalid_sections'
      using errcode = '22023', detail = 'sections: not a json array';
  end if;

  if jsonb_array_length(p_sections) > 20 then
    raise exception 'invalid_sections'
      using errcode = '22023',
        detail = format('sections: at most 20 blocks (got %s)', jsonb_array_length(p_sections));
  end if;

  for v_section in select entry from jsonb_array_elements(p_sections) as element(entry)
  loop
    v_index := v_index + 1;

    if jsonb_typeof(v_section) <> 'object' then
      raise exception 'invalid_sections'
        using errcode = '22023', detail = format('sections[%s]: not an object', v_index);
    end if;

    if jsonb_typeof(v_section -> 'type') is distinct from 'string'
       or not ((v_section ->> 'type') = any (c_types)) then
      raise exception 'invalid_sections'
        using errcode = '22023', detail = format('sections[%s].type: unknown block type', v_index);
    end if;

    v_type := v_section ->> 'type';

    -- anchor는 모든 블록의 선택 키다(상세 페이지 목차 링크).
    if v_section ? 'anchor'
       and (
         jsonb_typeof(v_section -> 'anchor') <> 'string'
         or char_length(v_section ->> 'anchor') not between 1 and 20
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023', detail = format('sections[%s].anchor: invalid', v_index);
    end if;

    v_text_keys := null;
    v_text_limits := null;

    case v_type
      when 'intro' then
        v_required := array['copy'];
        v_allowed := array['copy'];
        v_text_keys := array['copy'];
        v_text_limits := array[500];
      when 'image' then
        v_required := array['image_path', 'alt'];
        v_allowed := array['image_path', 'alt'];
        v_text_keys := array['image_path', 'alt'];
        v_text_limits := array[300, 200];
      when 'text' then
        v_required := array['body'];
        v_allowed := array['heading', 'body'];
        v_text_keys := array['heading', 'body'];
        v_text_limits := array[120, 2000];
      when 'attendance' then
        v_required := array[]::text[];
        v_allowed := array[]::text[];
      when 'exchange' then
        v_required := array['offer_id'];
        v_allowed := array['offer_id'];
        v_text_keys := array['offer_id'];
        v_text_limits := array[36];
      when 'coupon' then
        v_required := array['coupon_code'];
        v_allowed := array['coupon_code', 'description'];
        v_text_keys := array['coupon_code', 'description'];
        v_text_limits := array[24, 200];
      when 'goods' then
        v_required := array['good_ids'];
        v_allowed := array['good_ids'];
      when 'cta' then
        v_required := array['label', 'href'];
        v_allowed := array['label', 'href'];
        v_text_keys := array['label', 'href'];
        v_text_limits := array[30, 300];
      else
        -- 'notice'
        v_required := array['items'];
        v_allowed := array['items'];
    end case;

    -- 모르는 키는 통과시키지 않는다. 오타 하나가 조용히 저장되면 화면에서만
    -- 빈 블록으로 보이고, 원인을 데이터에서 찾아야 한다.
    for v_key in select object_key from jsonb_object_keys(v_section) as keys(object_key)
    loop
      if v_key not in ('type', 'anchor') and not (v_key = any (v_allowed)) then
        raise exception 'invalid_sections'
          using errcode = '22023',
            detail = format('sections[%s].%s: unexpected key for type %s', v_index, v_key, v_type);
      end if;
    end loop;

    foreach v_key in array v_required
    loop
      if not (v_section ? v_key) then
        raise exception 'invalid_sections'
          using errcode = '22023',
            detail = format('sections[%s].%s: required for type %s', v_index, v_key, v_type);
      end if;
    end loop;

    for v_cursor in 1 .. coalesce(array_length(v_text_keys, 1), 0)
    loop
      if v_section ? v_text_keys[v_cursor]
         and (
           jsonb_typeof(v_section -> v_text_keys[v_cursor]) <> 'string'
           or char_length(v_section ->> v_text_keys[v_cursor]) not between 1 and v_text_limits[v_cursor]
         ) then
        raise exception 'invalid_sections'
          using errcode = '22023',
            detail = format(
              'sections[%s].%s: expected a string of 1..%s characters',
              v_index, v_text_keys[v_cursor], v_text_limits[v_cursor]
            );
      end if;
    end loop;

    -- 교환 블록은 coin_exchange_offers 행을 가리킨다. FK를 걸 수 없는 자리라
    -- 최소한 형식은 확인한다 — 상세 페이지가 uuid 캐스팅에서 터지지 않게.
    if v_type = 'exchange'
       and (v_section ->> 'offer_id')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].offer_id: not a uuid', v_index);
    end if;

    -- 이동 버튼은 ICONS 안의 경로만 가리킨다(LD-18). 문자열 형식·길이는 위에서 확인했다.
    -- 판정은 lib/campaigns.ts isCampaignInternalHref 와 같다.
    if v_type = 'cta'
       and (
         left(v_section ->> 'href', 1) <> '/'
         or left(v_section ->> 'href', 2) = '//'
         or (v_section ->> 'href') ~ '[\x01-\x20\x7f\\]'
         or (v_section ->> 'href') ~* '(^|/)(\.|%2e){1,2}(/|[?#]|$)'
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].href: must be an internal path starting with /', v_index);
    end if;

    if v_type = 'cta' and btrim(v_section ->> 'label', E' \t\n\r\f\v') = '' then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].label: must not be blank', v_index);
    end if;

    if v_type = 'goods'
       and (
         jsonb_typeof(v_section -> 'good_ids') <> 'array'
         or jsonb_array_length(v_section -> 'good_ids') not between 1 and 8
         or exists (
           select 1
           from jsonb_array_elements(v_section -> 'good_ids') as entries(entry)
           where jsonb_typeof(entries.entry) <> 'string'
             or char_length(entries.entry #>> '{}') not between 1 and 120
         )
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].good_ids: expected 1..8 non-empty strings', v_index);
    end if;

    if v_type = 'notice'
       and (
         jsonb_typeof(v_section -> 'items') <> 'array'
         or jsonb_array_length(v_section -> 'items') not between 1 and 20
         or exists (
           select 1
           from jsonb_array_elements(v_section -> 'items') as entries(entry)
           where jsonb_typeof(entries.entry) <> 'string'
             or char_length(entries.entry #>> '{}') not between 1 and 300
         )
       ) then
      raise exception 'invalid_sections'
        using errcode = '22023',
          detail = format('sections[%s].items: expected 1..20 strings of 1..300 characters', v_index);
    end if;
  end loop;
end;
$$;

-- 함수를 다시 만들었으니 봉인도 다시 적는다. 원래부터 어느 앱 롤에도 grant 하지 않았다 —
-- security definer 인 admin_upsert_campaign 만 소유자 권한으로 부른다.
revoke all on function private.validate_campaign_sections(jsonb)
  from public, anon, authenticated, service_role;
