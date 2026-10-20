begin;
-- Record the actual transition after waiting for the order/job locks. A request
-- can be queued before a preceding transition has acquired its own lock.
do $$declare source text;anchor text:='update private.order_production_jobs set state=case when p_kind=';begin
 source:=pg_get_functiondef('public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'production_record_time_source_changed';end if;
 execute replace(source,anchor,E'at_value:=clock_timestamp();\n '||anchor);
end $$;
notify pgrst,'reload schema';
commit;
