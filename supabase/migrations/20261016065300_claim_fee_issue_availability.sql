begin;
do $$declare definition text;anchor text:='''canIssue'',p_operator and p.enabled and c.claim_type';begin
 definition:=pg_get_functiondef('private.claim_fee_document(uuid,uuid,boolean)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'claim_fee_availability_anchor_changed';end if;
 execute replace(definition,anchor,'''canIssue'',p_operator and p.enabled and not exists(select 1 from private.account_action_fences where subject_user_id=any(private.contact_parties(c.order_id))) and c.claim_type');
end $$;
commit;
