-- #432: postgres_changes reuses owner/staff RLS. Internal notes are never published.
-- DELETE/TRUNCATE cannot be authorized against a surviving row, so this first
-- repo-owned Realtime publication emits INSERT and UPDATE only.
alter publication supabase_realtime set (publish = 'insert, update');
alter publication supabase_realtime add table public.inquiries, public.inquiry_messages;

-- Client-side select/filter options are not an authorization boundary. Realtime
-- and the Data API both honor these grants, including wildcard subscriptions.
revoke select on public.inquiries from authenticated;
grant select (id,reference,user_id,category,title,status,order_id,good_id,
  created_at,last_message_at,answered_at,closed_at) on public.inquiries to authenticated;
revoke select on public.inquiry_messages from authenticated;
grant select (id,inquiry_id,author,body,image_paths,created_at) on public.inquiry_messages to authenticated;

-- Staff identity/assignment is available only through the existing staff RPC.
create or replace function public.admin_inquiry_workspace(target_inquiry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  select jsonb_build_object(
    'assigneeId', thread.assignee_id, 'waitingSince', thread.waiting_since,
    'assigneeName', case when assignee.id is null then null else
      coalesce(nullif(btrim(assignee.nickname), ''), '운영자_' || left(assignee.id::text, 6)) end,
    'staffOptions', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'name',
        coalesce(nullif(btrim(profile.nickname), ''), '운영자_' || left(profile.id::text, 6)))
        order by profile.nickname nulls last, profile.id)
      from public.profiles as profile
      where profile.role in ('staff', 'admin') and profile.suspended_at is null
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', note.id, 'body', note.body,
        'authorName', coalesce(nullif(btrim(author.nickname), ''),
          case when author.id is null then '탈퇴한 운영자' else '운영자_' || left(author.id::text, 6) end),
        'createdAt', note.created_at) order by note.created_at, note.id)
      from public.inquiry_internal_notes as note
      left join public.profiles as author on author.id = note.author_id
      where note.inquiry_id = thread.id
    ), '[]'::jsonb)
  ) into v_result
  from public.inquiries as thread
  left join public.profiles as assignee on assignee.id = thread.assignee_id
  where thread.id = target_inquiry_id;
  if not found then raise no_data_found using message = 'inquiry_not_found'; end if;
  return v_result;
end;
$$;
revoke all on function public.admin_inquiry_workspace(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_inquiry_workspace(uuid) to authenticated;

