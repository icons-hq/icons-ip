-- Application revision conflicts have a stable HTTP 409 contract.
-- Preserve the already-applied library migration and replace only its writer.
create or replace function public.admin_save_goods_photo(p_id uuid,p_image_path text,p_name text,p_expected_revision integer,p_archived boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.goods_photo_library; saved public.goods_photo_library; object_path text; refs jsonb;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_expected_revision is null or p_expected_revision<0 or p_archived is null then raise invalid_parameter_value using message='invalid_goods_photo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-photo:'||p_id::text,0));
  select * into previous from public.goods_photo_library where id=p_id for update;
  if found then
    if previous.image_path is distinct from p_image_path then raise check_violation using message='photo_path_immutable'; end if;
    -- Register retries are safe only for the exact creator and original payload.
    if p_expected_revision=0 and previous.created_by=actor and previous.revision=1 and previous.name=btrim(p_name) and previous.archived_at is null and not p_archived then
      return jsonb_build_object('id',previous.id,'revision',previous.revision);
    end if;
    if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='goods_photo_changed'; end if;
    refs:=private.goods_photo_references(previous.image_path);
    if p_archived and jsonb_array_length(refs)>0 then raise check_violation using message='goods_photo_in_use'; end if;
    update public.goods_photo_library set name=btrim(p_name),archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into saved;
  else
    if p_expected_revision<>0 or p_archived then raise sqlstate 'PT409' using message='goods_photo_changed'; end if;
    if p_image_path is null or p_image_path !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' then raise check_violation using message='unverified_artwork'; end if;
    object_path:=substr(p_image_path,length('public-media/')+1);
    update public.admin_artwork_upload_claims claim set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
      where claim.actor_id=actor and claim.path=object_path and claim.kind='good' and claim.status='verified'
        and claim.verified_at is not null and claim.final_size is not null and claim.attached_at is null and claim.expires_at>clock_timestamp();
    if not found then raise check_violation using message='unverified_artwork'; end if;
    insert into public.goods_photo_library(id,image_path,name,created_by) values(p_id,p_image_path,btrim(p_name),actor) returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.photo.saved','goods_photo:'||p_id::text,jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return jsonb_build_object('id',saved.id,'revision',saved.revision);
end $$;
revoke all on function public.admin_save_goods_photo(uuid,text,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_photo(uuid,text,text,integer,boolean) to authenticated;
