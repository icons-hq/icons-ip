begin;
-- The legacy privacy trigger still redacts recipient, subject and raw error text.
-- Store only this closed classification for new completion events, never provider prose.
alter table public.email_deliveries add column safe_error_code text check(safe_error_code is null
 or safe_error_code in('provider_not_configured','provider_network_error','provider_failure')
 or safe_error_code~'^provider_http_[1-5][0-9]{2}$');
do $patch$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('public.complete_email_delivery(text,text,text)'::regprocedure);
 anchor:=$old$    status = target_status,$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'email_completion_classification_anchor_changed';end if;
 execute replace(definition,anchor,anchor||$new$
    safe_error_code = case when target_status='sent' then null
      when target_error in('provider_not_configured','provider_network_error') or target_error~'^provider_http_[1-5][0-9]{2}$' then target_error
      else 'provider_failure' end,$new$);
end $patch$;
create function private.shipment_email_delivery_state(p_order uuid,p_shipment uuid) returns text
language sql stable security definer set search_path='' as $$
 with keys as (
  select 'order_shipped:'||p_order||':'||p_shipment dedupe_key
  union all select 'order_shipped:'||p_order||':'||p_shipment||':recipient'
   where exists(select 1 from private.gift_intents g where g.order_id=p_order)
 ), states as (
  select case when d.status='sent' then 'sent'
   when d.status='pending' then case when d.claimed_at>clock_timestamp()-interval '10 minutes' then 'busy' else 'unknown' end
   when d.status='failed' and coalesce(d.safe_error_code,d.last_error,'') !~ '^(provider_http_(429|5[0-9]{2})|provider_not_configured)$' then 'unknown'
   else 'ready' end state
  from keys k left join public.email_deliveries d using(dedupe_key)
 ) select case when bool_or(state='unknown') then 'unknown' when bool_or(state='busy') then 'busy'
   when bool_and(state='sent') then 'sent' else 'ready' end from states;
$$;
revoke all on function private.shipment_email_delivery_state(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.shipment_email_delivery_state(uuid,uuid) to postgres;
select private.register_operator_internal_contract('private.shipment_email_delivery_state(uuid,uuid)'::regprocedure);

do $patch$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('public.claim_shipment_email_jobs(integer)'::regprocedure);
 anchor:=$old$      case when d.status='sent' then 'sent'
        when d.status='pending' then case when d.claimed_at>clock_timestamp()-interval '10 minutes' then 'busy' else 'unknown' end
        when d.status='failed' and coalesce(d.last_error,'') !~ '^(provider_http_(429|5[0-9]{2})|provider_not_configured)$' then 'unknown'
        else 'ready' end
    from claimed c left join public.email_deliveries d on d.dedupe_key='order_shipped:'||c.order_id||':'||c.shipment_id;$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_email_classifier_anchor_changed';end if;
 execute replace(definition,anchor,'      private.shipment_email_delivery_state(c.order_id,c.shipment_id) from claimed c;');
 definition:=pg_get_functiondef('public.admin_request_email_resend(text)'::regprocedure);
 anchor:=$old$  v_shipment_status text;$old$;
 if strpos(definition,anchor)=0 then raise exception 'resend_declaration_anchor_changed';end if;
 definition:=replace(definition,anchor,anchor||E'\n  v_recipient boolean;\n  v_target_key text;');
 anchor:=$old$  if split_part(v_key,':',1)<>v_template$old$;
 if strpos(definition,anchor)=0 then raise exception 'resend_key_anchor_changed';end if;
 definition:=replace(definition,anchor,$new$  v_recipient:=right(v_key,10)=':recipient';
  v_target_key:=case when v_recipient then left(v_key,length(v_key)-10) else v_key end;
  if v_recipient and (v_template='order_confirmation' and array_length(string_to_array(v_key,':'),1)<>3
   or v_template='order_shipped' and array_length(string_to_array(v_key,':'),1)<>4) then
   raise check_violation using message='email_delivery_target_unresolved';end if;
  if split_part(v_target_key,':',1)<>v_template$new$);
 definition:=replace(definition,$old$string_to_array(v_key,':'),1)<>2$old$,$new$string_to_array(v_target_key,':'),1)<>2$new$);
 definition:=replace(definition,$old$string_to_array(v_key,':'),1) not in (2,3)$old$,$new$string_to_array(v_target_key,':'),1) not in (2,3)$new$);
 definition:=replace(definition,$old$string_to_array(v_key,':'),1)>3$old$,$new$string_to_array(v_target_key,':'),1)>3$new$);
 anchor:=$old$  select target.status::text$old$;
 if strpos(definition,anchor)=0 then raise exception 'resend_gift_anchor_changed';end if;
 definition:=replace(definition,anchor,$new$  if v_recipient and not exists(select 1 from private.gift_intents g
   where g.order_id=lower(v_order_id)::uuid and g.recipient_id is not null) then
   raise check_violation using message='email_delivery_target_unresolved';end if;
  select target.status::text$new$);
 execute definition;
