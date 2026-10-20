-- Personal, manually saved registration drafts. Catalogue writes remain a separate step.
create table public.admin_goods_drafts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  form_values jsonb not null check(jsonb_typeof(form_values)='object' and octet_length(form_values::text)<=524288),
  image_paths text[] not null default '{}',
  owned_image_paths text[] not null default '{}',
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  completed_good_id text references public.goods(id) on update cascade on delete set null,
  completed_result jsonb,
  check((completed_result is null) or archived_at is not null)
);
create index admin_goods_drafts_owner_idx on public.admin_goods_drafts(owner_id,updated_at desc,id);
alter table public.admin_goods_drafts enable row level security;
revoke all on public.admin_goods_drafts from public,anon,authenticated,service_role;
grant select on public.admin_goods_drafts to authenticated;
create policy admin_goods_drafts_owner_read on public.admin_goods_drafts for select to authenticated
  using(owner_id=(select auth.uid()) and public.is_staff());

create function private.goods_draft_summary(d public.admin_goods_drafts) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',d.id,'name',d.form_values->>'name','imagePath',nullif(d.form_values->>'imagePath',''),
    'revision',d.revision,'updatedAt',d.updated_at,'archived',d.archived_at is not null,'completedGoodId',d.completed_good_id);
$$;
revoke all on function private.goods_draft_summary(public.admin_goods_drafts) from public,anon,authenticated,service_role;

