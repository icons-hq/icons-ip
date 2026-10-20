-- The story RPC builds product JSON itself instead of querying the catalog loader.
do $$declare body text;anchor text:='''showDiscountRate'',g.show_discount_rate,';begin
 body:=pg_get_functiondef('public.get_shopping_story(uuid)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'sale_period_story_anchor_missing';end if;
 execute replace(body,anchor,'''salePeriod'',public.goods_sale_period(g),'||anchor);
end $$;
notify pgrst,'reload schema';
