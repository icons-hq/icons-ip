begin;
do $$declare source text;anchor text:='select distinct order_id,good_id from public.order_items';begin
 source:=pg_get_functiondef('public.my_review_targets_v2(uuid,text,integer)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'review_type_target_source_changed';end if;
 execute replace(source,anchor,'select distinct oi.order_id,oi.good_id from public.order_items oi');
end $$;
notify pgrst,'reload schema';
commit;
