-- #420. Human goods/option codes are separate from the public URL identifier.
alter table public.goods add column code text;
alter table public.goods_variants add column code text;
update public.goods set code=upper(id);
with numbered as (
  select variant.id,good.code,row_number() over (
    partition by good.id order by variant.is_default desc,variant.sort_order,variant.id
  ) as ordinal
  from public.goods_variants variant join public.goods good on good.id=variant.good_id
)
update public.goods_variants variant set code=numbered.code||'-'||lpad(numbered.ordinal::text,2,'0')
from numbered where numbered.id=variant.id;
-- Backfill UPDATE queues the deferred default-option trigger on populated databases.
-- Flush it before ALTER TABLE in this same migration transaction.
set constraints public.goods_variants_require_default immediate;
alter table public.goods alter column code set not null;
alter table public.goods add constraint goods_code_key unique(code);
alter table public.goods add constraint goods_code_format check(code=upper(btrim(code)) and char_length(code) between 1 and 100);
alter table public.goods_variants alter column code set not null;
alter table public.goods_variants add constraint goods_variants_code_key unique(code);
alter table public.goods_variants add constraint goods_variants_code_format check(code=upper(btrim(code)) and char_length(code) between 1 and 120);

create table private.goods_code_counters(prefix text primary key,last_number bigint not null check(last_number>0));
revoke all on private.goods_code_counters from public, anon, authenticated, service_role;

create function private.goods_code_prefix(target_ip_id text)
returns text language sql immutable security invoker set search_path='' as $$
  select upper(case when count(*)>1 then left(string_agg(left(part,1),'' order by ordinal),12)
    else left(target_ip_id,3) end)
  from regexp_split_to_table(target_ip_id,'-') with ordinality words(part,ordinal);
$$;
revoke all on function private.goods_code_prefix(text) from public, anon, authenticated, service_role;

create function private.allocate_goods_code(target_ip_id text)
returns text language plpgsql security invoker set search_path='' as $$
declare prefix_value text:=private.goods_code_prefix(target_ip_id); ordinal bigint; candidate text;
begin
  loop
    insert into private.goods_code_counters(prefix,last_number) values(prefix_value,1)
    on conflict(prefix) do update set last_number=private.goods_code_counters.last_number+1
    returning last_number into ordinal;
    candidate:=prefix_value||'-'||lpad(ordinal::text,greatest(4,length(ordinal::text)),'0');
    if not exists(select 1 from public.goods where code=candidate)
      and not exists(select 1 from public.goods_variants where code=candidate||'-01') then return candidate; end if;
  end loop;
end;
$$;
revoke all on function private.allocate_goods_code(text) from public, anon, authenticated, service_role;

create function private.set_goods_code()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.code:=nullif(upper(btrim(new.code)),'');
  if new.code is null then
    if tg_op='INSERT' then select code into new.code from public.goods where id=new.id; end if;
    new.code:=coalesce(new.code,private.allocate_goods_code(new.ip_id));
  end if;
  return new;
end;
$$;
revoke all on function private.set_goods_code() from public, anon, authenticated, service_role;
create trigger goods_set_code before insert or update of code on public.goods
for each row execute function private.set_goods_code();

create function private.set_goods_variant_code()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_code text; ordinal bigint:=1; candidate text;
begin
  new.code:=nullif(upper(btrim(new.code)),'');
  if new.code is not null then return new; end if;
  select code into parent_code from public.goods where id=new.good_id for update;
  loop
    candidate:=parent_code||'-'||lpad(ordinal::text,greatest(2,length(ordinal::text)),'0');
    if not exists(select 1 from public.goods_variants where code=candidate) then new.code:=candidate; return new; end if;
    ordinal:=ordinal+1;
  end loop;
end;
$$;
revoke all on function private.set_goods_variant_code() from public, anon, authenticated, service_role;
create trigger goods_variants_set_code before insert or update of code on public.goods_variants
for each row execute function private.set_goods_variant_code();

create function private.sync_default_goods_variant_code()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- A logistics override on the option survives a subsequent goods-code change.
  update public.goods_variants set code=new.code||'-01'
    where good_id=new.id and is_default and code=old.code||'-01';
  return null;
end;
$$;
revoke all on function private.sync_default_goods_variant_code() from public, anon, authenticated, service_role;
create trigger goods_sync_default_variant_code after update of code on public.goods
for each row when(old.code is distinct from new.code) execute function private.sync_default_goods_variant_code();

