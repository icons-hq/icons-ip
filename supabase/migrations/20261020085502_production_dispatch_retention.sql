begin;
create function private.shipment_production_summary(p_shipment uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('count',count(*),'completed',count(*) filter(where j.state='completed'),'ready',coalesce(bool_and(j.state='completed'),true),'dueAt',max(j.due_at))
 from private.order_production_jobs j join public.order_shipment_items i on i.order_item_id=j.order_item_id where i.shipment_id=p_shipment and j.claim_id is null;
$$;
create function public.admin_shipment_production_summaries(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);
 if p_ids is null or cardinality(p_ids)>1000 or array_position(p_ids,null) is not null then raise invalid_parameter_value;end if;
 return (select coalesce(jsonb_object_agg(s.id,private.shipment_production_summary(s.id)),'{}') from public.order_shipments s where s.id=any(p_ids));
end $$;
do $$declare source text;anchor text:='result:=jsonb_build_object(''jobId'',p_job';begin
 source:=pg_get_functiondef('public.admin_change_order_production(uuid,text,bigint,uuid,uuid,uuid,text)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'production_change_source_changed';end if;
 execute replace(source,anchor,E'if job.claim_id is null then update public.order_shipments set updated_at=clock_timestamp() where id in(select shipment_id from public.order_shipment_items where order_item_id=job.order_item_id);end if;\n '||anchor);
end $$;
alter function public.admin_shipment_export(uuid[]) rename to admin_shipment_export_before_production;
alter function public.admin_shipment_export_before_production(uuid[]) set schema private;
revoke all on function private.admin_shipment_export_before_production(uuid[]) from public,anon,authenticated,service_role;
create function public.admin_shipment_export(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=private.admin_shipment_export_before_production(p_ids);
 if exists(select 1 from jsonb_array_elements(result->'shipments') s where (private.shipment_production_summary((s->>'id')::uuid)->>'ready')::boolean is distinct from true) then raise check_violation using message='production_incomplete';end if;
 return result;
end $$;
-- Retain only structured fulfillment contract facts under the existing transaction
-- retention basis; never copy employee/session identities or free-text evidence.
do $$declare definition text;begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='private.account_deletion_legal_snapshots'::regclass and conname='account_deletion_legal_snapshots_record_type_check';
 if definition is null or position('ARRAY[' in definition)=0 then raise exception 'production_snapshot_type_changed';end if;
 alter table private.account_deletion_legal_snapshots drop constraint account_deletion_legal_snapshots_record_type_check;
 execute 'alter table private.account_deletion_legal_snapshots add constraint account_deletion_legal_snapshots_record_type_check '||replace(definition,'ARRAY[','ARRAY[''order_production''::text,');
end $$;
create function private.snapshot_order_production_contracts(p_event uuid,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$begin
 insert into private.account_deletion_legal_snapshots(deletion_event_id,record_type,record_ref,snapshot_data,legal_basis,retain_until)
 select p_event,'order_production',j.id::text,jsonb_build_object('jobRef',j.id,'orderRef',j.order_id,'itemRef',j.order_item_id,'claimRef',j.claim_id,'state',j.state,
 'terms',j.terms-'publicNote','basisAt',j.basis_at,'dueAt',j.due_at,'startedAt',j.started_at,'completedAt',j.completed_at,
 'events',coalesce((select jsonb_agg(jsonb_build_object('operationId',e.id,'kind',e.kind,'at',e.created_at) order by e.created_at,e.id) from private.order_production_events e where e.job_id=j.id),'[]')),
 'ecommerce_transaction_v1',greatest(j.created_at,j.updated_at,j.completed_at)+interval '5 years'
 from private.order_production_jobs j where p_actor=any(private.contact_parties(j.order_id)) and greatest(j.created_at,j.updated_at,j.completed_at)+interval '5 years'>clock_timestamp()
 on conflict(deletion_event_id,record_type,record_ref) do update set snapshot_data=excluded.snapshot_data,retain_until=greatest(private.account_deletion_legal_snapshots.retain_until,excluded.retain_until) where private.account_deletion_legal_snapshots.destroyed_at is null;
end $$;
do $$declare source text;anchor text:='perform private.snapshot_claim_fee_contracts(p_deletion_event_id,p_user_id);';begin
 source:=pg_get_functiondef('private.snapshot_account_deletion_legal_records(uuid,uuid)'::regprocedure);
 if strpos(source,anchor)=0 then raise exception 'production_retention_source_changed';end if;
 execute replace(source,anchor,anchor||E'\n perform private.snapshot_order_production_contracts(p_deletion_event_id,p_user_id);');
end $$;
revoke all on function private.shipment_production_summary(uuid),private.snapshot_order_production_contracts(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_shipment_production_summaries(uuid[]),public.admin_shipment_export(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_production_summaries(uuid[]),public.admin_shipment_export(uuid[]) to authenticated;
select private.register_operator_internal_contract('private.shipment_production_summary(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.snapshot_order_production_contracts(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.admin_shipment_export_before_production(uuid[])'::regprocedure);
select private.register_operator_rpc_contract('public.admin_shipment_production_summaries(uuid[])'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_shipment_export(uuid[])'::regprocedure,'sales.manage','read',false);
notify pgrst,'reload schema';
commit;
