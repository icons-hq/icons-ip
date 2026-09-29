-- #513: a notice is a system message, never a staff answer.
alter table public.inquiry_messages
  drop constraint inquiry_messages_author_check,
  alter column author_id drop not null,
  add constraint inquiry_messages_author_check check(author in ('user','staff','system')),
  add constraint inquiry_messages_author_identity_check check(
    (author='system' and author_id is null) or (author in ('user','staff') and author_id is not null)
  );

-- Keep all existing ownership, suspension, upload and rate-limit checks in one path.
alter function public.create_inquiry(text,text,text,uuid,text,text[]) set schema private;
alter function private.create_inquiry(text,text,text,uuid,text,text[]) rename to create_inquiry_before_system_notice;
revoke all on function private.create_inquiry_before_system_notice(text,text,text,uuid,text,text[])
  from public,anon,authenticated,service_role;

create function public.create_inquiry(
  target_category text,target_title text,target_body text,
  target_order_id uuid default null,target_good_id text default null,target_image_paths text[] default '{}'
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare thread_id uuid; notice jsonb;
begin
  thread_id:=private.create_inquiry_before_system_notice(target_category,target_title,target_body,target_order_id,target_good_id,target_image_paths);
  select settings.inquiry_auto_replies->thread.category into notice
    from public.store_settings settings cross join public.inquiries thread
    where settings.singleton and thread.id=thread_id;
  if (notice->>'enabled')::boolean then
    insert into public.inquiry_messages(inquiry_id,author,author_id,body,created_at)
      values(thread_id,'system',null,notice->>'body',clock_timestamp());
  end if;
  -- Do not change status/answered_at/handled_by/assignment/waiting_since or enqueue notifications.
  return thread_id;
end $$;
revoke all on function public.create_inquiry(text,text,text,uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.create_inquiry(text,text,text,uuid,text,text[]) to authenticated;