-- Name-based URLs keep the existing ASCII identifier contract across catalog
-- consumers. Hangul syllables use a deterministic romanization, without a new
-- external transliteration service or an operator-authored g100 identifier.
create function private.goods_slug_from_name(target_name text)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare
  initials text[]:=array['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
  vowels text[]:=array['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
  finals text[]:=array['','k','kk','ks','n','nj','nh','t','l','lk','lm','lb','ls','lt','lp','lh','m','p','ps','t','t','ng','t','t','k','t','p','h'];
  character text; syllable integer; result text:=''; position integer;
begin
  for position in 1..char_length(coalesce(target_name,'')) loop
    character:=substr(target_name,position,1);
    syllable:=ascii(character)-44032;
    if syllable between 0 and 11171 then
      result:=result||initials[syllable/588+1]||vowels[(syllable%588)/28+1]||finals[syllable%28+1];
    else result:=result||character; end if;
  end loop;
  result:=btrim(regexp_replace(lower(normalize(result,NFKD)),'[^a-z0-9]+','-','g'),'-');
  return coalesce(nullif(btrim(left(result,56),'-'),''),'good');
end;
$$;
revoke all on function private.goods_slug_from_name(text) from public, anon, authenticated, service_role;

create function private.available_goods_slug(target_name text,excluded_id text default null)
returns text language plpgsql stable security invoker set search_path='' as $$
declare base text:=private.goods_slug_from_name(target_name); candidate text:=base; suffix integer:=1;
begin
  while exists(select 1 from public.goods where id=candidate and id is distinct from excluded_id) loop
    suffix:=suffix+1;
    candidate:=base||'-'||suffix::text;
  end loop;
  return candidate;
end;
$$;
revoke all on function private.available_goods_slug(text,text) from public, anon, authenticated, service_role;

create function public.admin_suggest_goods_identifiers(target_ip_id text,target_name text)
returns table(code text,slug text,default_variant_code text)
language plpgsql stable security definer set search_path='' as $$
declare prefix_value text; ordinal bigint; candidate text;
begin
  if (select auth.uid()) is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if not exists(select 1 from public.ips where id=target_ip_id and archived_at is null) then
    raise no_data_found using message='ip_not_found';
  end if;
  prefix_value:=private.goods_code_prefix(target_ip_id);
  select coalesce((select last_number from private.goods_code_counters where prefix=prefix_value),0)+1 into ordinal;
  loop
    candidate:=prefix_value||'-'||lpad(ordinal::text,greatest(4,length(ordinal::text)),'0');
    exit when not exists(select 1 from public.goods good where good.code=candidate)
      and not exists(select 1 from public.goods_variants variant where variant.code=candidate||'-01');
    ordinal:=ordinal+1;
  end loop;
  code:=candidate;
  slug:=private.available_goods_slug(target_name);
  default_variant_code:=code||'-01';
  return next;
end;
$$;
revoke all on function public.admin_suggest_goods_identifiers(text,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_suggest_goods_identifiers(text,text) to authenticated;

-- Track the first public URL independently of the current visibility switch.
alter table public.goods add column first_published_at timestamptz;
update public.goods good set first_published_at=coalesce(ip.published_at,good.created_at)
from public.ips ip where ip.id=good.ip_id and (
 ip.published_at is not null or good.archived_at is not null
 or exists(select 1 from public.order_items item where item.good_id=good.id)
 or exists(select 1 from public.audit_log audit where audit.target='ips:'||ip.id and audit.action='admin.ip.published')
);

create function private.guard_goods_public_slug()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_published_at timestamptz;
begin
  if tg_op='UPDATE' then
    if old.first_published_at is not null and new.id is distinct from old.id then
      raise check_violation using message='goods_slug_locked';
    end if;
    if old.first_published_at is not null then new.first_published_at:=old.first_published_at; end if;
  end if;
  select published_at into parent_published_at from public.ips where id=new.ip_id and archived_at is null for share;
  if new.first_published_at is null and parent_published_at is not null
    and new.archived_at is null and new.sale_restriction='none' then
    new.first_published_at:=clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_goods_public_slug() from public, anon, authenticated, service_role;
create trigger goods_public_slug_guard before insert or update of id,ip_id,archived_at,sale_restriction,first_published_at
on public.goods for each row execute function private.guard_goods_public_slug();

create function private.lock_published_ip_goods_slugs()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.published_at is not null and new.archived_at is null then
    update public.goods set first_published_at=clock_timestamp()
    where ip_id=new.id and first_published_at is null and archived_at is null and sale_restriction='none';
  end if;
  return null;
end;
$$;
revoke all on function private.lock_published_ip_goods_slugs() from public, anon, authenticated, service_role;
create trigger ips_lock_goods_slugs after update of published_at,archived_at on public.ips
for each row execute function private.lock_published_ip_goods_slugs();

-- Draft URL changes carry their relational references. Historical item snapshots
-- and audit targets are never rewritten; published goods are fenced above.
alter table public.cart_items drop constraint cart_items_good_id_fkey, add constraint cart_items_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete cascade;
alter table public.order_items drop constraint order_items_good_id_fkey, add constraint order_items_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade;
alter table public.inquiries drop constraint inquiries_good_id_fkey, add constraint inquiries_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete set null;
alter table public.reviews drop constraint reviews_good_id_fkey, add constraint reviews_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete cascade;
alter table public.wishlists drop constraint wishlists_good_id_fkey, add constraint wishlists_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete cascade;
alter table public.restock_alerts drop constraint restock_alerts_good_id_fkey, add constraint restock_alerts_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete cascade;
alter table public.product_questions drop constraint product_questions_good_id_fkey, add constraint product_questions_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete cascade;
alter table public.goods_variants drop constraint goods_variants_good_id_fkey, add constraint goods_variants_good_id_fkey foreign key(good_id) references public.goods(id) on update cascade on delete cascade;
alter table public.reward_policies alter constraint reward_policies_target_good_ip_fkey deferrable initially deferred;

create or replace function private.guard_goods_variant_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.id is distinct from old.id or (
    new.good_id is distinct from old.good_id and exists(select 1 from public.goods where id=old.good_id)
  ) then raise check_violation using message='goods_variant_identity_immutable'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.guard_goods_variant_identity() from public, anon, authenticated, service_role;

-- The existing editor RPC continues to own content validation and its audit.
-- This atomic interface owns URL/code changes around that proven write path.
create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid:=(select auth.uid());
  previous_id text:=nullif(btrim(target_good->>'previous_id'),'');
  target_id text:=nullif(btrim(target_good->>'id'),'');
  target_ip text:=target_good->>'ip_id';
  previous_ip text;
  previous_code text;
  requested_code text:=nullif(upper(btrim(target_good->>'code')),'');
  requested_variant_code text:=nullif(upper(btrim(target_good->>'default_variant_code')),'');
  saved_code text; saved_variant_code text;
begin
  if actor_id is null then raise invalid_authorization_specification using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if jsonb_typeof(target_good) is distinct from 'object' then raise invalid_parameter_value using message='invalid_good'; end if;
  if previous_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('admin_good:'||previous_id,0));
    select ip_id,code into previous_ip,previous_code from public.goods where id=previous_id;
    if not found then raise no_data_found using message='catalog_record_missing'; end if;
  end if;
  -- Match the purchase/publication lock order before the editor locks goods.
  perform 1 from public.ips where id in(target_ip,previous_ip) order by id for update;
  if target_id is null then
    perform pg_advisory_xact_lock(hashtextextended('goods_slug:'||private.goods_slug_from_name(target_good->>'name'),0));
    target_id:=private.available_goods_slug(target_good->>'name',previous_id);
  end if;
  if target_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then raise invalid_parameter_value using message='invalid_goods_slug'; end if;
  if previous_id is not null and previous_id is distinct from target_id then
    update public.goods set id=target_id where id=previous_id;
    update public.reward_policies set target_good_id=target_id where target_good_id=previous_id;
    update public.home_curations set payload=jsonb_set(payload,'{good_ids}',(
      select jsonb_agg(case when item=to_jsonb(previous_id) then to_jsonb(target_id) else item end order by position)
      from jsonb_array_elements(payload->'good_ids') with ordinality items(item,position)
    )) where jsonb_typeof(payload->'good_ids')='array' and payload->'good_ids' ? previous_id;
    update public.campaigns campaign set sections=(
      select jsonb_agg(case when jsonb_typeof(section->'good_ids')='array' and section->'good_ids' ? previous_id
        then jsonb_set(section,'{good_ids}',(
          select jsonb_agg(case when item=to_jsonb(previous_id) then to_jsonb(target_id) else item end order by item_position)
          from jsonb_array_elements(section->'good_ids') with ordinality items(item,item_position)
        )) else section end order by section_position)
      from jsonb_array_elements(campaign.sections) with ordinality sections(section,section_position)
    ) where campaign.sections @> jsonb_build_array(jsonb_build_object('good_ids',jsonb_build_array(previous_id)));
  end if;

  perform public.admin_upsert_good(
    target_id,target_ip,target_good->>'name',target_good->>'type',(target_good->>'price')::integer,
    target_good->>'badge',target_good->>'stock',target_good->>'bg',target_good->>'image_path',
    target_good->>'notice_maker',target_good->>'notice_origin',target_good->>'notice_material',target_good->>'notice_size',
    target_good->>'notice_made_on',target_good->>'notice_as_manager',target_good->>'notice_as_contact',
    target_good->>'description',array(select jsonb_array_elements_text(coalesce(target_good->'gallery_paths','[]'::jsonb))),
    target_good->>'detail_image_path',case when previous_id is null then null else target_id end,
    nullif(target_good->>'compare_at_price','')::integer
  );
  if requested_code is not null then update public.goods set code=requested_code where id=target_id; end if;
  if requested_variant_code is not null then
    update public.goods_variants set code=requested_variant_code where good_id=target_id and is_default;
  end if;
  select code into saved_code from public.goods where id=target_id;
  select code into saved_variant_code from public.goods_variants where good_id=target_id and is_default;
  insert into public.audit_log(actor_id,action,target,diff) values(actor_id,'admin.good.identifiers_saved','goods:'||target_id,
    jsonb_build_object('previous_id',previous_id,'id',target_id,'previous_code',previous_code,'code',saved_code,'default_variant_code',saved_variant_code));
  return jsonb_build_object('id',target_id,'code',saved_code,'default_variant_code',saved_variant_code);
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

set constraints public.goods_variants_require_default deferred;
