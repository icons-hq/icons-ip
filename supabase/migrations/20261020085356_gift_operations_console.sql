-- Reviewed operator gift read model and encrypted export receipts.
-- Awaiting acceptance is pre-payment; no financial amount is inferred here.
begin;
create function private.gift_console_state(p_gift private.gift_intents) returns text
language sql stable security definer set search_path='' as $$
 select case when p_gift.order_id is null and p_gift.state in('awaiting_acceptance','accepted')
  and p_gift.expires_at<=statement_timestamp() then 'expired' else p_gift.state end;
$$;
create function private.gift_console_row(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'state',private.gift_console_state(g),'senderName',left(g.sender_label,200),
  'recipientName',left(g.recipient_label,200),'goodsLabel',coalesce((select string_agg(
   left(coalesce(i.item_display->>'name','상품'),200)||case when nullif(i.item_display->>'variantName','') is null then ''
    else ' / '||left(i.item_display->>'variantName',200) end||' × '||i.qty::text,E'\n' order by i.position)
   from private.gift_items i where i.gift_id=g.id),''),'quantity',(select coalesce(sum(i.qty),0) from private.gift_items i where i.gift_id=g.id),
  'createdAt',g.created_at,'expiresAt',g.expires_at,'acceptedAt',g.accepted_at,'orderId',g.order_id)
 from private.gift_intents g where g.id=p_id;
$$;
create function private.gift_console_query(p_state text,p_search text) returns void
language plpgsql immutable security definer set search_path='' as $$begin
 if p_state is not null and p_state not in('awaiting_acceptance','accepted','ordered','declined','expired','canceled')
  or p_search is null or char_length(p_search)>100 or p_search<>btrim(p_search) or p_search~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_gift_console_filter';end if;
end $$;
create function private.gift_console_ids(p_state text,p_search text) returns table(id uuid,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select g.id,g.created_at from private.gift_intents g
 where (p_state is null or private.gift_console_state(g)=p_state) and (p_search='' or
  strpos(lower(g.id::text||' '||coalesce(g.order_id::text,'')||' '||g.sender_label||' '||coalesce(g.recipient_label,'')),lower(p_search))>0
  or exists(select 1 from private.gift_items i where i.gift_id=g.id and
   strpos(lower(coalesce(i.item_display->>'name','')||' '||coalesce(i.item_display->>'variantName','')),lower(p_search))>0));
$$;
create function public.admin_list_gifts(p_expected_actor_id uuid,p_state text default 'awaiting_acceptance',p_search text default '',p_page integer default 1,p_page_size integer default 100) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id or not public.has_operator_capability('sales.read',false) then
  raise insufficient_privilege using message='gift_operator_required';end if;
 perform private.gift_console_query(p_state,p_search);
 if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in(50,100,200) then
  raise invalid_parameter_value using message='invalid_gift_console_page';end if;
 with matches as materialized(select * from private.gift_console_ids(p_state,p_search)),
 page as(select * from matches order by created_at desc,id desc limit p_page_size offset ((p_page-1)::bigint*p_page_size))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(private.gift_console_row(id) order by created_at desc,id desc) from page),'[]'::jsonb),
  'total',(select count(*) from matches),'page',p_page,'pageSize',p_page_size,'asOf',statement_timestamp()) into result;
 return result;
