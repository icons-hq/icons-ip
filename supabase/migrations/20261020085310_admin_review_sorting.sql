-- Extend both staff review searches before their existing count/page boundary.
-- Customer-facing review sorting and the BEST selection ledger are unchanged.
do $migration$
declare signature text; body text;
 sort_values text := '''recent'', ''oldest'', ''rating_desc'', ''rating_asc''';
 order_anchor text := E'  order by\n    case when v_sort = ''rating_desc'' then review.rating end desc nulls last,';
 photo_expression text := 'cardinality(review.image_paths)';
begin
 foreach signature in array array[
  'public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer)',
  'public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'
 ] loop
  body := pg_get_functiondef(signature::regprocedure);
  if (length(body)-length(replace(body,sort_values,'')))/length(sort_values) <> 1
   or (length(body)-length(replace(body,order_anchor,'')))/length(order_anchor) <> 1
   or (length(body)-length(replace(body,photo_expression,'')))/length(photo_expression) <> 2 then
   raise exception 'review_sort_contract_anchor_missing: %',signature;
  end if;
  body := replace(body,sort_values,sort_values||', ''good_name_asc'', ''photo_count_desc''');
  body := replace(body,photo_expression,'coalesce(cardinality(review.image_paths),0)');
  body := replace(body,order_anchor,E'  order by\n    case when v_sort = ''good_name_asc'' then good.name end asc nulls last,\n    case when v_sort = ''photo_count_desc'' then coalesce(cardinality(review.image_paths),0) end desc nulls last,\n    case when v_sort = ''rating_desc'' then review.rating end desc nulls last,');
  execute body;
 end loop;
end $migration$;

revoke all on function public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer) to authenticated;
revoke all on function public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text) to authenticated;
select private.register_operator_rpc_contract('public.admin_search_reviews(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer)','cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','cs.manage','read',false);
notify pgrst,'reload schema';
