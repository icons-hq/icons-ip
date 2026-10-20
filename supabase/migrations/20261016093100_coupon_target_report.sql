-- Keep current definition filters consistent across summary, issuance detail and export.
begin;
do $patch$ declare source text;begin
 select pg_get_functiondef('public.admin_benefit_issuances(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure) into source;
 if md5(source)<>'f96fe68308942644913731e60bc2eca9' then raise exception 'Coupon target report dependency changed';end if;
 source:=replace(source,$old$('all','first_purchase','repeat_purchase')$old$,$new$('all','first_purchase','repeat_purchase','targeted')$new$);
 source:=replace(source,$old$(p_segment='all' or c.recipient_segment=p_segment)$old$,$new$(p_segment='all' or (p_segment='targeted' and c.issuance_mode='targeted') or (p_segment<>'targeted' and c.recipient_segment=p_segment))$new$);
 execute source;
end $patch$;
select private.register_operator_rpc_contract('public.admin_benefit_issuances(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_internal_contract('public.admin_benefit_issuances(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure);
do $patch$ declare source text;begin
 select pg_get_functiondef('public.admin_benefit_report(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure) into source;
 if md5(source)<>'fc3488ad334f0e74edd30a19444544f3' then raise exception 'Coupon target report dependency changed';end if;
 source:=replace(source,$old$('all','first_purchase','repeat_purchase')$old$,$new$('all','first_purchase','repeat_purchase','targeted')$new$);
 source:=replace(source,$old$(p_segment='all' or c.recipient_segment=p_segment)$old$,$new$(p_segment='all' or (p_segment='targeted' and c.issuance_mode='targeted') or (p_segment<>'targeted' and c.recipient_segment=p_segment))$new$);
 execute source;
end $patch$;
select private.register_operator_rpc_contract('public.admin_benefit_report(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure,'marketing.manage','read',false);
select private.register_operator_internal_contract('public.admin_benefit_report(timestamp with time zone,timestamp with time zone,text,text,text,text,integer,integer)'::regprocedure);
notify pgrst,'reload schema';
commit;
