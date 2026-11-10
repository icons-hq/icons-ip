begin;
-- Keep ordinary review eligibility for legacy delivered orders whose historical
-- payment evidence predates the current provider-attempt contract.
do $$
declare source text;anchor text;signature regprocedure;
begin
 signature:='public.create_good_review_v2(uuid,text,integer,text,text[],text)'::regprocedure;
 source:=pg_get_functiondef(signature);anchor:='if not private.review_event_purchase_eligible(ordered.id,actor,target_good_id) then';
 if strpos(source,anchor)=0 then raise exception 'review_type_create_source_changed';end if;
 execute replace(source,anchor,'if target_kind=''month'' and not private.review_event_purchase_eligible(ordered.id,actor,target_good_id) then');
 signature:='public.update_good_review(uuid,integer,text,text[])'::regprocedure;
 source:=pg_get_functiondef(signature);anchor:='r.id=target_review_id and private.review_event_purchase_eligible(r.order_id,r.user_id,r.good_id)';
 if strpos(source,anchor)=0 then raise exception 'review_type_update_source_changed';end if;
 execute replace(source,anchor,'r.id=target_review_id and (r.review_kind=''ordinary'' or private.review_event_purchase_eligible(r.order_id,r.user_id,r.good_id))');
 signature:='public.my_review_targets_v2(uuid,text,integer)'::regprocedure;
 source:=pg_get_functiondef(signature);anchor:='private.review_event_purchase_eligible(ordered.id,v_actor,item.good_id)';
 if strpos(source,anchor)=0 then raise exception 'review_type_target_source_changed';end if;
 execute replace(source,anchor,'(kind.value=''ordinary'' or private.review_event_purchase_eligible(ordered.id,v_actor,item.good_id))');
end $$;
notify pgrst,'reload schema';
commit;
