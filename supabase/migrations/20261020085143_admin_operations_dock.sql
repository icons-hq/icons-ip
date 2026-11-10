-- 운영 알림은 구매자 알림과 분리한다. 본문/연락처 없이 사건·관리화면 경로만 저장한다.
create table private.admin_operation_alerts (
 id uuid primary key default gen_random_uuid(), event_key text not null unique,
 category text not null check(category in('orders','claims','inquiries','questions','reviews')),
 title text not null check(length(title) between 1 and 120), href text not null check(href like '/admin/%'),
 created_at timestamptz not null default clock_timestamp()
);
create index admin_operation_alerts_recent on private.admin_operation_alerts(created_at desc,id desc);
create table private.admin_operation_alert_states (
 alert_id uuid not null references private.admin_operation_alerts(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,
 read_at timestamptz, hidden_at timestamptz, primary key(alert_id,actor_id)
);
create table private.admin_operation_alert_preferences (
 actor_id uuid primary key references public.profiles(id) on delete cascade,
 badge_enabled boolean not null default true, updated_at timestamptz not null default clock_timestamp()
);
alter table private.admin_operation_alerts enable row level security;
alter table private.admin_operation_alert_states enable row level security;
alter table private.admin_operation_alert_preferences enable row level security;
revoke all on private.admin_operation_alerts,private.admin_operation_alert_states,private.admin_operation_alert_preferences from public,anon,authenticated,service_role;
grant all on private.admin_operation_alerts,private.admin_operation_alert_states,private.admin_operation_alert_preferences to postgres;

create function private.capture_admin_operation_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare current_row jsonb:=to_jsonb(new); previous_row jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 event_category text; event_title text; event_href text; event_suffix text:='created';
begin
 if tg_table_name='orders' then
  if current_row->>'status'<>'paid' or previous_row->>'status'='paid' then return new;end if;
  event_category:='orders';event_title:='신규 결제 주문이 있습니다.';event_href:='/admin/sales/orders/'||(current_row->>'id');event_suffix:='paid';
 elsif tg_table_name='order_cancellation_requests' then
  if tg_op='INSERT' and current_row->>'stage' not in('requested','needs_review') then return new;end if;
  if tg_op='UPDATE' and (current_row->>'stage'<>'needs_review' or previous_row->>'stage'='needs_review') then return new;end if;
  event_category:='claims'; event_title:=case current_row->>'claim_type' when 'return' then '반품' when 'exchange' then '교환' else '취소' end||case when tg_op='INSERT' then ' 요청이 접수되었습니다.' else ' 처리 결과를 확인해주세요.' end;
  event_href:='/admin/sales/claims/'||case current_row->>'claim_type' when 'return' then 'returns' when 'exchange' then 'exchanges' else 'cancels' end||'/'||(current_row->>'id');
  event_suffix:=case when tg_op='INSERT' then 'created' else 'needs_review' end;
 elsif tg_table_name='inquiries' then
  if current_row->>'status'<>'open' or (tg_op='UPDATE' and previous_row->>'status'='open') then return new;end if;
  event_category:='inquiries';event_title:=case when tg_op='INSERT' then '고객문의가 접수되었습니다.' else '고객문의에 다시 답변이 필요합니다.' end;
  event_href:='/admin/cs/inquiries/'||(current_row->>'id');
  event_suffix:=case when tg_op='INSERT' then 'created' else 'reopened:'||(current_row->>'last_message_at') end;
 elsif tg_table_name='product_questions' then
  event_category:='questions';event_title:='상품문의가 등록되었습니다.';event_href:='/admin/cs/qna?status=unanswered';
 elsif tg_table_name='reviews' then
  event_category:='reviews';event_title:=case when (current_row->>'rating')::integer<=2 then '낮은 평점 리뷰가 등록되었습니다.' else '새 리뷰가 등록되었습니다.' end;event_href:='/admin/cs/reviews?reviewId='||(current_row->>'id');
 else return new;
 end if;
 insert into private.admin_operation_alerts(event_key,category,title,href)
 values(tg_table_name||':'||(current_row->>'id')||':'||event_suffix,event_category,event_title,event_href)
 on conflict(event_key) do nothing;
 return new;
end;$$;
revoke all on function private.capture_admin_operation_alert() from public,anon,authenticated,service_role;
create trigger orders_admin_operation_alert after insert or update of status on public.orders for each row execute function private.capture_admin_operation_alert();
create trigger claims_admin_operation_alert after insert or update of status,stage on public.order_cancellation_requests for each row execute function private.capture_admin_operation_alert();
create trigger inquiries_admin_operation_alert after insert or update of status on public.inquiries for each row execute function private.capture_admin_operation_alert();
create trigger questions_admin_operation_alert after insert on public.product_questions for each row execute function private.capture_admin_operation_alert();
create trigger reviews_admin_operation_alert after insert on public.reviews for each row execute function private.capture_admin_operation_alert();

create function public.admin_operation_alerts(
 p_category text default 'all',p_state text default 'all',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 30
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required';end if;
 if p_category is null or p_category not in('all','orders','claims','inquiries','questions','reviews')
  or p_state is null or p_state not in('all','unread','hidden') or p_limit is null or p_limit not between 1 and 50
  or (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then
  raise invalid_parameter_value using message='invalid_alert_filter';end if;
 with visible as materialized (
  select a.id,a.category,a.title,a.href,a.created_at,s.read_at,s.hidden_at
  from private.admin_operation_alerts a left join private.admin_operation_alert_states s on s.alert_id=a.id and s.actor_id=actor
  where a.created_at>statement_timestamp()-interval '90 days'
 ), filtered as (
  select * from visible where(p_category='all' or category=p_category)
   and case p_state when 'hidden' then hidden_at is not null when 'unread' then hidden_at is null and read_at is null else hidden_at is null end
   and(p_before is null or(created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit p_limit+1
 ) select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,'href',href,'createdAt',created_at,'readAt',read_at,'hiddenAt',hidden_at) order by created_at desc,id desc)
    from(select * from filtered order by created_at desc,id desc limit p_limit)page),'[]'::jsonb),
  'hasMore',(select count(*)>p_limit from filtered),
  'unreadCount',(select count(*) from visible where read_at is null and hidden_at is null),
  'badgeEnabled',coalesce((select badge_enabled from private.admin_operation_alert_preferences where actor_id=actor),true),
  'asOf',statement_timestamp()
 )into result;
 return result;