create function public.admin_list_goods_drafts(p_query text default '',p_archived boolean default false,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total_count bigint;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_query is null or char_length(p_query)>100 or p_archived is null or p_page is null or p_page<1 or p_page>100000 then
    raise invalid_parameter_value using message='invalid_goods_draft_filter';
  end if;
  select count(*) into total_count from public.admin_goods_drafts d where d.owner_id=auth.uid()
    and d.completed_result is null and (d.archived_at is not null)=p_archived and strpos(lower(d.form_values->>'name'),lower(btrim(p_query)))>0;
  select coalesce(jsonb_agg(private.goods_draft_summary(d) order by d.updated_at desc,d.id),'[]') into result from (
    select * from public.admin_goods_drafts d where d.owner_id=auth.uid() and d.completed_result is null
      and (d.archived_at is not null)=p_archived and strpos(lower(d.form_values->>'name'),lower(btrim(p_query)))>0
    order by d.updated_at desc,d.id limit 20 offset(p_page-1)*20
  ) d;
  return jsonb_build_object('rows',result,'total',total_count,'page',p_page,'pageSize',20);
end $$;
revoke all on function public.admin_list_goods_drafts(text,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_drafts(text,boolean,integer) to authenticated;

create function public.admin_get_goods_draft(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.admin_goods_drafts;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  select * into d from public.admin_goods_drafts where id=p_id and owner_id=auth.uid();
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  return private.goods_draft_summary(d)||jsonb_build_object('values',d.form_values);
end $$;
revoke all on function public.admin_get_goods_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_draft(uuid) to authenticated;

-- Soft-deleting a draft does not revoke the owner's already verified uploaded image.
-- Shared-library paths are deliberately excluded from this ownership grant.
create function private.can_reuse_own_goods_draft_artwork(target_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.is_staff() and exists(
    select 1 from public.admin_goods_drafts d where d.owner_id=auth.uid() and target_path=any(d.owned_image_paths)
  );
$$;
revoke all on function private.can_reuse_own_goods_draft_artwork(text) from public,anon,authenticated,service_role;

create function public.admin_save_goods_draft(p_id uuid,p_values jsonb,p_expected_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.admin_goods_drafts; saved public.admin_goods_drafts;
  paths text[]; owned_paths text[]:='{}'; current_path text;
  allowed_fields constant text[]:=array[
    'id','ipId','name','nameEn','searchKeywords','displayOrder','categoryId','additionalCategoryIds','shippingNoticeTemplate','type','code','defaultVariantCode',
    'price','compareAtPrice','showDiscountRate','badge','stock','description','descriptionFormat','descriptionUploadPath','descriptionImageAlt','imagePath','detailImagePath',
    'originId','shippingFeeType','individualFee','variants','variantBaseline','customInputs','customInputsExpectedRevision','optionUsage',
    'optionAxisName0','optionAxisValues0','optionAxisName1','optionAxisValues1','optionAxisName2','optionAxisValues2',
    'regularPrice','discountEnabled','discountValue','discountUnit','allowCardPayment','allowBankTransfer','saleRestriction','orderQuantityLimitEnabled',
    'minOrderQty','maxOrderQty','memberPurchaseLimitEnabled','memberLifetimeQtyLimit','claimReturnAllowed','claimExchangeAllowed','claimRestrictionReason',
    'claimReturnFee','claimReturnFreeShippingFee','claimExchangeFee','noticeMaker','noticeOrigin','noticeMaterial','noticeSize','noticeMadeOn','noticeAsManager','noticeAsContact',
    'galleryPath0','galleryPath1','galleryPath2','galleryPath3','galleryPath4','galleryPath5','galleryPath6','galleryPath7','galleryPath8'];
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_values is null or jsonb_typeof(p_values)<>'object'
    or octet_length(p_values::text)>524288 then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  if not p_values ? 'name' or char_length(btrim(p_values->>'name')) not between 1 and 100
    or exists(select 1 from jsonb_each(p_values) entry where not entry.key=any(allowed_fields) or jsonb_typeof(entry.value)<>'string')
    or exists(select 1 from jsonb_each_text(p_values) entry where entry.value ~* '^\s*(blob:|data:)')
    or coalesce(p_values->>'variantBaseline','[]')<>'[]' or coalesce(p_values->>'customInputsExpectedRevision','0')<>'0'
  then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  if exists(select 1 from jsonb_each_text(p_values) e where (e.key in ('imagePath','detailImagePath','descriptionUploadPath') or e.key like 'galleryPath%')
    and e.value<>'' and e.value !~ '^public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$')
  then raise check_violation using message='unverified_artwork'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-drafts-owner:'||actor::text,0));
  select * into previous from public.admin_goods_drafts where id=p_id for update;
  if found then
    if previous.owner_id<>actor then raise insufficient_privilege using message='forbidden'; end if;
    if previous.archived_at is not null then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
    if previous.form_values=p_values and previous.revision=p_expected_revision+1 then return private.goods_draft_summary(previous); end if;
    if previous.revision<>p_expected_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  else
    if p_expected_revision<>0 then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
    if (select count(*) from public.admin_goods_drafts where owner_id=actor and archived_at is null)>=40 then
      raise check_violation using message='goods_draft_limit';
    end if;
  end if;
  select coalesce(array_agg(distinct match[1]),'{}') into paths from regexp_matches(p_values::text,
    '(public-media/catalog/good/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](?:jpg|png|webp))','g') match;
  foreach current_path in array paths loop
    if current_path=any(coalesce(previous.owned_image_paths,'{}')) or private.can_reuse_own_goods_draft_artwork(current_path) then
      owned_paths:=array_append(owned_paths,current_path);
    elsif private.can_reuse_shared_goods_artwork(current_path) then null;
    else
      update public.admin_artwork_upload_claims set status='attached',attached_at=clock_timestamp(),resolved_at=clock_timestamp()
        where actor_id=actor and path=substr(current_path,14) and kind='good' and status='verified' and expires_at>clock_timestamp();
      if not found then raise check_violation using message='unverified_artwork'; end if;
      owned_paths:=array_append(owned_paths,current_path);
    end if;
  end loop;
  insert into public.admin_goods_drafts(id,owner_id,form_values,image_paths,owned_image_paths) values(p_id,actor,p_values,paths,owned_paths)
    on conflict(id) do update set form_values=excluded.form_values,image_paths=excluded.image_paths,owned_image_paths=excluded.owned_image_paths,
      revision=admin_goods_drafts.revision+1,updated_at=clock_timestamp() returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.draft.saved','goods_draft:'||p_id::text,
    jsonb_build_object('revision',saved.revision,'fieldCount',(select count(*) from jsonb_object_keys(p_values))));
  return private.goods_draft_summary(saved);
end $$;
revoke all on function public.admin_save_goods_draft(uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_draft(uuid,jsonb,integer) to authenticated;

create function public.admin_set_goods_draft_archived(p_id uuid,p_expected_revision integer,p_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.admin_goods_drafts; actor uuid:=auth.uid();
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<1 or p_archived is null then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-drafts-owner:'||actor::text,0));
  select * into d from public.admin_goods_drafts where id=p_id and owner_id=actor for update;
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  if d.completed_result is not null then raise exception 'goods_draft_completed' using errcode='PT409'; end if;
  if (d.archived_at is not null)=p_archived and d.revision=p_expected_revision+1 then return private.goods_draft_summary(d); end if;
  if d.revision<>p_expected_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  if not p_archived and d.archived_at is not null and (select count(*) from public.admin_goods_drafts where owner_id=actor and archived_at is null)>=40 then
    raise check_violation using message='goods_draft_limit';
  end if;
  update public.admin_goods_drafts set archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,
    revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into d;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.goods.draft.archived','goods_draft:'||p_id::text,
    jsonb_build_object('revision',d.revision,'archived',p_archived));
  return private.goods_draft_summary(d);
end $$;
revoke all on function public.admin_set_goods_draft_archived(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_goods_draft_archived(uuid,integer,boolean) to authenticated;

-- One RPC commits the existing catalogue transaction and consumes the draft.
-- An uncertain response can be retried without creating another product.
create function public.admin_save_good_from_draft(target_good jsonb,p_draft_id uuid,p_draft_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.admin_goods_drafts; result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_draft_id is null or p_draft_revision is null or p_draft_revision<1 or target_good is null or jsonb_typeof(target_good)<>'object'
    or nullif(target_good->>'previous_id','') is not null then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  select * into d from public.admin_goods_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  if d.completed_result is not null and d.revision=p_draft_revision+1 then return d.completed_result||jsonb_build_object('draftAlreadyCompleted',true); end if;
  if d.archived_at is not null or d.revision<>p_draft_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  result:=public.admin_save_good(target_good);
  if coalesce(result->>'id','')='' then raise check_violation using message='goods_draft_completion_failed'; end if;
  update public.admin_goods_drafts set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1,
    completed_good_id=result->>'id',completed_result=result where id=p_draft_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.goods.draft.completed','goods_draft:'||p_draft_id::text,
    jsonb_build_object('goodId',result->>'id','revision',d.revision+1));
  return result;
end $$;
revoke all on function public.admin_save_good_from_draft(jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good_from_draft(jsonb,uuid,integer) to authenticated;

-- Preserve each existing image gate and append the personal verified-draft path.
do $$
declare signature text; original text; updated text; needle constant text:='private.can_reuse_shared_goods_artwork(';
begin
  foreach signature in array array['public.enforce_admin_catalog_artwork_claim()','public.enforce_admin_goods_content_artwork_claim()'] loop
    select pg_get_functiondef(signature::regprocedure) into original;
    if strpos(original,needle)=0 then raise exception 'goods draft artwork gate missing in %',signature; end if;
    updated:=regexp_replace(original,'private.can_reuse_shared_goods_artwork\(([^()]*)\)',
      '(private.can_reuse_shared_goods_artwork(\1) or private.can_reuse_own_goods_draft_artwork(\1))','g');
    execute updated;
  end loop;
end $$;

-- A shared library image cannot be archived while an active personal draft uses it.
create or replace function private.goods_photo_references(target_path text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind) order by kind,id),'[]') from (
    select g.id,g.name,'good'::text kind from public.goods g
      where target_path=any(array_remove(array[g.image_path,g.detail_image_path]||coalesce(g.gallery_paths,'{}')||coalesce(g.description_image_paths,'{}'),null))
    union all select c.id::text,c.title,'curation' from public.home_curations c where to_jsonb(c)::text like '%'||substr(target_path,14)||'%'
    union all select 'store','스토어 로고','store' from public.store_settings s where to_jsonb(s)::text like '%'||substr(target_path,14)||'%'
    union all select d.id::text,'개인 임시저장 상품','draft' from public.admin_goods_drafts d where d.archived_at is null and target_path=any(d.image_paths)
  ) refs;
$$;
revoke all on function private.goods_photo_references(text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
