-- #470: optional English display name; KRW and domestic delivery stay unchanged.
alter table public.goods add column name_en text
  constraint goods_name_en_length check (name_en is null or char_length(name_en) between 1 and 200);

alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_english_name;
revoke all on function private.admin_save_good_before_english_name(jsonb) from public, anon, authenticated, service_role;

create function public.admin_save_good(target_good jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved jsonb;
  previous_name text;
  next_name text;
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
  saved := private.admin_save_good_before_english_name(target_good);
  if target_good ? 'name_en' then
    select name_en into previous_name from public.goods where id=saved->>'id' for update;
    if previous_name is distinct from next_name then
      update public.goods set name_en=next_name where id=saved->>'id';
      insert into public.audit_log(actor_id,action,target,diff)
      values(auth.uid(),'admin.good.english_name_saved','goods:'||(saved->>'id'),
        jsonb_build_object('before',previous_name,'after',next_name));
    end if;
  end if;
  return saved;
end;
$$;
revoke all on function public.admin_save_good(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;
