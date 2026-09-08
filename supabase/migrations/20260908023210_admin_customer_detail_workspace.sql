-- #430: customer detail reuses the existing member role and consent contract.
-- Histories are paged in the database; note bodies never enter public messages or audit diffs.
-- Customer notes are private operational records, never owner-readable messages.
create table public.customer_notes (
 id uuid primary key default extensions.gen_random_uuid(),
 customer_id uuid not null references public.profiles(id) on delete cascade,
 author_id uuid references public.profiles(id) on delete set null,
 body text not null check (char_length(body) between 1 and 2000 and body=btrim(body) and body ~ '[^[:space:]]'),
 created_at timestamptz not null default now()
);
create index customer_notes_customer_created on public.customer_notes(customer_id,created_at desc,id desc);
alter table public.customer_notes enable row level security;
revoke all on public.customer_notes from public,anon,authenticated,service_role;
grant select on public.customer_notes to authenticated;
create policy customer_notes_staff_read on public.customer_notes for select to authenticated using ((select public.is_staff()));

create function public.admin_customer_detail(target_user_id uuid,target_tab text default 'overview',target_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare customer jsonb; counts jsonb; rows jsonb := '[]'::jsonb; total bigint:=0; page integer; page_size constant integer:=20;
begin
 if (select auth.uid()) is null or not public.is_staff() then
  raise insufficient_privilege using message='staff_required';
 end if;
 if target_tab is null or target_tab not in ('overview','orders','inquiries','claims','coupons','notes') then
  raise invalid_parameter_value using message='customer_tab_invalid';
 end if;
 if not exists(select 1 from public.profiles where id=target_user_id) then return null; end if;
 select jsonb_build_object('id',m.profile_id,'nickname',m.nickname,'email',m.email,'role',m.role,
   'createdAt',m.created_at,'consents',jsonb_build_object('terms',coalesce(m.consents->'terms'='true'::jsonb,false),
     'privacy',coalesce(m.consents->'privacy'='true'::jsonb,false),'marketing',coalesce(m.consents->'marketing'='true'::jsonb,false)),
   'suspendedAt',m.suspended_at,'suspensionReason',m.suspension_reason,'loyaltyGrade',p.loyalty_grade,
   'goodsOrderCount',m.goods_order_count,'ticketOrderCount',m.ticket_order_count,
   'submittedReportCount',m.submitted_report_count,'receivedReportCount',m.received_report_count)
 into customer from public.admin_get_member_detail(target_user_id) m join public.profiles p on p.id=m.profile_id;
 select jsonb_build_object('orders',(select count(*) from public.orders where user_id=target_user_id),
  'inquiries',(select count(*) from public.inquiries where user_id=target_user_id),
  'claims',(select count(*) from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where o.user_id=target_user_id),
  'coupons',(select count(*) from public.user_coupons where user_id=target_user_id),'notes',(select count(*) from public.customer_notes where customer_id=target_user_id)) into counts;
 total:=coalesce((counts->>target_tab)::bigint,0);
 page:=least(greatest(coalesce(target_page,1),1),greatest(1,(total+page_size-1)/page_size)::integer);
 if target_tab='orders' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'amount',r.total,
   'createdAt',r.created_at,'title',coalesce((select i.good_name_snapshot from public.order_items i where i.order_id=r.id order by i.id limit 1),'주문 상품'),
   'itemCount',(select count(*) from public.order_items i where i.order_id=r.id)) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select o.id,o.status,o.total,o.created_at from public.orders o where o.user_id=target_user_id
   order by o.created_at desc,o.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='inquiries' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'status',r.status,
   'createdAt',r.created_at,'orderId',r.order_id) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select i.id,i.title,i.status,i.created_at,i.order_id from public.inquiries i where i.user_id=target_user_id
   order by i.created_at desc,i.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='claims' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'orderId',r.order_id,'claimType',r.claim_type,
   'status',r.stage,'createdAt',r.requested_at,'title',r.reason) order by r.requested_at desc,r.id desc),'[]'::jsonb)
  into rows from (select c.id,c.order_id,c.claim_type,c.stage,c.requested_at,c.reason
   from public.order_cancellation_requests c join public.orders o on o.id=c.order_id where o.user_id=target_user_id
   order by c.requested_at desc,c.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='coupons' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.name,'code',r.coupon_code,
   'status',case when r.status='used' then 'used' when r.expires_at<=now() then 'expired' else 'active' end,
   'createdAt',r.issued_at,'expiresAt',r.expires_at,'orderId',r.used_order_id)
   order by r.issued_at desc,r.id desc),'[]'::jsonb)
  into rows from (select h.id,h.coupon_code,c.name,h.status,h.issued_at,least(h.expires_at,c.ends_at) as expires_at,h.used_order_id
   from public.user_coupons h join public.coupons c on c.code=h.coupon_code where h.user_id=target_user_id
   order by h.issued_at desc,h.id desc limit page_size offset (page-1)*page_size) r;
 elsif target_tab='notes' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'body',r.body,'createdAt',r.created_at,
   'authorName',coalesce(p.nickname,'탈퇴한 운영자')) order by r.created_at desc,r.id desc),'[]'::jsonb)
  into rows from (select n.id,n.body,n.author_id,n.created_at from public.customer_notes n where n.customer_id=target_user_id
   order by n.created_at desc,n.id desc limit page_size offset (page-1)*page_size) r
   left join public.profiles p on p.id=r.author_id;
 end if;
 return jsonb_build_object('customer',customer,'counts',counts,'tab',target_tab,'page',page,'pageSize',page_size,'total',total,'items',rows);
