-- Reviewed encrypted file issuance audit. Existing receipt/audit rows are immutable.
-- Only the application service can attest file issuance; actor is verified again under locks.
-- Passwords and password hashes are intentionally absent from both signatures.
create function public.service_record_encrypted_list_export(
 p_actor_id uuid,p_screen text,p_filters jsonb,p_row_count integer,p_record_count integer,p_file_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=p_actor_id; recorded_id uuid;
begin
 perform private.require_actor_operator_capability(actor,case when p_screen='orders' then 'sales.read' else 'sales.manage' end,false);
 if actor is null then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_screen is null or p_screen not in('orders','unpaid','dispatch','shipping','claims-cancels','claims-returns','claims-exchanges') then
  raise invalid_parameter_value using message='invalid_list_export_screen';end if;
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>2000
  or exists(select 1 from jsonb_each(p_filters) f where f.key not in
   ('view','field','query','status','state','from','to','dateField','paymentMethod','sort','fingerprint','tab','originId','method','delayNotice','stage','reasonType')
   or jsonb_typeof(f.value) not in('string','null')) then
  raise invalid_parameter_value using message='invalid_list_export_filters';end if;
 if p_row_count is null or p_row_count not between 0 and 10000 or p_record_count is null or p_record_count not between 0 and p_row_count then
  raise invalid_parameter_value using message='invalid_list_export_count';end if;
 if p_file_sha256 is null or p_file_sha256!~'^[a-f0-9]{64}$' then
  raise invalid_parameter_value using message='invalid_export_file_hash';end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.list_export.file_issued','admin_screen:'||p_screen,
  jsonb_build_object('screen',p_screen,'filters',p_filters,'rowCount',p_row_count,'recordCount',p_record_count,
   'format','xlsx','encryption','ECMA-376-Agile','fileSha256',p_file_sha256)) returning id into recorded_id;
 return recorded_id;
end $$;

create function public.service_record_encrypted_settled_export(p_actor_id uuid,p_export_id uuid,p_file_sha256 text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=p_actor_id; receipt private.settled_export_receipts; recorded_id uuid; item_count integer;
begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if actor is null then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_file_sha256 is null or p_file_sha256!~'^[a-f0-9]{64}$' then
  raise invalid_parameter_value using message='invalid_export_file_hash';end if;
 select * into receipt from private.settled_export_receipts where id=p_export_id and actor_id=actor;
 if not found then raise no_data_found using message='settled_export_not_found';end if;
 select coalesce(sum(jsonb_array_length(value->'items')),0)::integer into item_count from jsonb_array_elements(receipt.payload->'orders');
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.settled_export.file_issued','settled_export:'||receipt.id,
  jsonb_build_object('receiptId',receipt.id,'filters',receipt.filters,'orderCount',jsonb_array_length(receipt.payload->'orders'),
   'itemCount',item_count,'capturedAt',receipt.payload->>'capturedAt','format','xlsx','encryption','ECMA-376-Agile','fileSha256',p_file_sha256))
 returning id into recorded_id;
 return recorded_id;
end $$;

revoke all on function public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text),
 public.service_record_encrypted_settled_export(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text),
 public.service_record_encrypted_settled_export(uuid,uuid,text) to service_role;
select private.register_operator_rpc_contract('public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text)'::regprocedure,'sales.manage','service_start',false);
select private.register_operator_rpc_contract('public.service_record_encrypted_settled_export(uuid,uuid,text)'::regprocedure,'sales.manage','service_start',false);
