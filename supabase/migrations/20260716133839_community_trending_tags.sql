-- Aggregate recent visible community tags without bypassing post RLS.

drop function if exists public.community_trending_tags(integer, integer);

create or replace function public.community_trending_tags(
  window_days integer default 7,
  result_limit integer default 10
)
returns table (
  tag text,
  usage_count bigint,
  latest_post_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      greatest(1, least(coalesce(window_days, 7), 30)) as window_days,
      greatest(1, least(coalesce(result_limit, 10), 10)) as result_limit
  ),
  normalized_posts as (
    select
      btrim(regexp_replace(btrim(posts.tag), '^#+', '')) as normalized_tag,
      posts.created_at
    from public.posts
    cross join params
    where posts.status = 'visible'
      and posts.tag is not null
      and posts.created_at >= statement_timestamp() - make_interval(days => params.window_days)
      and posts.created_at <= statement_timestamp()
  ),
  aggregated as (
    select
      normalized_posts.normalized_tag,
      count(*)::bigint as usage_count,
      max(normalized_posts.created_at) as latest_post_at
    from normalized_posts
    where normalized_posts.normalized_tag <> ''
    group by normalized_posts.normalized_tag
  )
  select
    aggregated.normalized_tag as tag,
    aggregated.usage_count,
    aggregated.latest_post_at
  from aggregated
  order by
    aggregated.usage_count desc,
    aggregated.latest_post_at desc,
    aggregated.normalized_tag asc
  limit (select params.result_limit from params);
$$;

revoke all on function public.community_trending_tags(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.community_trending_tags(integer, integer)
  to anon, authenticated;
