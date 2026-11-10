-- Preserve the existing coupon action error contract for unscheduled definitions.
create or replace function private.claim_coupon_code(p_code text,p_user_id uuid) returns uuid
language plpgsql volatile set search_path='' as $$
declare coupon public.coupons; held_id uuid; issued timestamptz:=statement_timestamp(); reason text;
begin
  perform private.assert_active_user(p_user_id);
  if private.is_account_write_fenced(p_user_id) then raise insufficient_privilege using message='account_write_fenced';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into coupon from public.coupons where code=upper(btrim(coalesce(p_code,''))) for update;
  if not found or coupon.status<>'active' then raise check_violation using message='coupon_not_found';end if;
  select id into held_id from public.user_coupons where user_id=p_user_id and coupon_code=coupon.code;
  -- An existing held coupon survives the end of the issuance period. Applying it
  -- still rechecks its own expiry, status, recipient and eligible goods.
  if held_id is not null then return held_id;end if;
  if issued<coalesce(coupon.issue_starts_at,coupon.starts_at) then raise check_violation using message=case when coupon.issue_starts_at is null then 'coupon_not_started' else 'coupon_issue_not_started' end;end if;
  if (case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=issued then raise check_violation using message=case when coupon.issue_starts_at is null then 'coupon_expired' else 'coupon_issue_ended' end;end if;
  if coupon.ends_at is not null and coupon.ends_at<=issued then raise check_violation using message='coupon_expired';end if;
  reason:=private.coupon_recipient_reason(coupon.recipient_segment,p_user_id);
  if reason is not null then raise check_violation using message=reason;end if;
  if coupon.issue_limit is not null and coupon.issued_count>=coupon.issue_limit then raise check_violation using message='coupon_exhausted';end if;
  insert into public.user_coupons(coupon_code,user_id,issued_source,issued_at,expires_at)
    values(coupon.code,p_user_id,'code_entry',issued,private.coupon_issue_expiry(coupon,issued)) returning id into held_id;
  update public.coupons set issued_count=issued_count+1 where code=coupon.code;
  return held_id;
end $$;
revoke all on function private.claim_coupon_code(text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.claim_coupon_code(text,uuid) to postgres;
