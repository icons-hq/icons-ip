begin;
create index marketing_test_receipt_image on private.marketing_test_receipts((content->>'imagePath')) where content->>'imagePath' is not null;
CREATE OR REPLACE FUNCTION private.goods_photo_references(target_path text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
  select g.id,g.name,'good'::text kind from public.goods g where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}')||coalesce(g.description_image_paths,'{}'),null)) or private.goods_benefit_has_photo(g.id,target_path)
  union all select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
  union all select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
  union all select d.id::text,'개인 임시저장 상품','draft' from public.admin_goods_drafts d where d.archived_at is null and target_path=any(d.image_paths)
  union all select s.id::text,s.title,'story' from public.shopping_stories s where target_path=any(s.body_image_paths)
  union all select r.id::text,r.title,'relation' from public.goods_relations r where target_path=r.image_path
  union all select c.id::text,c.name,'marketing' from private.marketing_campaigns c where target_path=c.content->>'imagePath'
  union all select t.id::text,'운영자 테스트 메시지','marketing_test' from private.marketing_test_receipts t where target_path=t.content->>'imagePath'
 ) refs;
$function$;
commit;
