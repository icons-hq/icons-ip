-- #414 / #437: exact staff order detail and one chronological operational timeline.
-- Read only named safe columns; never return payment keys, raw provider evidence,
-- arbitrary audit diffs, email recipients, subjects, or errors. Existing order/item
-- snapshots and payment/refund finalizers are unchanged.
-- Notes append to the staff-only audit log. A client operation UUID makes a retry
-- idempotent without merging distinct notes. No customer message/email is created.

create index if not exists audit_log_target_created_idx
  on public.audit_log (target, created_at, id);

create or replace function public.admin_order_detail(target_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then
  raise insufficient_privilege using message='staff_required';
 end if;
 select jsonb_build_object(
  'order',jsonb_build_object('id',o.id,'userId',o.user_id,'buyerName',p.nickname,'buyerEmail',p.email,
   'status',o.status,'total',o.total,'shippingFee',o.shipping_fee,'discountTotal',o.discount_total,
   'createdAt',o.created_at,'shippingCarrier',o.shipping_carrier,'trackingNumber',o.tracking_number,
   'address',jsonb_build_object('recipientName',o.address->>'recipientName','phone',o.address->>'phone',
    'postalCode',o.address->>'postalCode','address1',o.address->>'address1','address2',o.address->>'address2',
    'deliveryNote',o.address->>'deliveryNote')),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.good_name_snapshot,
   'type',i.good_type_snapshot,'qty',i.qty,'unitPrice',i.unit_price) order by i.id)
   from public.order_items i where i.order_id=o.id),'[]'::jsonb),
  'timeline',coalesce((
    select jsonb_agg(e.payload || jsonb_build_object('id',e.id,'occurredAt',e.at) order by e.at,e.id)
    from (
      select 'order:'||o.id id,o.created_at at,jsonb_build_object('source','order','action','created') payload
      union all
      select 'payment:'||p.id,p.created_at,jsonb_build_object('source','payment','action','recorded',
        'status',p.status,'amount',p.amount,'provider',p.provider)
      from public.payment_summaries p where p.purpose='order' and p.ref_id=o.id
      union all
      select 'refund:'||r.id,r.created_at,jsonb_build_object('source','refund','action','requested',
        'status',r.status,'amount',r.amount)
      from public.refunds r join public.payment_summaries p on p.id=r.payment_id
      where p.purpose='order' and p.ref_id=o.id
      union all
      select 'refund-completed:'||r.id,r.completed_at,jsonb_build_object('source','refund','action','completed',
        'status',r.status,'amount',r.amount)
      from public.refunds r join public.payment_summaries p on p.id=r.payment_id
      where p.purpose='order' and p.ref_id=o.id and r.completed_at is not null
      union all
      select 'audit:'||a.id,a.created_at,jsonb_build_object(
        'source',case when a.action='admin.order.note' then 'note'
          when a.action='admin.order.tracking_updated' then 'shipment'
          when a.action like 'admin.order.claim%' or a.action like '%cancellation%' then 'claim'
          else 'status' end,
        'action',a.action,'actorName',actor.nickname,
        'fromStatus',case when a.action='admin.order.status_updated' then a.diff->>'from' end,
        'toStatus',case when a.action='admin.order.status_updated' then a.diff->>'to' end,
        'carrier',case when a.action='admin.order.tracking_updated' then a.diff->>'toCarrier'
          when a.action='admin.order.status_updated' then a.diff->>'carrier' end,
        'trackingNumber',case when a.action='admin.order.tracking_updated' then a.diff->>'toTrackingNumber'
          when a.action='admin.order.status_updated' then a.diff->>'trackingNumber' end,
        'body',case when a.action='admin.order.note' then a.diff->>'body' end)
      from public.audit_log a left join public.profiles actor on actor.id=a.actor_id
      where a.target='order:'||o.id
      union all
      select 'shipped:'||o.id,o.shipped_at,jsonb_build_object('source','shipment','action','shipped',
        'carrier',o.shipping_carrier,'trackingNumber',o.tracking_number)
      where o.shipped_at is not null
      union all
      select 'delivered:'||o.id,o.delivered_at,jsonb_build_object('source','shipment','action','delivered')
      where o.delivered_at is not null
      union all
      select 'claim:'||c.id,c.requested_at,jsonb_build_object('source','claim','action','requested',
        'status',c.stage,'claimType',c.claim_type,'relatedId',c.id)
      from public.order_cancellation_requests c where c.order_id=o.id
      union all
      select 'inquiry:'||i.id,i.created_at,jsonb_build_object('source','inquiry','action','created',
        'status',i.status,'title',i.title,'relatedId',i.id)
      from public.inquiries i where i.order_id=o.id
      union all
      select 'email:'||m.id,coalesce(m.completed_at,m.created_at),jsonb_build_object('source','email',
        'action',m.template,'status',m.status)
      from public.email_deliveries m
      where m.dedupe_key in ('order_confirmation:'||o.id,'order_shipped:'||o.id)
        or exists(select 1 from public.inquiry_messages im join public.inquiries iq on iq.id=im.inquiry_id
          where iq.order_id=o.id and m.dedupe_key='inquiry_answered:'||im.id)
    ) e
  ),'[]'::jsonb)
 ) into result from public.orders o left join public.profiles p on p.id=o.user_id
 where o.id=target_order_id;
 return result;
end;
$$;
revoke all on function public.admin_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_detail(uuid) to authenticated;

create or replace function public.admin_add_order_note(target_order_id uuid,target_body text,operation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); body text := btrim(target_body); written boolean;
begin
 if actor is null or not public.is_staff() then
  raise insufficient_privilege using message='staff_required';
 end if;
 if body is null or char_length(body) not between 1 and 2000 then
  raise invalid_parameter_value using message='note_body_invalid';
 end if;
 if operation_id is null then
  raise invalid_parameter_value using message='note_operation_required';
 end if;
 perform 1 from public.orders where id=target_order_id for key share;
 if not found then raise no_data_found using message='order_not_found'; end if;
 insert into public.audit_log(id,actor_id,action,target,diff)
 values(operation_id,actor,'admin.order.note','order:'||target_order_id,jsonb_build_object('body',body))
 on conflict(id) do nothing returning true into written;
 if not coalesce(written,false) and not exists(
   select 1 from public.audit_log where id=operation_id and actor_id=actor
     and action='admin.order.note' and target='order:'||target_order_id and diff->>'body'=body
 ) then raise invalid_parameter_value using message='note_operation_conflict'; end if;
 return coalesce(written,false);
end;
$$;
revoke all on function public.admin_add_order_note(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_add_order_note(uuid,text,uuid) to authenticated;
