-- Completion changes the active-draft count. Serialize it with saving,
-- archiving and restoring before taking a draft row lock.
create or replace function public.admin_save_good_from_draft(target_good jsonb,p_draft_id uuid,p_draft_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.admin_goods_drafts; result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if p_draft_id is null or p_draft_revision is null or p_draft_revision<1 or target_good is null or jsonb_typeof(target_good)<>'object'
    or nullif(target_good->>'previous_id','') is not null then raise invalid_parameter_value using message='invalid_goods_draft'; end if;
  perform pg_advisory_xact_lock(hashtextextended('goods-drafts-owner:'||auth.uid()::text,0));
  select * into d from public.admin_goods_drafts where id=p_draft_id and owner_id=auth.uid() for update;
  if not found then raise no_data_found using message='goods_draft_not_found'; end if;
  if d.completed_result is not null and d.revision=p_draft_revision+1 then return d.completed_result||jsonb_build_object('draftAlreadyCompleted',true); end if;
  if d.archived_at is not null or d.revision<>p_draft_revision then raise exception 'goods_draft_changed' using errcode='PT409'; end if;
  result:=public.admin_save_good(target_good);
  if coalesce(result->>'id','')='' then raise check_violation using message='goods_draft_completion_failed'; end if;
  update public.admin_goods_drafts set archived_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1,
    completed_good_id=result->>'id',completed_result=result where id=p_draft_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.goods.draft.completed','goods_draft:'||p_draft_id::text,
    jsonb_build_object('goodId',result->>'id','revision',d.revision+1));
  return result;
end $$;
revoke all on function public.admin_save_good_from_draft(jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good_from_draft(jsonb,uuid,integer) to authenticated;
notify pgrst,'reload schema';
