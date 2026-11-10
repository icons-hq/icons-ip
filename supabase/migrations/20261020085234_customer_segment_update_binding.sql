-- Qualify the normalized condition separately from the persisted rule column.
create or replace function public.admin_save_customer_segment(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_name text,p_rule jsonb,p_estimate_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; normalized_rule jsonb; hash text; estimate private.customer_segment_estimates; previous private.customer_segments;
 request jsonb; replay jsonb; result jsonb; name_value text:=btrim(p_name); saved_revision integer;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null or p_estimate_id is null
  or name_value is null or char_length(name_value) not between 1 and 50 or name_value ~ '[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_customer_segment';end if;
 normalized_rule:=private.normalize_customer_segment_rule(p_rule);hash:=private.customer_segment_rule_hash(normalized_rule);
 request:=jsonb_build_object('id',p_id,'expectedRevision',p_expected_revision,'name',name_value,'rule',normalized_rule,'estimateId',p_estimate_id);
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-operation:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.customer_segment.saved',request);
 if replay is not null then return replay;end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-segment-catalog',0));
 select * into previous from private.customer_segments where id=p_id for update;
 if found then
  if previous.archived_at is not null then raise no_data_found using message='customer_segment_not_found';end if;
  if previous.preset_key is not null then raise insufficient_privilege using message='customer_segment_preset_readonly';end if;
  if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='customer_segment_changed';end if;
 elsif p_expected_revision<>0 then raise no_data_found using message='customer_segment_not_found';
 elsif (select count(*) from private.customer_segments where archived_at is null and preset_key is null)>=1000 then
  raise check_violation using message='customer_segment_limit';
 end if;
 select * into estimate from private.customer_segment_estimates where id=p_estimate_id;
 if not found or estimate.actor_id is distinct from actor or estimate.rule_hash<>hash or estimate.rule<>normalized_rule
  or estimate.valid_until<=clock_timestamp() then raise object_not_in_prerequisite_state using message='customer_segment_estimate_required';end if;
 if not private.customer_segment_references_available(normalized_rule) then raise object_not_in_prerequisite_state using message='customer_segment_target_unavailable';end if;
 if previous.id is null then
  insert into private.customer_segments(id,name,rule_version,rule,rule_hash,estimate_id,created_by,updated_by)
  values(p_id,name_value,1,normalized_rule,hash,p_estimate_id,actor,actor) returning revision into saved_revision;
 else
  update private.customer_segments set name=name_value,rule_version=1,rule=normalized_rule,rule_hash=hash,estimate_id=p_estimate_id,
   revision=revision+1,updated_at=clock_timestamp(),updated_by=actor where id=p_id returning revision into saved_revision;
 end if;
 result:=jsonb_build_object('id',p_id,'revision',saved_revision,'ruleHash',hash);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.customer_segment.saved','customer_segment:'||p_id::text,
  jsonb_build_object('request',request,'previousRuleHash',previous.rule_hash,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_customer_segment(uuid,integer,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_customer_segment(uuid,integer,uuid,text,jsonb,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_save_customer_segment(uuid,integer,uuid,text,jsonb,uuid)','marketing.manage','write',false);
notify pgrst,'reload schema';