end $$;
create table private.gift_export_receipts (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,filters jsonb not null,payload jsonb not null,
 fingerprint text not null check(fingerprint~'^[0-9a-f]{64}$'),snapshot_at timestamptz not null default statement_timestamp(),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create index gift_export_receipts_expiry on private.gift_export_receipts(expires_at);
create function public.admin_prepare_gift_export(p_expected_actor_id uuid,p_state text default 'awaiting_acceptance',p_search text default '') returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare rows jsonb;receipt private.gift_export_receipts;begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_operator_required';end if;
 perform private.require_actor_operator_capability(auth.uid(),'sales.read',false);perform private.gift_console_query(p_state,p_search);
 select coalesce(jsonb_agg(private.gift_console_row(id) order by created_at desc,id desc),'[]'::jsonb) into rows from
  (select * from private.gift_console_ids(p_state,p_search) order by created_at desc,id desc limit 10001) limited;
 if jsonb_array_length(rows)>10000 then raise program_limit_exceeded using message='gift_export_limit';end if;
 insert into private.gift_export_receipts(actor_id,filters,payload,fingerprint) values(auth.uid(),jsonb_build_object('state',p_state,'query',p_search),rows,
  encode(sha256(convert_to(rows::text,'UTF8')),'hex')) returning * into receipt;
 return jsonb_build_object('receiptId',receipt.id,'fingerprint',receipt.fingerprint,'rows',rows,'total',jsonb_array_length(rows),'asOf',receipt.snapshot_at);
end $$;
create function public.service_record_gift_export(p_actor_id uuid,p_receipt_id uuid,p_fingerprint text,p_file_sha256 text) returns uuid
language plpgsql volatile security definer set search_path='' as $$declare receipt private.gift_export_receipts;audit_id uuid;begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='service_role_required';end if;
 perform private.require_actor_operator_capability(p_actor_id,'sales.read',false);
 select * into receipt from private.gift_export_receipts where id=p_receipt_id and actor_id=p_actor_id for share;
 if not found or receipt.expires_at<=clock_timestamp() or receipt.fingerprint is distinct from p_fingerprint
  or p_file_sha256 is null or p_file_sha256!~'^[0-9a-f]{64}$' then raise check_violation using message='gift_export_changed';end if;
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.gift_export.file_issued','gift-export:'||receipt.id::text,
  jsonb_build_object('receiptId',receipt.id,'fingerprint',receipt.fingerprint,'rowCount',jsonb_array_length(receipt.payload),
   'fileSha256',p_file_sha256,'format','xlsx','encryption','ECMA-376-Agile')) returning id into audit_id;
 return audit_id;
end $$;
create function public.service_purge_gift_exports(p_limit integer default 1000) returns integer
language plpgsql volatile security definer set search_path='' as $$declare removed integer;begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='service_role_required';end if;
 if p_limit is null or p_limit not between 1 and 1000 then raise invalid_parameter_value using message='invalid_gift_purge_limit';end if;
 delete from private.gift_export_receipts where id in(select id from private.gift_export_receipts where created_at<clock_timestamp()-interval '24 hours'
  order by created_at,id for update skip locked limit p_limit);get diagnostics removed=row_count;return removed;
end $$;
alter table private.gift_export_receipts enable row level security;
revoke all on private.gift_export_receipts from public,anon,authenticated,service_role;
do $$declare item record;begin
 for item in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  n.nspname='private' and p.proname in('gift_console_state','gift_console_row','gift_console_query','gift_console_ids')
  or n.nspname='public' and p.proname in('admin_list_gifts','admin_prepare_gift_export','service_record_gift_export','service_purge_gift_exports') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
  if item.nspname='public' and item.proname like 'service_%' then execute format('grant execute on function %s to service_role',item.signature);
  elsif item.nspname='public' then execute format('grant execute on function %s to authenticated',item.signature);
  else execute format('grant execute on function %s to postgres',item.signature);end if;
  perform private.register_operator_internal_contract(item.signature);
 end loop;
end $$;
select private.register_operator_rpc_contract('public.admin_list_gifts(uuid,text,text,integer,integer)'::regprocedure,'sales.read','read',false);
select private.register_operator_rpc_contract('public.admin_prepare_gift_export(uuid,text,text)'::regprocedure,'sales.read','write',false);
select private.register_operator_rpc_contract('public.service_record_gift_export(uuid,uuid,text,text)'::regprocedure,'sales.read','service_start',false);
notify pgrst,'reload schema';
commit;
