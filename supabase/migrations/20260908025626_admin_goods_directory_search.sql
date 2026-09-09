-- Staff catalogue search returns a table relation so PostgREST filters/count/range
-- remain server-owned. An option code locates its parent good without duplicate rows.
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
      or g.code ilike pattern escape E'\\'
      or g.id ilike pattern escape E'\\'
      or exists (
        select 1 from public.goods_variants v
        where v.good_id = g.id and v.code ilike pattern escape E'\\'
      );
end;
$$;
revoke all on function public.admin_search_goods(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_goods(text) to authenticated;
