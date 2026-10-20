-- Policy reads use the read capability predicate. The write guard takes row
-- locks and cannot run inside PostgREST's STABLE/read-only transaction.
begin;
create or replace function public.admin_get_coupon_combination_policy() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return public.get_coupon_combination_policy()||(select jsonb_build_object('evidence',evidence,'updatedAt',updated_at) from private.coupon_combination_policy where singleton);
end $$;
revoke all on function public.admin_get_coupon_combination_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_coupon_combination_policy() to authenticated;
commit;
