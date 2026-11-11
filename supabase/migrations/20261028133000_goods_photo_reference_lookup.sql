-- R19 (MD-0030): 사진 보관함 목록이 느리다. 목록 한 페이지(20장)마다 private.goods_photo_references가 사진별로
-- 상품 테이블 전체를 훑고, 상품 행마다 SECURITY DEFINER 함수(private.goods_benefit_has_photo)를 한 번씩 불렀다
-- (SECURITY DEFINER 함수는 인라인되지 않는다). 실측(격리 DB, 상품 3,015·사은품 1,000행, 사진 20장): 약 155ms.
--
-- 같은 참조 목록(종류·이름·정렬)을 유지하면서
--   · 상품 이미지 경로 배열과 사은품 이미지 배열을 GIN 색인으로 찾고(`@>`),
--   · 사은품 참조는 행별 함수 호출 대신 조인으로 합친다(같은 상품이 두 경로로 걸리면 한 번만).
-- private.goods_benefit_has_photo는 다른 곳에서 쓸 수 있게 그대로 둔다.
begin;

create index goods_photo_reference_paths_idx on public.goods using gin ((
  array_remove(array[image_path, detail_image_path] || coalesce(gallery_paths, '{}'::text[]) || coalesce(description_image_paths, '{}'::text[]), null::text)
));
create index goods_benefit_content_gift_image_paths_idx on private.goods_benefit_content using gin (gift_image_paths);

create or replace function private.goods_photo_references(target_path text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
  (select g.id,g.name,'good'::text kind from public.goods g
    where array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}'::text[])||coalesce(g.description_image_paths,'{}'::text[]),null::text) @> array[target_path]
   union
   select g.id,g.name,'good'::text from private.goods_benefit_content b join public.goods g on g.id=b.good_id
    where b.gift_image_paths @> array[target_path])
  union all select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
  union all select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
  union all select d.id::text,'개인 임시저장 상품','draft' from public.admin_goods_drafts d where d.archived_at is null and target_path=any(d.image_paths)
  union all select s.id::text,s.title,'story' from public.shopping_stories s where target_path=any(s.body_image_paths)
  union all select r.id::text,r.title,'relation' from public.goods_relations r where target_path=r.image_path
  union all select c.id::text,c.name,'marketing' from private.marketing_campaigns c where target_path=c.content->>'imagePath'
  union all select t.id::text,'운영자 테스트 메시지','marketing_test' from private.marketing_test_receipts t where target_path=t.content->>'imagePath'
 ) refs;
$function$;
revoke all on function private.goods_photo_references(text) from public, anon, authenticated, service_role;
select private.register_operator_internal_contract('private.goods_photo_references(text)'::regprocedure);

commit;
