do $$
begin
  if exists (
    select lower(btrim(nickname))
    from public.profiles
    where nickname is not null
    group by lower(btrim(nickname))
    having count(*) > 1
  ) then
    raise exception using message = 'profiles contain normalized nickname conflicts';
  end if;
end;
$$;

create unique index profiles_nickname_normalized_unique_idx
  on public.profiles (lower(btrim(nickname)))
  where nickname is not null;
