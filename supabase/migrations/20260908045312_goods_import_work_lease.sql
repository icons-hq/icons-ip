-- Serialize image preparation together with product commit across browser tabs.
-- The lease outlives the 300-second action budget and recovers abandoned actions.
alter table public.admin_goods_imports add column work_token uuid,
 add column work_expires_at timestamptz;
create function public.service_acquire_goods_import_work(target_batch uuid,target_actor uuid,target_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if target_token is null then return false; end if;
 update public.admin_goods_imports set work_token=target_token,work_expires_at=now()+interval '10 minutes'
 where id=target_batch and actor_id=target_actor and state='ready' and expires_at>now()
 and (work_token is null or work_expires_at<=now());
 return found;
end $$;
revoke all on function public.service_acquire_goods_import_work(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_acquire_goods_import_work(uuid,uuid,uuid) to service_role;
create function public.service_release_goods_import_work(target_batch uuid,target_actor uuid,target_token uuid)
returns void language sql security definer set search_path='' as $$
 update public.admin_goods_imports set work_token=null,work_expires_at=null
 where id=target_batch and actor_id=target_actor and work_token=target_token;
$$;
revoke all on function public.service_release_goods_import_work(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_release_goods_import_work(uuid,uuid,uuid) to service_role;
