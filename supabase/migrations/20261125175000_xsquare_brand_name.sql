-- 2026-11-24 서비스 이름 통일: 고객·운영자에게 보이는 'ICONS'를 '엑스스퀘어'로 바꾼다.
-- 법인 상호((주)아이콘스)와 외부 연동 식별값은 그대로다. 이 migration은 DB가 만드는 문구 세 곳과 스토어 표시 이름만 다룬다.
--
-- 1) 상품 Q&A 답변·리뷰 답글 알림 본문(admin_save_cs_reply가 안에서 부르는 두 함수). 본문은 20261020085215의 정의와 같고
--    'ICONS 운영자'만 '엑스스퀘어 운영자'로 바꾼다. 두 함수는 retired 운영자 계약으로 등록돼 있어 끝에서 지문을 다시 적는다.
-- 2) 유입 분석 라벨(private.store_analytics_label)의 내부 유입 출처 이름.
-- 3) 스토어 표시 이름(store_settings.branding.displayName)의 기본값과, 기본값 그대로인 저장값.
--    운영자가 다른 이름을 저장했다면 건드리지 않는다.

CREATE OR REPLACE FUNCTION public.admin_answer_product_question(target_question_id uuid, target_answer_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_answer text := btrim(coalesce(target_answer_body, ''), E' \t\n\r\f\v');
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.has_operator_capability('cs.manage',false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(normalized_answer) not between 1 and 2000 then
    raise exception 'invalid_question_answer' using errcode = '22023';
  end if;

  select question.user_id, question.good_id, question.answer_body
    into v_user_id, v_good_id, v_previous
  from public.product_questions as question
  where question.id = target_question_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  update public.product_questions
  set answer_body = normalized_answer,
      answered_at = now(),
      answered_by = actor_id
  where id = target_question_id;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'product_question.answer',
    'product_questions:' || target_question_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'answerLength', char_length(normalized_answer)
    )
  );

  -- body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답변
  -- 저장까지 함께 되돌아간다 — 이름을 잘라서라도 답변은 남긴다.
  insert into public.notifications (
    user_id, type, title, body, link_path, source_type, source_id, dedupe_key
  )
  values (
    v_user_id,
    'product_question_answered',
    -- 용어 규율(CONTEXT.md): 공개 상품 Q&A를 1:1 '문의'와 섞어 부르지 않는다.
    '상품 Q&A에 답변이 등록됐어요',
    left(coalesce(v_good_name, '굿즈'), 100) || ' 질문에 엑스스퀘어 운영자가 답변을 남겼습니다.',
    '/my/questions',
    'product_question',
    target_question_id::text,
    'product_question_answered:' || target_question_id::text
  )
  on conflict (user_id, dedupe_key) do update set
    title = excluded.title,
    body = excluded.body,
    read_at = null,
    created_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reply_to_review(target_review_id uuid, target_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_reply text := btrim(coalesce(target_reply, ''));
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
  v_link text;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_reply) not between 2 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_reply';
  end if;

  select review.user_id, review.good_id, review.admin_reply
    into v_user_id, v_good_id, v_previous
  from public.reviews as review
  where review.id = target_review_id
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  update public.reviews
  set
    admin_reply = v_reply,
    admin_reply_at = now(),
    admin_reply_by = v_actor
  where id = target_review_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.review.reply',
    'review:' || target_review_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'replyLength', char_length(v_reply)
    )
  );

  -- 굿즈 id는 카탈로그 슬러그지만 링크로 쓰기 전에 형태를 확인한다. link_path
  -- CHECK가 제어문자·역슬래시를 막긴 해도, 이상한 id 하나 때문에 답글 저장
  -- 전체가 실패하는 것보다 안전한 목적지로 접는 편이 낫다.
  v_link := case
    when v_good_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then '/shop/' || v_good_id
    else '/my/reviews'
  end;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  values (
    v_user_id,
    'review_replied',
    '리뷰에 답글이 달렸어요',
    /* body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답글
       저장까지 함께 되돌아간다 — 이름을 잘라서라도 답글은 남긴다. */
    left(coalesce(v_good_name, '굿즈'), 100) || ' 리뷰에 엑스스퀘어 운영자가 답글을 남겼습니다.',
    v_link,
    'review',
    target_review_id::text,
    'review_replied:' || target_review_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;
end;
$function$;

create or replace function private.store_analytics_label(p_dimension text,p_key text) returns text
language sql stable security invoker set search_path='' as $$
 select case p_dimension
  when 'total' then '전체'
  when 'channel' then concat(
   case split_part(p_key,'/',1) when 'direct' then '직접·출처 미확인' when 'search' then '검색' when 'social' then '소셜'
    when 'email' then '이메일' when 'paid' then '유료 캠페인 표기' when 'referral' then '기타 외부' when 'internal' then '스토어 내부' else '기타' end,
   ' · ',case split_part(p_key,'/',2) when 'none' then '출처 없음' when 'google' then 'Google' when 'naver' then '네이버'
    when 'bing' then 'Bing' when 'daum' then '다음' when 'instagram' then 'Instagram' when 'facebook' then 'Facebook'
    when 'youtube' then 'YouTube' when 'kakao' then '카카오' when 'x' then 'X' when 'threads' then 'Threads'
    when 'email' then '이메일' when 'icons' then '엑스스퀘어' else '기타' end,
   case split_part(p_key,'/',3) when 'cpc' then ' / CPC' when 'paid_social' then ' / 유료 소셜' else '' end)
  when 'page' then case p_key when 'home' then '스토어 홈' when 'shop' then '상품 목록' when 'good' then '상품 상세'
   when 'stories' then '쇼핑스토리 목록' when 'story' then '쇼핑스토리' when 'ip' then 'IP'
   when 'events' then '이벤트 목록' when 'event' then '이벤트 상세' else p_key end
  when 'good' then coalesce((select name from public.goods where id=p_key),'보관된 상품')
  when 'ip' then coalesce((select title from public.ips where id=p_key),'보관된 IP')
  when 'category' then coalesce((select name from public.catalog_categories where id::text=p_key),'보관된 카테고리')
  when 'link' then coalesce((select coalesce(g.name,s.title,c.name,l.original_title) from private.marketing_links l
   left join public.goods g on g.id=l.good_id left join public.shopping_stories s on s.id=l.story_id
   left join public.catalog_categories c on c.id=l.category_id where l.id::text=p_key),'보관된 링크')
  else p_key end;
$$;
revoke all on function private.store_analytics_label(text,text) from public,anon,authenticated,service_role;

alter table public.store_settings alter column branding set default
  '{"displayName":"엑스스퀘어","logoMode":"text","logoPath":null,"mobileLogoPath":null,"introduction":"","showIntroduction":false,"socials":{"blog":{"enabled":false,"url":""},"facebook":{"enabled":false,"url":""},"instagram":{"enabled":false,"url":""}}}'::jsonb;

update public.store_settings
set branding = jsonb_set(branding, '{displayName}', to_jsonb('엑스스퀘어'::text))
where branding->>'displayName' = 'ICONS';

select private.register_operator_rpc_contract('public.admin_answer_product_question(uuid,text)'::regprocedure,'cs.manage','retired',false);
select private.register_operator_rpc_contract('public.admin_reply_to_review(uuid,text)'::regprocedure,'cs.manage','retired',false);
select private.register_operator_internal_contract('private.store_analytics_label(text,text)'::regprocedure);
