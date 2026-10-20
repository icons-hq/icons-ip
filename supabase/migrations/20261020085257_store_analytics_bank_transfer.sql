-- Include the supported manual-deposit payment method only after its actual
-- operator confirmation AND the common approved payment/evidence ledger agree.
create or replace function public.bind_store_analytics_order(p_token_hash text,p_order_id uuid,p_user_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare session private.store_analytics_sessions; target public.orders; previous private.store_analytics_order_bindings; at_time timestamptz;
begin
 perform private.store_analytics_require_service();
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_order_id is null or p_user_id is null then
  raise invalid_parameter_value using message='analytics_invalid_binding';end if;
 -- Account -> settings -> session -> order. The service boundary supplies the
 -- authenticated actor; this argument is never accepted from a browser body.
 perform private.lock_operator_subjects(array[p_user_id]);
 if private.is_account_write_fenced(p_user_id) or not exists(select 1 from public.profiles where id=p_user_id and role='user' and suspended_at is null) then
  raise insufficient_privilege using message='analytics_order_unavailable';end if;
 perform 1 from private.store_analytics_settings where id and enabled for share;
 if not found then return false;end if;
 select * into session from private.store_analytics_sessions where token_hash=p_token_hash for update;
 at_time:=clock_timestamp();
 if not found or session.revoked_at is not null or session.event_count=0
  or at_time>=session.last_seen_at+interval '30 minutes' or at_time>=session.created_at+interval '24 hours'
  or(at_time at time zone 'Asia/Seoul')::date<>(session.created_at at time zone 'Asia/Seoul')::date then return false;end if;
 select * into target from public.orders where id=p_order_id for update;
 if not found or target.user_id<>p_user_id then raise insufficient_privilege using message='analytics_order_unavailable';end if;
 select * into previous from private.store_analytics_order_bindings where order_id=p_order_id;
 if found then
  if previous.session_id<>session.id then raise exception using errcode='PT409',message='analytics_order_binding_conflict';end if;
  return true;
 end if;
 if target.status<>'pending' or target.created_at<session.created_at or target.created_at<at_time-interval '2 minutes'
  or target.payment_method not in ('card','bank_transfer') or target.total<=0 then return false;end if;
 insert into private.store_analytics_order_bindings(order_id,session_id,bound_at,channel,source,medium,link_id,page_kind,page_target)
 values(target.id,session.id,at_time,session.channel,session.source,session.medium,session.last_link_id,session.last_page_kind,session.last_page_target);
 return true;
end $$;
revoke all on function public.bind_store_analytics_order(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bind_store_analytics_order(text,uuid,uuid) to service_role;

-- Financial facts come only from the existing service-finalized ledger. No
-- callback, client event or guessed order timestamp can create a conversion.
create or replace function private.store_analytics_paid_orders(p_from timestamptz,p_until timestamptz)
returns table(order_id uuid,session_id uuid,bound_at timestamptz,channel text,source text,medium text,link_id uuid,page_kind text,
 paid_at timestamptz,gross_amount bigint,refund_amount bigint)
language sql stable security invoker set search_path='' as $$
 select b.order_id,b.session_id,b.bound_at,b.channel,b.source,b.medium,b.link_id,b.page_kind,
  proof.confirmed_at,p.amount,coalesce((select sum(r.amount) from public.refunds r where r.payment_id=p.id and r.status='done'),0)::bigint
 from private.store_analytics_order_bindings b join private.store_analytics_sessions s on s.id=b.session_id and s.revoked_at is null
 join public.orders o on o.id=b.order_id
 join public.payment_attempts a on a.purpose='order' and a.ref_id=o.id and a.user_id=o.user_id and a.state in ('approved','canceled')
 join public.payments p on p.id=a.payment_id and p.purpose='order' and p.ref_id=o.id and p.user_id=o.user_id
  and p.provider=a.provider and p.amount=a.amount and p.amount=o.total and p.amount>0 and p.status in ('paid','canceled','refunded')
 join lateral(select min(coalesce(e.approved_at,e.recorded_at)) as confirmed_at from private.payment_provider_evidence e
  where e.payment_attempt_id=a.id and e.evidence_kind='confirm_approved') proof on proof.confirmed_at>=b.bound_at and proof.confirmed_at<b.bound_at+interval '7 days'
 where s.created_at>=p_from and s.created_at<p_until and ((a.provider in ('toss','korpay') and o.payment_method='card')
   or(a.provider='bank_transfer' and o.payment_method='bank_transfer'
    and exists(select 1 from public.bank_transfer_confirmations confirmation where confirmation.order_id=o.id and confirmation.attempt_id=a.id)));
$$;
revoke all on function private.store_analytics_paid_orders(timestamptz,timestamptz) from public,anon,authenticated,service_role;

select private.register_operator_internal_contract('public.bind_store_analytics_order(text,uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.store_analytics_paid_orders(timestamptz,timestamptz)'::regprocedure);
notify pgrst,'reload schema';
