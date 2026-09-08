-- #431: customer FAQ, with public published-only reads and audited staff writes.
create table public.faq_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  category text not null check (category in ('order', 'claim', 'good', 'account', 'etc')),
  question text not null check (char_length(btrim(question)) between 1 and 200),
  answer text not null check (char_length(btrim(answer)) between 1 and 6000),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.faq_entries enable row level security;
revoke all on table public.faq_entries from public, anon, authenticated, service_role;
grant select on table public.faq_entries to anon, authenticated;
create policy faq_published_read on public.faq_entries for select to anon, authenticated
  using (is_published);
create policy faq_staff_read on public.faq_entries for select to authenticated
  using ((select public.is_staff()));
create index faq_published_order on public.faq_entries (category, sort_order, id) where is_published;

create function public.admin_save_faq_entry(
  target_id uuid, target_category text, target_question text, target_answer text,
  target_sort_order integer, target_published boolean, expected_updated_at timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  previous public.faq_entries;
  saved public.faq_entries;
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if target_category is null or target_category not in ('order','claim','good','account','etc')
    or char_length(btrim(coalesce(target_question,''))) not between 1 and 200
    or char_length(btrim(coalesce(target_answer,''))) not between 1 and 6000
    or target_sort_order is null or target_sort_order not between 0 and 9999
    or target_published is null then
    raise invalid_parameter_value using message = 'invalid_faq_entry';
  end if;
  if target_id is null then
    insert into public.faq_entries(category,question,answer,sort_order,is_published)
    values(target_category,btrim(target_question),btrim(target_answer),target_sort_order,target_published)
    returning * into saved;
  else
    select * into previous from public.faq_entries where id = target_id for update;
    if not found then raise no_data_found using message = 'faq_not_found'; end if;
    if expected_updated_at is distinct from previous.updated_at then
      raise serialization_failure using message = 'faq_conflict';
    end if;
    update public.faq_entries set category = target_category, question = btrim(target_question),
      answer = btrim(target_answer), sort_order = target_sort_order, is_published = target_published,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,case when target_id is null then 'faq.create' else 'faq.update' end,
      'faq:' || saved.id::text,jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.id;
end;
$$;
revoke all on function public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamptz) to authenticated;

create function public.admin_delete_faq_entry(target_id uuid, expected_updated_at timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); previous public.faq_entries;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message = 'staff_required'; end if;
  select * into previous from public.faq_entries where id = target_id for update;
  if not found then raise no_data_found using message = 'faq_not_found'; end if;
  if expected_updated_at is distinct from previous.updated_at then
    raise serialization_failure using message = 'faq_conflict';
  end if;
  delete from public.faq_entries where id = target_id;
  insert into public.audit_log(actor_id,action,target,diff)
  values(actor,'faq.delete','faq:' || target_id::text,jsonb_build_object('before',to_jsonb(previous),'after',null));
end;
$$;
revoke all on function public.admin_delete_faq_entry(uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_faq_entry(uuid,timestamptz) to authenticated;

-- Invoker preserves RLS; the explicit published filter also keeps staff browsing the public
-- page from seeing drafts. Terms match independently so a natural-language inquiry title can
-- suggest a shipping answer without requiring every word of the title to occur verbatim.
create function public.search_faq_entries(target_query text default '', target_category text default '',
  page_limit integer default 20, page_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with words as (
    select word from unnest(regexp_split_to_array(lower(left(btrim(coalesce(target_query,'')),200)), '[[:space:][:punct:]]+')) word
    where char_length(word) >= 2
  ), matches as (
    select entry.* from public.faq_entries entry
    where entry.is_published
      and (coalesce(target_category,'') = '' or entry.category = target_category)
      and (btrim(coalesce(target_query,'')) = '' or exists (
        select 1 from words where strpos(lower(entry.question || ' ' || entry.answer),word) > 0
      ))
  ), selected as (
    select * from matches order by sort_order, id
    limit greatest(1,least(coalesce(page_limit,20),50)) offset greatest(0,least(coalesce(page_offset,0),200000))
  )
  select jsonb_build_object('total',(select count(*) from matches),'entries',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'category',category,'question',question,'answer',answer,
      'sortOrder',sort_order,'published',is_published,'updatedAt',updated_at) order by sort_order,id) from selected
  ),'[]'::jsonb));
$$;
revoke all on function public.search_faq_entries(text,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.search_faq_entries(text,text,integer,integer) to anon, authenticated;
