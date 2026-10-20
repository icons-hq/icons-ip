begin;
create function public.get_good_selected_reviews_v2(p_good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(card.value||jsonb_build_object('kind',r.review_kind,'repeatPurchase',r.repeat_purchase) order by card.ordinality),'[]'::jsonb)
 from jsonb_array_elements(public.get_good_selected_reviews(p_good_id)) with ordinality card(value,ordinality)
 join public.reviews r on r.id=(card.value->>'id')::uuid and r.status='visible';
$$;
revoke all on function public.get_good_selected_reviews_v2(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_selected_reviews_v2(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
