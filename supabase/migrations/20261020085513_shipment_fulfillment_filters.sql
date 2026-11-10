-- Keep the dispatch and shipping queries aligned with frozen fulfillment methods.
begin;
do $patch$
declare entry record;definition text;anchor text:=$old$p_method not in ('parcel','quick','pickup')$old$;
begin
 for entry in select * from (values
  ('private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)','7aee77cb7ee12eeca5711b6e0ad74dd6'),
  ('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)','57bda8147e3b18ceee315492bfcf7452')) source(signature,body_md5) loop
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure(entry.signature)) is distinct from entry.body_md5 then raise exception 'shipment_fulfillment_filter_source_changed: %',entry.signature;end if;
  definition:=pg_get_functiondef(entry.signature::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_fulfillment_filter_anchor_changed: %',entry.signature;end if;
  execute replace(definition,anchor,$new$p_method not in ('parcel','quick','pickup','direct','freight','none','digital')$new$);
  perform private.register_operator_internal_contract(entry.signature::regprocedure);
 end loop;
end $patch$;
select private.register_operator_rpc_contract('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'::regprocedure,'sales.manage','read',false);
commit;