end;$$;
revoke all on function public.admin_operation_alerts(text,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_operation_alerts(text,text,timestamptz,uuid,integer) to authenticated;

-- 전체 처리도 조회 시점보다 뒤의 새 알림은 포함하지 않는다. 숨김은 본인만의 가역 상태다.
create function public.admin_update_operation_alerts(p_action text,p_ids uuid[],p_through timestamptz,p_category text default 'all',p_state text default 'all') returns integer
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); changed integer;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required';end if;
 if p_action is null or p_action not in('read','hide','restore') or p_through is null or not isfinite(p_through) or p_through>clock_timestamp()
  or (p_ids is not null and(cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null))
  or p_category is null or p_category not in('all','orders','claims','inquiries','questions','reviews')
  or p_state is null or p_state not in('all','unread','hidden') then
  raise invalid_parameter_value using message='invalid_alert_update';end if;
 insert into private.admin_operation_alert_states(alert_id,actor_id,read_at,hidden_at)
 select a.id,actor,case when p_action='read' then clock_timestamp() end,case when p_action='hide' then clock_timestamp() end
 from private.admin_operation_alerts a left join private.admin_operation_alert_states s on s.alert_id=a.id and s.actor_id=actor
 where a.created_at<=p_through and a.created_at>statement_timestamp()-interval '90 days'
  and(p_ids is null or a.id=any(p_ids)) and(p_category='all' or a.category=p_category)
  and case p_state when 'hidden' then s.hidden_at is not null when 'unread' then s.read_at is null and s.hidden_at is null else s.hidden_at is null end
 on conflict(alert_id,actor_id) do update set
  read_at=case when p_action='read' then coalesce(private.admin_operation_alert_states.read_at,excluded.read_at) else private.admin_operation_alert_states.read_at end,
  hidden_at=case when p_action='hide' then coalesce(private.admin_operation_alert_states.hidden_at,excluded.hidden_at) when p_action='restore' then null else private.admin_operation_alert_states.hidden_at end;
 get diagnostics changed=row_count;
 return changed;
end;$$;
revoke all on function public.admin_update_operation_alerts(text,uuid[],timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_operation_alerts(text,uuid[],timestamptz,text,text) to authenticated;

create function public.admin_set_operation_alert_badge(p_enabled boolean) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required';end if;
 if p_enabled is null then raise invalid_parameter_value using message='invalid_alert_preference';end if;
 insert into private.admin_operation_alert_preferences(actor_id,badge_enabled) values(actor,p_enabled)
 on conflict(actor_id) do update set badge_enabled=excluded.badge_enabled,updated_at=clock_timestamp();
 return p_enabled;
end;$$;
revoke all on function public.admin_set_operation_alert_badge(boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_operation_alert_badge(boolean) to authenticated;

create function public.admin_operation_tasks() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff_required';end if;
 return jsonb_build_array(
  jsonb_build_object('id','paid','label','신규주문','count',(select count(*) from public.orders where status='paid'),'href','/admin/sales/orders?status=paid'),
  jsonb_build_object('id','cancel','label','취소요청','count',(select count(*) from public.order_cancellation_requests where claim_type='cancel' and stage='requested'),'href','/admin/sales/claims/cancels?stage=requested'),
  jsonb_build_object('id','return','label','반품요청','count',(select count(*) from public.order_cancellation_requests where claim_type='return' and stage='requested'),'href','/admin/sales/claims/returns?stage=requested'),
  jsonb_build_object('id','exchange','label','교환요청','count',(select count(*) from public.order_cancellation_requests where claim_type='exchange' and stage='requested'),'href','/admin/sales/claims/exchanges?stage=requested'),
  jsonb_build_object('id','inquiries','label','미답변 고객문의','count',(select count(*) from public.inquiries where status='open'),'href','/admin/cs/inquiries?status=open'),
  jsonb_build_object('id','questions','label','미답변 상품문의','count',(select count(*) from public.product_questions where status='visible' and answer_body is null),'href','/admin/cs/qna?status=unanswered'),
  jsonb_build_object('id','reviews','label','미답글 리뷰','count',(select count(*) from public.reviews where status='visible' and admin_reply is null),'href','/admin/cs/reviews?reply=without&status=visible')
 );
end;$$;
revoke all on function public.admin_operation_tasks() from public,anon,authenticated,service_role;
grant execute on function public.admin_operation_tasks() to authenticated;

-- 운영 알림은 90일 조회·보존. 개인별 읽음/숨김도 FK cascade로 함께 정리한다.
select cron.schedule('admin-operation-alerts-retention','17 3 * * *',$job$delete from private.admin_operation_alerts where created_at<now()-interval '90 days'$job$);
notify pgrst,'reload schema';
