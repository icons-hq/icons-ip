-- Refresh public entry fingerprints after the fulfillment extension in 94000.
-- The previous migration registered internal contracts but omitted these RPCs.
begin;
select private.register_operator_rpc_contract('public.admin_preview_shipping_settings_template_v3(uuid,text[],uuid,uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_search_goods_for_shipping_settings_v3(text,integer,uuid,uuid)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_apply_shipping_settings_template_v3(jsonb)'::regprocedure,'catalog.manage','write',false);
commit;
