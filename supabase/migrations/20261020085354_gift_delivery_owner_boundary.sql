-- Reviewed owner boundary preserving legacy function owners and private writes.
begin;

-- An existing postgres-owned administrator RPC must not need UPDATE privileges
-- on tables created by a different migration owner merely to acquire a lock.
create function private.lock_order_private_delivery(p_order_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 perform order_id from private.order_delivery_private_snapshots where order_id=p_order_id for update;
end $$;

create function private.lock_order_transaction_configurations(p_order_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 perform good_id from private.goods_transaction_configs
 where good_id in(select good_id from public.order_items where order_id=p_order_id)
 order by good_id for share;
end $$;

create function private.update_order_private_delivery(p_order_id uuid,p_address jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 update private.order_delivery_private_snapshots
 set address=p_address,address_revision=address_revision+1,updated_at=clock_timestamp()
 where order_id=p_order_id;
 if not found then raise check_violation using message='gift_delivery_snapshot_missing';end if;
end $$;

revoke all on function private.lock_order_private_delivery(uuid),private.lock_order_transaction_configurations(uuid),
 private.update_order_private_delivery(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.lock_order_private_delivery(uuid),private.lock_order_transaction_configurations(uuid),
 private.update_order_private_delivery(uuid,jsonb) to postgres;
do $$declare helper record;begin
 for helper in select * from (values
  ('private.lock_order_private_delivery(uuid)'::regprocedure,'private.order_delivery_private_snapshots'::regclass),
  ('private.lock_order_transaction_configurations(uuid)'::regprocedure,'private.goods_transaction_configs'::regclass),
  ('private.update_order_private_delivery(uuid,jsonb)'::regprocedure,'private.order_delivery_private_snapshots'::regclass)
 ) expected(signature,table_id) loop
  if not has_table_privilege((select proowner from pg_proc where oid=helper.signature::oid),helper.table_id,'SELECT')
   or not has_table_privilege((select proowner from pg_proc where oid=helper.signature::oid),helper.table_id,'UPDATE') then
   raise exception 'gift_delivery_helper_owner_privilege_missing';end if;
 end loop;
end $$;
select private.register_operator_internal_contract('private.lock_order_private_delivery(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.lock_order_transaction_configurations(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.update_order_private_delivery(uuid,jsonb)'::regprocedure);

-- Keep authentication, customer agreement, CAS, quote/money checks and the exact
-- lock order in the existing RPC. Replace only its three new-table operations.
do $patch$
declare definition text;pair text[];contract record;
 replacements text[][]:=array[
  array[$old$perform order_id from private.order_delivery_private_snapshots where order_id=p_order_id for update;$old$,
        $new$perform private.lock_order_private_delivery(p_order_id);$new$],
  array[$old$perform good_id from private.goods_transaction_configs where good_id in(select good_id from public.order_items where order_id=p_order_id) order by good_id for share;$old$,
        $new$perform private.lock_order_transaction_configurations(p_order_id);$new$],
  array[$old$update private.order_delivery_private_snapshots set address=address_value,address_revision=address_revision+1,updated_at=clock_timestamp() where order_id=p_order_id;
  if not found then raise check_violation using message='gift_delivery_snapshot_missing';end if;$old$,
        $new$perform private.update_order_private_delivery(p_order_id,address_value);$new$]
 ];
begin
 definition:=pg_get_functiondef('public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean)'::regprocedure);
 foreach pair slice 1 in array replacements loop
  if (length(definition)-length(replace(definition,pair[1],'')))/length(pair[1])<>1 then
   raise exception 'gift_delivery_owner_boundary_anchor_changed';end if;
  definition:=replace(definition,pair[1],pair[2]);
 end loop;
 execute definition;
 select * into contract from private.operator_rpc_contracts
 where signature::regprocedure='public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean)'::regprocedure;
 if not found then raise exception 'gift_delivery_owner_boundary_contract_missing';end if;
 perform private.register_operator_rpc_contract('public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean)'::regprocedure,
  contract.capability,contract.guard_kind,contract.legacy_admin_only);
end $patch$;

commit;
notify pgrst,'reload schema';
