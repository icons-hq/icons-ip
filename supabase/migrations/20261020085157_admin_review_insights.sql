-- Review diagnostics use this store's data, never an invented external benchmark.
create index orders_review_cohort_idx on public.orders(delivered_at,id)
  where status in ('delivered','done') and delivered_at is not null;

create function public.admin_review_insights(p_focus text default 'all',p_query text default '',p_sort text default 'analysis',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; day_start timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_focus is null or p_focus not in ('all','photo','coverage','rating','unanswered')
    or p_query is null or char_length(p_query)>100 or p_sort is null or p_sort not in ('analysis','reviews','rating')
    or p_page is null or p_page<1 or p_page>100000 or p_page_size is null or p_page_size not in (20,50,100)
  then raise invalid_parameter_value using message='invalid_review_insights_filter'; end if;
  with products as materialized (
    select g.id,g.name,g.price,g.image_path from public.goods g join public.ips i on i.id=g.ip_id
    where g.archived_at is null and g.published_at is not null and i.archived_at is null and i.published_at is not null
  ), visible_reviews as materialized (
    select r.* from public.reviews r join products p on p.id=r.good_id
    where r.status='visible' and r.created_at<day_start
  ), reviews_by_product as (
    select good_id,count(*) review_count,count(*) filter(where cardinality(image_paths)>0) photo_count,
      count(*) filter(where nullif(btrim(admin_reply),'') is null) unanswered_count,
      avg(rating) average_rating,
      avg(rating) filter(where created_at>=((day_start at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul') six_month_rating
    from visible_reviews group by good_id
  ), delivered_cohort as materialized (
    -- One review can be written per order × product, even with multiple options/text entries.
    select distinct oi.order_id,oi.good_id from public.orders o join public.order_items oi on oi.order_id=o.id join products p on p.id=oi.good_id
    where o.status in ('delivered','done') and o.delivered_at>=day_start-interval '90 days' and o.delivered_at<day_start
  ), coverage_by_product as (
    select c.good_id,count(*) delivered_count,count(*) filter(where exists(
      select 1 from public.reviews r where r.order_id=c.order_id and r.good_id=c.good_id and r.created_at<day_start
    )) reviewed_count from delivered_cohort c group by c.good_id
  ), metrics as materialized (
    select p.*,coalesce(r.review_count,0) review_count,coalesce(r.photo_count,0) photo_count,
      coalesce(r.unanswered_count,0) unanswered_count,r.average_rating,r.six_month_rating,
      coalesce(c.delivered_count,0) delivered_count,coalesce(c.reviewed_count,0) reviewed_count,
      100.0*r.photo_count/nullif(r.review_count,0) photo_rate,
      100.0*c.reviewed_count/nullif(c.delivered_count,0) coverage_rate
    from products p left join reviews_by_product r on r.good_id=p.id left join coverage_by_product c on c.good_id=p.id
  ), benchmark as (
    select 100.0*sum(photo_count)/nullif(sum(review_count),0) photo_rate,
      100.0*sum(reviewed_count)/nullif(sum(delivered_count),0) coverage_rate,
      avg(average_rating) average_rating,avg(six_month_rating) six_month_rating from metrics
  ), tagged as materialized (
    select m.*,coalesce(m.photo_rate<b.photo_rate,false) low_photo,
      coalesce(m.coverage_rate<b.coverage_rate,false) low_coverage,
      coalesce(m.average_rating<4.6,false) low_rating
    from metrics m cross join benchmark b
    where p_query='' or strpos(lower(m.name),lower(btrim(p_query)))>0 or strpos(lower(m.id),lower(btrim(p_query)))>0
  ), filtered as materialized (
    select * from tagged where case p_focus when 'photo' then low_photo when 'coverage' then low_coverage
      when 'rating' then low_rating when 'unanswered' then unanswered_count>0 else true end
  ), page_rows as (
    select * from filtered order by
      case when p_sort='reviews' then review_count end desc,
      case when p_sort='rating' or p_sort='analysis' and p_focus='rating' then average_rating end asc nulls last,
      case when p_sort='analysis' and p_focus='photo' then photo_rate end asc nulls last,
      case when p_sort='analysis' and p_focus='coverage' then coverage_rate end asc nulls last,
      case when p_sort='analysis' then unanswered_count end desc,review_count desc,id
    limit p_page_size offset (p_page-1)*p_page_size
  ), recent as (
    select count(*) total,count(*) filter(where rating<=3) low_count from public.reviews r join products p on p.id=r.good_id
    where r.status='visible' and r.created_at>=day_start-interval '1 day' and r.created_at<=statement_timestamp()
  )
  select jsonb_build_object(
    'asOf',(day_start at time zone 'Asia/Seoul')::date-1,
    'cohortFrom',((day_start-interval '90 days') at time zone 'Asia/Seoul')::date,
    'summary',(select jsonb_build_object('newReviews',recent.total,'newLowReviews',recent.low_count,
      'averageRating',round(b.average_rating,2),'sixMonthRating',round(b.six_month_rating,2),
      'photoRate',round(b.photo_rate,1),'coverageRate',round(b.coverage_rate,1)) from benchmark b cross join recent),
    'counts',(select jsonb_build_object('all',count(*),'photo',count(*) filter(where low_photo),
      'coverage',count(*) filter(where low_coverage),'rating',count(*) filter(where low_rating),'unanswered',count(*) filter(where unanswered_count>0)) from tagged),
    'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price,'imagePath',image_path,
      'reviewCount',review_count,'photoCount',photo_count,'unansweredCount',unanswered_count,
      'averageRating',round(average_rating,2),'photoRate',round(photo_rate,1),'coverageRate',round(coverage_rate,1),
      'deliveredCount',delivered_count,'reviewedCount',reviewed_count)) from page_rows),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_review_insights(text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_review_insights(text,text,text,integer,integer) to authenticated;
