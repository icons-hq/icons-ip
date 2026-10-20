-- Home representative reviews prefer currently eligible selected BEST reviews.
-- Change only the representative review of an already eligible home product.
-- The ordinary aggregate stays SECURITY INVOKER with its existing public shape.

do $contract$
begin
  -- These read predicates are mirrored below because an existing local database
  -- has mixed helper owners. Do not widen helper ACLs or normalize their owners.
  if (select md5(prosrc) from pg_proc where oid='private.review_event_purchase_eligible(uuid,uuid,text)'::regprocedure)
       is distinct from '7dd4b2594b429843867c0ce0b19aabf3'
    or (select md5(prosrc) from pg_proc where oid='private.review_event_review_fingerprint(public.reviews)'::regprocedure)
       is distinct from 'cd3fd66480d98957eb4276f26c336678'
    or (select md5(prosrc) from pg_proc where oid='private.review_best_problem(public.reviews)'::regprocedure)
       is distinct from 'e11fd5d6ad4cbb0aa52898b29af041c7'
    or (select md5(prosrc) from pg_proc where oid='public.get_home_review_candidates(text[])'::regprocedure)
       is distinct from 'af86d13d11f872f6158c920335630ae1'
  then raise exception 'home_review_best_source_contract_changed'; end if;
end $contract$;

-- A bounded, deliberately public projection. It returns only the same review
-- fields already displayed on home cards, never selection state or private IDs.
-- No account advisory lock, actor authorization, PDP toggle/minimum or sampling:
-- this is public content reading, not a selection write or the PDP gallery.
create function public.get_home_best_review_candidates(p_good_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_good_ids is null or cardinality(p_good_ids) not between 1 and 200
    or array_ndims(p_good_ids) is distinct from 1
  then raise invalid_parameter_value using message='invalid_home_review_goods'; end if;
  if array_position(p_good_ids,null) is not null
    or exists(select 1 from unnest(p_good_ids) id where id !~ '^[A-Za-z0-9_-]{1,64}$')
  then raise invalid_parameter_value using message='invalid_home_review_goods'; end if;

  with eligible as materialized (
    select g.id from public.goods g
    join public.ips ip on ip.id=g.ip_id
    where g.id=any(p_good_ids) and g.archived_at is null and g.published_at is not null
      and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'goodId',g.id,
    'representative',jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,
      'authorName',coalesce(nullif(btrim(p.nickname),''),'팬'),'createdAt',r.created_at)
  ) order by g.id),'[]'::jsonb) into result
  from eligible g
  cross join lateral (
    select r.id,r.user_id,r.rating,r.body,r.created_at
    from private.review_best_selections selection
    join public.reviews r on r.id=selection.review_id
    where r.good_id=g.id and r.status='visible'
      and selection.selected and selection.invalidated_at is null
      and selection.review_fingerprint=md5(jsonb_build_object(
        'id',r.id,'body',r.body,'rating',r.rating,'images',r.image_paths,'status',r.status)::text)
      and exists(select 1 from public.profiles author where author.id=r.user_id and author.suspended_at is null)
      and not exists(select 1 from private.account_action_fences fence where fence.subject_user_id=r.user_id)
      -- Read-only equivalent of review_event_purchase_eligible in this statement
      -- snapshot. The dependency guard above prevents silently copying a changed
      -- purchase/fingerprint contract. Future changes must update both readers.
      and exists(
        select 1 from public.orders o
        where o.id=r.order_id and o.user_id=r.user_id and o.status in ('delivered','done') and o.delivered_at is not null
          and exists(select 1 from public.order_items item where item.order_id=o.id and item.good_id=r.good_id)
          and not exists(select 1 from public.order_cancellation_requests claim
            where claim.order_id=o.id and claim.claim_type in ('cancel','return')
              and (claim.status='completed' or claim.stage='completed'))
          and exists(
            select 1 from public.payments payment
            join public.payment_attempts attempt on attempt.payment_id=payment.id
              and attempt.purpose='order' and attempt.ref_id=o.id and attempt.user_id=o.user_id
              and attempt.provider=payment.provider and attempt.amount=payment.amount and attempt.state='approved'
            where payment.purpose='order' and payment.ref_id=o.id and payment.user_id=o.user_id
              and payment.amount=o.total and payment.status='paid'
              and (exists(select 1 from private.payment_provider_evidence evidence
                where evidence.payment_attempt_id=attempt.id and evidence.approved_at is not null)
                or attempt.provider='bank_transfer' and exists(select 1 from public.bank_transfer_confirmations confirmation
                  where confirmation.attempt_id=attempt.id and confirmation.order_id=o.id))
          )
      )
    order by r.rating desc,r.created_at desc,r.id
    limit 1
  ) r
  left join public.public_profiles p on p.id=r.user_id;
  return result;
end $$;
revoke all on function public.get_home_best_review_candidates(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_home_best_review_candidates(text[]) to anon,authenticated;
comment on function public.get_home_best_review_candidates(text[]) is
  'At most one currently eligible selected BEST review per requested public good (1..200 IDs). Rating/date/ID order; no private selection metadata, account locks, PDP toggle, three-review minimum, random selection, reward, or product-rank change.';

create or replace function public.get_home_review_candidates(p_good_ids text[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_good_ids is null or cardinality(p_good_ids) not between 1 and 200
    or array_position(p_good_ids,null) is not null
    or exists(select 1 from unnest(p_good_ids) id where id !~ '^[A-Za-z0-9_-]{1,64}$')
  then raise invalid_parameter_value using message='invalid_home_review_goods'; end if;
  with bounds as (
    select date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as today
  ), eligible as (
    select g.id from public.goods g where g.id=any(p_good_ids)
      and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
      and exists(select 1 from public.ips ip where ip.id=g.ip_id and ip.archived_at is null and ip.published_at is not null)
  ), statistics as (
    select r.good_id,round(avg(r.rating)::numeric,2) rating_average,count(*) review_count,
      max(r.created_at) filter(where r.created_at>=bounds.today-interval '7 days' and r.created_at<bounds.today) as recent_review_at
    from public.reviews r join eligible g on g.id=r.good_id cross join bounds
    where r.status='visible' group by r.good_id
  ), best as materialized (
    select chosen.* from jsonb_to_recordset(public.get_home_best_review_candidates(p_good_ids))
      as chosen("goodId" text,representative jsonb)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'goodId',s.good_id,'ratingAverage',s.rating_average,'reviewCount',s.review_count,'recentReviewAt',s.recent_review_at,
    'representative',coalesce(best.representative,jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,
      'authorName',coalesce(nullif(btrim(p.nickname),''),'팬'),'createdAt',r.created_at))
  ) order by s.good_id),'[]'::jsonb) into result
  from statistics s
  cross join lateral (
    select id,user_id,rating,body,created_at from public.reviews r
    where r.good_id=s.good_id and r.status='visible'
    order by r.rating desc,r.created_at desc,r.id limit 1
  ) r
  left join public.public_profiles p on p.id=r.user_id
  left join best on best."goodId"=s.good_id;
  return result;
end $$;

-- Existing aggregate owner/ACL/RLS mode are preserved by CREATE OR REPLACE.
select private.register_operator_internal_contract('public.get_home_best_review_candidates(text[])'::regprocedure);
notify pgrst,'reload schema';
