-- Refresh the registered source hash after the two-year buyer fallback change.
select private.register_operator_internal_contract('public.get_product_detail_experience(text)'::regprocedure);