end $patch$;

-- buyer_id is the frozen delivery target identity for each audience; orders.user_id remains the payer.
alter table private.order_delay_notice_targets add column audience text not null default 'payer'
 check(audience in ('payer','recipient'));
alter table private.order_delay_notice_targets drop constraint order_delay_notice_targets_notice_id_order_id_key;
alter table private.order_delay_notice_targets add unique(notice_id,order_id,audience);

create or replace function private.order_delay_notice_target_current(target_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(t.snapshot=private.order_delay_notice_snapshot(t.order_id,t.shipment_ids)
   and t.buyer_id=case when t.audience='recipient' then g.recipient_id else o.user_id end
   and t.recipient_email is not distinct from nullif(lower(btrim(p.email)),'')
   and (n.expected_ship_date is null or n.expected_ship_date>=(statement_timestamp() at time zone 'Asia/Seoul')::date),false)
 from private.order_delay_notice_targets t join private.order_delay_notices n on n.id=t.notice_id
 join public.orders o on o.id=t.order_id left join private.gift_intents g on g.order_id=o.id
 join public.profiles p on p.id=t.buyer_id where t.id=target_id;
$$;

do $patch$declare definition text;anchor text;replacement text;begin
 definition:=pg_get_functiondef('public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date)'::regprocedure);
 anchor:=$old$ end loop;
 insert into public.audit_log$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'delay_recipient_insert_anchor_changed';end if;
 replacement:=$new$  insert into private.order_delay_notice_targets(notice_id,order_id,buyer_id,recipient_email,buyer_name,
   shipment_ids,shipment_labels,snapshot,message_body,email_status,error_code,audience)
  select target_notice,g.order_id,p.id,nullif(lower(btrim(p.email)),''),coalesce(nullif(p.nickname,''),'받는 분'),
   g.shipment_ids,labels,v_snapshot,message,
   case when p.email is null or btrim(p.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'prepared' end,
   case when p.email is null or btrim(p.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end,'recipient'
  from (select order_id,recipient_id from private.gift_intents) gift
  join public.profiles p on p.id=gift.recipient_id where gift.order_id=g.order_id;
 end loop;
 insert into public.audit_log$new$;
 execute replace(definition,anchor,replacement);
 definition:=pg_get_functiondef('public.admin_get_order_delay_notice(uuid)'::regprocedure);
 anchor:=$old$'id',t.id,'orderId',t.order_id,'buyerName',t.buyer_name$old$;
 if strpos(definition,anchor)=0 then raise exception 'delay_audience_projection_anchor_changed';end if;
 execute replace(definition,anchor,anchor||$new$,'audience',t.audience$new$);
 definition:=pg_get_functiondef('public.admin_request_order_delay_notice(uuid)'::regprocedure);
 anchor:=$old$'/orders/'||t.order_id$old$;
 if strpos(definition,anchor)=0 then raise exception 'delay_notification_link_anchor_changed';end if;
 execute replace(definition,anchor,$new$case when t.audience='recipient' then '/gifts' else '/orders/'||t.order_id end$new$);
 definition:=pg_get_functiondef('public.claim_order_delay_email_jobs(integer)'::regprocedure);
 anchor:=$old$'recipient',c.recipient_email,$old$;
 if strpos(definition,anchor)=0 then raise exception 'delay_email_link_anchor_changed';end if;
 execute replace(definition,anchor,anchor||$new$'audience',c.audience,$new$);
end $patch$;
-- Refresh only the reviewed bodies; preserve each existing permission contract verbatim.
do $$declare signature text;fn regprocedure;contract record;begin
 foreach signature in array ARRAY[
  'public.complete_email_delivery(text,text,text)',
  'public.claim_shipment_email_jobs(integer)',
  'public.admin_request_email_resend(text)',
  'private.order_delay_notice_target_current(uuid)',
  'public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date)',
  'public.admin_get_order_delay_notice(uuid)',
  'public.admin_request_order_delay_notice(uuid)',
  'public.claim_order_delay_email_jobs(integer)'
 ] loop
  fn:=signature::regprocedure;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  elsif signature like 'public.admin_%' then raise exception 'operational_rpc_contract_missing: %',signature;
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
