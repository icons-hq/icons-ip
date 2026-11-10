-- Match the source's latest-40 manual drafts, keeping displaced entries recoverable.
create function private.make_room_for_goods_draft(p_owner_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare previous public.admin_goods_drafts;
begin
  if p_owner_id is distinct from auth.uid() or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  -- The public callers already hold the per-owner advisory lock.
  if (select count(*) from public.admin_goods_drafts where owner_id=p_owner_id and archived_at is null)<40 then return; end if;
  select * into previous from public.admin_goods_drafts where owner_id=p_owner_id and archived_at is null
    order by updated_at,id limit 1 for update;
  if not found then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  update public.admin_goods_drafts set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=previous.id;
  insert into public.audit_log(actor_id,action,target,diff) values(p_owner_id,'admin.goods.draft.archived','goods_draft:'||previous.id::text,
    jsonb_build_object('revision',previous.revision+1,'archived',true,'reason','recent_40_limit'));
end $$;
revoke all on function private.make_room_for_goods_draft(uuid) from public,anon,authenticated,service_role;

do $$
declare original text; needle text;
begin
  select pg_get_functiondef('public.admin_save_goods_draft(uuid,jsonb,integer)'::regprocedure) into original;
  needle:=$body$if (select count(*) from public.admin_goods_drafts where owner_id=actor and archived_at is null)>=40 then
      raise check_violation using message='goods_draft_limit';
    end if;$body$;
  if strpos(original,needle)=0 then raise exception 'goods draft save capacity gate not found'; end if;
  execute replace(original,needle,'perform private.make_room_for_goods_draft(actor);');
  select pg_get_functiondef('public.admin_set_goods_draft_archived(uuid,integer,boolean)'::regprocedure) into original;
  needle:=$body$if not p_archived and d.archived_at is not null and (select count(*) from public.admin_goods_drafts where owner_id=actor and archived_at is null)>=40 then
    raise check_violation using message='goods_draft_limit';
  end if;$body$;
  if strpos(original,needle)=0 then raise exception 'goods draft restore capacity gate not found'; end if;
  execute replace(original,needle,'if not p_archived and d.archived_at is not null then perform private.make_room_for_goods_draft(actor); end if;');
end $$;
notify pgrst,'reload schema';
