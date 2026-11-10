-- Supabase REST enables safeupdate. Target replacement is explicitly scoped to
-- the banner setting, including empty lists, instead of an unqualified DELETE.
alter table private.product_detail_banner_goods add column section text not null default 'banner'
 references private.product_detail_settings(section) check(section='banner');
alter table private.product_detail_banner_categories add column section text not null default 'banner'
 references private.product_detail_settings(section) check(section='banner');

create or replace function public.admin_save_product_detail_presentation(p_section text,p_values jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.product_detail_settings%rowtype; request jsonb; receipt jsonb; before_values jsonb; target text;
begin
 perform private.require_actor_operator_capability(actor,'store.manage',false);
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or private.product_detail_values_valid(p_section,p_values) is distinct from true then
  raise invalid_parameter_value using message='invalid_product_detail_presentation';end if;
 request:=jsonb_build_object('section',p_section,'values',p_values,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('product-detail:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.product_detail.updated',request);
 if receipt is not null then return receipt;end if;
 select * into previous from private.product_detail_settings where section=p_section for update;
 if not found then raise no_data_found using message='product_detail_missing';end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='product_detail_conflict';end if;
 before_values:=private.product_detail_values(p_section);
 if p_section='banner' then
  -- Key-share locks fence draft URL changes while the actual FK list is replaced.
  for target in select value from jsonb_array_elements_text(p_values->'goodIds') order by value loop
   perform 1 from public.goods where id=target for key share;
   if not found then raise no_data_found using message='banner_good_missing';end if;
  end loop;
  for target in select value from jsonb_array_elements_text(p_values->'categoryIds') order by value loop
   perform 1 from public.catalog_categories where id=target::uuid for key share;
   if not found then raise no_data_found using message='banner_category_missing';end if;
  end loop;
  delete from private.product_detail_banner_goods where section='banner';
  delete from private.product_detail_banner_categories where section='banner';
  insert into private.product_detail_banner_goods(good_id,position) select value,(ordinality-1)::integer from jsonb_array_elements_text(p_values->'goodIds') with ordinality;
  insert into private.product_detail_banner_categories(category_id,position) select value::uuid,(ordinality-1)::integer from jsonb_array_elements_text(p_values->'categoryIds') with ordinality;
 end if;
 update private.product_detail_settings set values=case when p_section='banner' then p_values-'goodIds'-'categoryIds' else p_values end,
  revision=revision+1,updated_at=clock_timestamp() where section=p_section;
 receipt:=jsonb_build_object('section',p_section,'values',p_values,'revision',previous.revision+1);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.product_detail.updated','product_detail:'||p_section,
  jsonb_build_object('request',request,'result',receipt,'before',before_values));
 return receipt;
end $$;
revoke all on function public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_save_product_detail_presentation(text,jsonb,bigint,uuid)','store.manage','manual',false);
notify pgrst,'reload schema';