end;
$$;
revoke all on function public.admin_customer_detail(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_customer_detail(uuid,text,integer) to authenticated;

create function public.admin_add_customer_note(target_user_id uuid,target_body text,operation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid:=(select auth.uid()); normalized_body text:=btrim(target_body); written boolean;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if normalized_body is null or char_length(normalized_body) not between 1 and 2000 or normalized_body !~ '[^[:space:]]'
 then raise invalid_parameter_value using message='customer_note_invalid'; end if;
 if operation_id is null then raise invalid_parameter_value using message='customer_note_operation_required'; end if;
 perform 1 from public.profiles where id=target_user_id for key share;
 if not found then raise no_data_found using message='customer_not_found'; end if;
 insert into public.customer_notes(id,customer_id,author_id,body)
 values(operation_id,target_user_id,actor,normalized_body) on conflict(id) do nothing returning true into written;
 if coalesce(written,false) then
  insert into public.audit_log(actor_id,action,target,diff)
  values(actor,'admin.customer.note_added','profile:'||target_user_id,jsonb_build_object('noteId',operation_id));
 elsif not exists(select 1 from public.customer_notes where id=operation_id and customer_id=target_user_id
   and author_id=actor and body=normalized_body) then raise invalid_parameter_value using message='customer_note_operation_conflict';
 end if;
 return coalesce(written,false);
end;
$$;
revoke all on function public.admin_add_customer_note(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_add_customer_note(uuid,text,uuid) to authenticated;

-- Preserve masked summaries and partial search, but exact email matches outrank newer partial matches.
create or replace function public.admin_search_members(
  target_query text default null,
  target_limit integer default 20,
  target_offset integer default 0
)
returns table (
  profile_id uuid,
  nickname text,
  masked_email text,
  role public.user_role,
  created_at timestamptz,
  suspended_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_query text := nullif(
    pg_catalog.btrim(coalesce(target_query, ''), E' \t\n\r\f\v'),
    ''
  );
  normalized_limit integer := least(
    greatest(coalesce(target_limit, 20), 1),
    100
  );
  normalized_offset integer := greatest(
    coalesce(target_offset, 0),
    0
  );
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_query is not null and pg_catalog.length(normalized_query) > 100 then
    raise exception 'member_search_query_too_long' using errcode = '22023';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || pg_catalog.left(profile.id::text, 6)
    ),
    case
      when nullif(pg_catalog.btrim(coalesce(profile.email, '')), '') is null
        then '이메일 없음'::text
      when pg_catalog.strpos(profile.email, '@') > 1
        then pg_catalog.left(pg_catalog.split_part(profile.email, '@', 1), 1)
          || '***@'
          || pg_catalog.split_part(profile.email, '@', 2)
      else '***'::text
    end,
    profile.role,
    profile.created_at,
    profile.suspended_at,
    pg_catalog.count(*) over()::bigint
  from public.profiles as profile
  where normalized_query is null
    or pg_catalog.strpos(
      pg_catalog.lower(coalesce(profile.nickname, '')),
      pg_catalog.lower(normalized_query)
    ) > 0
    or pg_catalog.strpos(
      pg_catalog.lower(coalesce(profile.email, '')),
      pg_catalog.lower(normalized_query)
    ) > 0
  order by case when pg_catalog.lower(profile.email)=pg_catalog.lower(normalized_query) then 0 else 1 end,
    profile.created_at desc, profile.id desc
  limit normalized_limit
  offset normalized_offset;
end;
$$;

revoke all on function public.admin_search_members(text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_members(text,integer,integer) to authenticated;
