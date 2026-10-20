begin;
create table private.marketing_test_receipts (
 id uuid primary key, actor_id uuid not null references public.profiles(id) on delete cascade,
 campaign_id uuid not null references private.marketing_campaigns(id), campaign_revision integer not null,
 session_id uuid not null, content jsonb not null, notification_id uuid not null references public.notifications(id) on delete cascade,
 registered_at timestamptz not null default clock_timestamp()
);
alter table private.marketing_test_receipts enable row level security;
revoke all on private.marketing_test_receipts from public,anon,authenticated,service_role;
create index marketing_test_receipts_actor on private.marketing_test_receipts(actor_id,registered_at desc);

create function public.admin_send_marketing_test(p_campaign_id uuid,p_expected_revision integer,p_operation_id uuid,p_expected_actor uuid,p_expected_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; campaign private.marketing_campaigns; request jsonb; replay jsonb; result jsonb; notification uuid; moment timestamptz;
begin
 actor:=private.require_operator_capability('marketing.manage',false);
 if p_expected_actor is distinct from actor or p_expected_session is null or auth.jwt()->>'session_id' is distinct from p_expected_session::text
  or not exists(select 1 from auth.sessions where id=p_expected_session and user_id=actor and (not_after is null or not_after>clock_timestamp())) then raise insufficient_privilege using message='marketing_test_auth_changed';end if;
 if p_campaign_id is null or p_expected_revision is null or p_expected_revision<1 or p_operation_id is null then raise invalid_parameter_value;end if;
 request:=jsonb_build_object('campaignId',p_campaign_id,'revision',p_expected_revision,'sessionId',p_expected_session);
 perform pg_advisory_xact_lock(hashtextextended('marketing-test:'||p_operation_id::text,0));
 replay:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.marketing.test_sent',request);if replay is not null then return replay;end if;
 select * into campaign from private.marketing_campaigns where id=p_campaign_id for share;
 if not found or campaign.revision<>p_expected_revision or campaign.archived_at is not null then raise sqlstate 'PT409' using message='marketing_campaign_changed';end if;
 if not private.marketing_content_available(campaign.content) then raise check_violation using message='marketing_product_unavailable';end if;
 moment:=clock_timestamp();
 insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
 values(actor,'marketing_message','[테스트] '||left(campaign.content->>'title',110),campaign.content->>'body','/notifications/marketing-test/'||p_operation_id,
  'marketing_test',p_operation_id::text,'marketing-test:'||p_operation_id) returning id into notification;
 insert into private.marketing_test_receipts(id,actor_id,campaign_id,campaign_revision,session_id,content,notification_id,registered_at)
  values(p_operation_id,actor,campaign.id,campaign.revision,p_expected_session,campaign.content,notification,moment);
 result:=jsonb_build_object('receiptId',p_operation_id,'notificationId',notification,'registeredAt',moment,'linkPath','/notifications/marketing-test/'||p_operation_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.marketing.test_sent','marketing_campaign:'||p_campaign_id,jsonb_build_object('request',request,'result',result));
 return result;
end $$;
revoke all on function public.admin_send_marketing_test(uuid,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_send_marketing_test(uuid,integer,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_send_marketing_test(uuid,integer,uuid,uuid,uuid)'::regprocedure,'marketing.manage','write',false);

create function public.get_my_marketing_test_receipt(p_receipt_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_operator_capability('marketing.manage',false) then return null;end if;
 return (select jsonb_build_object('id',r.id,'registeredAt',r.registered_at,'content',r.content,'coupon',private.marketing_coupon_document(r.content->>'couponCode'),
  'goodIds',coalesce((select jsonb_agg(g.id order by choice.position) from jsonb_array_elements_text(r.content->'goodIds') with ordinality choice(id,position)
   join public.goods g on g.id=choice.id join public.ips i on i.id=g.ip_id where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and i.archived_at is null and i.published_at is not null),'[]'))
  from private.marketing_test_receipts r where r.id=p_receipt_id and r.actor_id=auth.uid());
end $$;
revoke all on function public.get_my_marketing_test_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_marketing_test_receipt(uuid) to authenticated;
select private.register_operator_rpc_contract('public.get_my_marketing_test_receipt(uuid)'::regprocedure,'marketing.manage','read',false);
commit;
