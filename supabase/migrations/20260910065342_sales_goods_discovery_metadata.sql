-- #480/#481: operator-managed discovery metadata for public and admin goods flows.
-- P12 implementation choice: one trimmed, case-insensitive de-duplicated keyword list
-- feeds public integrated search and the existing admin goods search. One nullable
-- product-level display order feeds recommended shop/IP lists; null and ties fall back
-- to deterministic product-id order. BEST curation and explicit customer sorts remain
-- higher-priority ordering decisions in their existing callers.

alter table public.goods
  add column search_keywords text[] not null default '{}'::text[],
  add column display_order integer;

create function private.good_search_keywords_valid(target_keywords text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select target_keywords is not null
    and cardinality(target_keywords) <= 50
    and not exists (
      select 1
      from unnest(target_keywords) as item(keyword)
      where btrim(keyword) = ''
        or btrim(keyword) is distinct from keyword
        or char_length(keyword) > 80
    )
    and (
      select count(*) = count(distinct lower(keyword))
      from unnest(target_keywords) as item(keyword)
    );
$$;
revoke all on function private.good_search_keywords_valid(text[]) from public, anon, authenticated, service_role;
-- The public save seam is a SECURITY DEFINER function owned by postgres in the
-- hosted schema. Keep this helper private while allowing that definer to invoke
-- it even when migrations are applied by supabase_admin.
grant execute on function private.good_search_keywords_valid(text[]) to postgres;

alter table public.goods
  add constraint goods_search_keywords_valid
  check (private.good_search_keywords_valid(search_keywords));
alter table public.goods
  add constraint goods_display_order_valid
  check (display_order is null or display_order >= 0);

-- Keep the relation-returning RPC used by the paginated admin goods list and Excel
-- candidate export. Search remains staff-only and wildcard-safe.
create or replace function public.admin_search_goods(search_text text default null)
returns setof public.goods
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  needle text := btrim(coalesce(search_text, ''));
  pattern text;
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message = 'admin_only';
  end if;
  if length(needle) > 100 then
    raise invalid_parameter_value using message = 'goods_search_too_long';
  end if;
  pattern := '%' || replace(replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  return query
    select g.* from public.goods g
    where needle = '' or g.name ilike pattern escape E'\\'
      or coalesce(g.name_en, '') ilike pattern escape E'\\'
      or g.code ilike pattern escape E'\\'
      or g.id ilike pattern escape E'\\'
      or exists (
        select 1 from unnest(g.search_keywords) as item(keyword)
        where keyword ilike pattern escape E'\\'
      )
      or exists (
        select 1 from public.goods_variants v
        where v.good_id = g.id and v.code ilike pattern escape E'\\'
      );
end;
$$;
revoke all on function public.admin_search_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods(text) to authenticated;

-- #470 already owns the public save seam and delegates the established write/audit
-- contract to private.admin_save_good_before_english_name. Extend that wrapper in
-- place so existing import callers and the English-name seam continue to compose.
create or replace function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved jsonb;
  previous_name text;
  next_name text;
  previous_search_keywords text[];
  next_search_keywords text[];
  previous_display_order integer;
  next_display_order integer;
  metadata_diff jsonb := '{}'::jsonb;
  has_search_keywords boolean := target_good ? 'search_keywords';
  has_display_order boolean := target_good ? 'display_order';
begin
  if auth.uid() is null or not public.is_staff() then
    raise insufficient_privilege using message='staff_required';
  end if;

  if target_good ? 'name_en' then
    if jsonb_typeof(target_good->'name_en') not in ('string','null') then
      raise check_violation using message='invalid_good_english_name';
    end if;
    next_name := nullif(btrim(target_good->>'name_en'), '');
    if char_length(next_name) > 200 then
      raise check_violation using message='invalid_good_english_name';
    end if;
  end if;

  if has_search_keywords then
    if target_good->'search_keywords' is null
      or jsonb_typeof(target_good->'search_keywords') = 'null' then
      next_search_keywords := '{}'::text[];
    elsif jsonb_typeof(target_good->'search_keywords') <> 'array'
      or jsonb_array_length(target_good->'search_keywords') > 50
      or exists (
        select 1 from jsonb_array_elements(target_good->'search_keywords') as item(value)
        where jsonb_typeof(item.value) <> 'string'
      )
      or exists (
        select 1 from jsonb_array_elements_text(target_good->'search_keywords') as item(value)
        where char_length(btrim(item.value)) > 80
      ) then
      raise check_violation using message='invalid_good_search_keywords';
    else
      select coalesce(array_agg(keyword order by ordinal), '{}'::text[])
        into next_search_keywords
      from (
        select distinct on (lower(btrim(item.value)))
          btrim(item.value) as keyword,
          item.ordinal
        from jsonb_array_elements_text(target_good->'search_keywords')
          with ordinality as item(value, ordinal)
        where btrim(item.value) <> ''
        order by lower(btrim(item.value)), item.ordinal
      ) as deduplicated;
      if not private.good_search_keywords_valid(next_search_keywords) then
        raise check_violation using message='invalid_good_search_keywords';
      end if;
    end if;
  end if;

  if has_display_order then
    if target_good->'display_order' is null
      or jsonb_typeof(target_good->'display_order') = 'null' then
      next_display_order := null;
    elsif jsonb_typeof(target_good->'display_order') <> 'number'
      or target_good->>'display_order' !~ '^[0-9]+$'
      or (target_good->>'display_order')::numeric > 2147483647 then
      raise check_violation using message='invalid_good_display_order';
    else
      next_display_order := (target_good->>'display_order')::integer;
    end if;
  end if;

  saved := private.admin_save_good_before_english_name(target_good);

  if target_good ? 'name_en' then
    select name_en into previous_name
    from public.goods
    where id=saved->>'id'
    for update;
    if previous_name is distinct from next_name then
      update public.goods set name_en=next_name where id=saved->>'id';
      insert into public.audit_log(actor_id,action,target,diff)
      values(auth.uid(),'admin.good.english_name_saved','goods:'||(saved->>'id'),
        jsonb_build_object('before',previous_name,'after',next_name));
    end if;
  end if;

  if has_search_keywords or has_display_order then
    select search_keywords, display_order
      into previous_search_keywords, previous_display_order
    from public.goods
    where id=saved->>'id'
    for update;

    if has_search_keywords and previous_search_keywords is distinct from next_search_keywords then
      update public.goods
      set search_keywords=next_search_keywords
      where id=saved->>'id';
      metadata_diff := metadata_diff || jsonb_build_object(
        'search_keywords_before', previous_search_keywords,
        'search_keywords_after', next_search_keywords
      );
    end if;
    if has_display_order and previous_display_order is distinct from next_display_order then
      update public.goods
      set display_order=next_display_order
      where id=saved->>'id';
      metadata_diff := metadata_diff || jsonb_build_object(
        'display_order_before', previous_display_order,
        'display_order_after', next_display_order
      );
    end if;
    if metadata_diff <> '{}'::jsonb then
      insert into public.audit_log(actor_id,action,target,diff)
      values(auth.uid(),'admin.good.discovery_metadata_saved','goods:'||(saved->>'id'),metadata_diff);
    end if;
  end if;

  return saved;
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

-- #480: preserve the public search contract while matching English names and operator keywords. The later IP migration
-- had replaced search_public_content from the older catalog-archiving version,
-- dropping the adult-goods predicate. Both visibility conditions are required.
-- Community post visibility, blocking, wildcard escaping, ranking and limits
-- are byte-for-byte the same as main's 20260901120000 function.
create or replace function public.search_public_content(
  search_query text,
  per_group_limit integer default 6
)
returns table (
  kind text,
  id text,
  label text,
  subtitle text,
  ip_id text,
  ip_title text,
  image_path text,
  bg text,
  accent text,
  score real
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with raw_params as (
    select
      nullif(left(btrim(search_query), 80), '') as q,
      greatest(1, least(coalesce(per_group_limit, 6), 20)) as result_limit,
      auth.uid() as actor_id
  ),
  params as (
    select
      raw_params.q,
      case
        when raw_params.q is null then null
        else '%' || replace(replace(replace(raw_params.q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
      end as q_like,
      raw_params.result_limit,
      raw_params.actor_id
    from raw_params
  ),
  visible_posts as (
    select
      posts.id,
      posts.user_id,
      posts.ip_id,
      posts.text,
      posts.tag,
      posts.image_path,
      ips.title as ip_title,
      verticals.color as accent
    from public.posts
    left join public.ips on ips.id = posts.ip_id
    left join public.verticals on verticals.key = ips.vertical_key
    cross join params
    where params.q is not null
      and posts.status = 'visible'
      and not exists (
        select 1
        from public.blocks
        where blocks.user_id = params.actor_id
          and blocks.blocked_user_id = posts.user_id
      )
  ),
  all_matches as (
    select
      'ip'::text as kind,
      ips.id::text as id,
      ips.title as label,
      concat_ws(' · ', verticals.label, ips.sub) as subtitle,
      ips.id::text as ip_id,
      ips.title as ip_title,
      ips.image_path,
      ips.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(ips.title, params.q),
        case when ips.title ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(ips.sub, '') ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(ips.tagline, '') ilike params.q_like escape E'\\' then 0.6 else 0 end,
        case when coalesce(ips.synopsis, '') ilike params.q_like escape E'\\' then 0.4 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.ips on params.q is not null
    join public.verticals on verticals.key = ips.vertical_key
    where ips.archived_at is null
      and ips.published_at is not null
      and (
        ips.title ilike params.q_like escape E'\\'
        or coalesce(ips.sub, '') ilike params.q_like escape E'\\'
        or coalesce(ips.tagline, '') ilike params.q_like escape E'\\'
        or coalesce(ips.synopsis, '') ilike params.q_like escape E'\\'
        or extensions.similarity(ips.title, params.q) > 0.15
      )

    union all

    select
      'good'::text as kind,
      goods.id::text as id,
      goods.name as label,
      concat_ws(' · ', ips.title, goods.type) as subtitle,
      goods.ip_id::text,
      ips.title as ip_title,
      goods.image_path,
      goods.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(goods.name, params.q),
        case when goods.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when goods.type ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(goods.badge, '') ilike params.q_like escape E'\\' then 0.4 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end,
        case when coalesce(goods.name_en, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        coalesce((
          select max(greatest(
            case when keyword ilike params.q_like escape E'\\' then 1 else 0 end,
            extensions.similarity(keyword, params.q)
          ))
          from unnest(goods.search_keywords) as keyword
        ), 0)
      )::real as score,
      params.result_limit
    from params
    join public.goods on params.q is not null
    join public.ips on ips.id = goods.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where goods.archived_at is null
      and goods.published_at is not null
      and ips.archived_at is null
      and ips.published_at is not null
      and goods.sale_restriction = 'none'
      and (
        goods.name ilike params.q_like escape E'\\'
        or goods.type ilike params.q_like escape E'\\'
        or coalesce(goods.badge, '') ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or coalesce(goods.name_en, '') ilike params.q_like escape E'\\'
        or extensions.similarity(goods.name, params.q) > 0.15
        or exists (
          select 1
          from unnest(goods.search_keywords) as keyword
          where keyword ilike params.q_like escape E'\\'
            or extensions.similarity(keyword, params.q) > 0.15
        )
      )

    union all

    select
      'card'::text as kind,
      cards.id::text as id,
      cards.name as label,
      concat_ws(' · ', ips.title, cards.rarity::text, cards.no) as subtitle,
      cards.ip_id::text,
      ips.title as ip_title,
      cards.image_path,
      cards.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(cards.name, params.q),
        case when cards.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(cards.no, '') ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when cards.rarity::text ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.cards on params.q is not null
    join public.ips on ips.id = cards.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where cards.archived_at is null
      and ips.archived_at is null
      and ips.published_at is not null
      and (
        cards.name ilike params.q_like escape E'\\'
        or coalesce(cards.no, '') ilike params.q_like escape E'\\'
        or cards.rarity::text ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(cards.name, params.q) > 0.15
      )

    union all

    select
      'post'::text as kind,
      visible_posts.id::text as id,
      visible_posts.text as label,
      concat_ws(' · ', visible_posts.ip_title, case when visible_posts.tag is null then null else '#' || visible_posts.tag end) as subtitle,
      visible_posts.ip_id::text,
      visible_posts.ip_title,
      null::text as image_path,
      null::text as bg,
      visible_posts.accent,
      greatest(
        extensions.similarity(visible_posts.text, params.q),
        case when visible_posts.text ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        case when coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join visible_posts on true
    where visible_posts.text ilike params.q_like escape E'\\'
      or coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\'
      or coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.text, params.q) > 0.15

    union all

    select
      'tag'::text as kind,
      visible_posts.tag as id,
      '#' || visible_posts.tag as label,
      '커뮤니티 태그'::text as subtitle,
      null::text as ip_id,
      null::text as ip_title,
      null::text as image_path,
      null::text as bg,
      max(visible_posts.accent) as accent,
      max(greatest(
        extensions.similarity(visible_posts.tag, params.q),
        case when visible_posts.tag ilike params.q_like escape E'\\' then 1 else 0 end
      ))::real as score,
      params.result_limit
    from params
    join visible_posts on visible_posts.tag is not null
    where visible_posts.tag ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.tag, params.q) > 0.15
    group by visible_posts.tag, params.result_limit
  ),
  ranked as (
    select
      all_matches.*,
      row_number() over (
        partition by all_matches.kind
        order by all_matches.score desc, all_matches.label asc, all_matches.id asc
      ) as group_rank
    from all_matches
  )
  select
    ranked.kind,
    ranked.id,
    ranked.label,
    ranked.subtitle,
    ranked.ip_id,
    ranked.ip_title,
    ranked.image_path,
    ranked.bg,
    ranked.accent,
    ranked.score
  from ranked
  where ranked.group_rank <= ranked.result_limit
  order by
    case ranked.kind
      when 'ip' then 1
      when 'good' then 2
      when 'card' then 3
      when 'post' then 4
      when 'tag' then 5
      else 6
    end,
    ranked.score desc,
    ranked.label asc,
    ranked.id asc;
$$;

revoke all on function public.search_public_content(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_content(text, integer)
  to anon, authenticated;
