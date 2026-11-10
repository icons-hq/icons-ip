-- Search the same localized channel/page labels that operators see.
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
    when 'email' then '이메일' when 'icons' then 'ICONS' else '기타' end,
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

select private.register_operator_internal_contract('private.store_analytics_label(text,text)'::regprocedure);
notify pgrst,'reload schema';
