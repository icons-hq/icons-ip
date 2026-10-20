-- Refresh explicit operator coverage for existing bodies extended by the sale
-- period migrations; no capability or execution grants change here.
select private.register_operator_rpc_contract('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_internal_contract('private.resolve_goods_variant_supply(uuid,timestamptz)'::regprocedure);
select private.register_operator_internal_contract('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('public.get_shopping_story(uuid)'::regprocedure);
