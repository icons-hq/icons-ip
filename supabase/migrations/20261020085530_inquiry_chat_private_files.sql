-- Private reusable consultation files and idempotent attachment messages.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('inquiry-files-private','inquiry-files-private',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','application/pdf','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table private.inquiry_chat_files(
 id uuid primary key,actor_id uuid references public.profiles(id) on delete set null,session_id uuid not null,
 filename text not null check(char_length(filename) between 1 and 160 and filename!~'[[:cntrl:]/\\]'),
 mime_type text not null,path text not null unique,size_bytes integer not null check(size_bytes between 1 and 20971520),
 sha256 text check(sha256~'^[0-9a-f]{64}$'),state text not null default 'pending' check(state in('pending','verified','retired','cleaned')),
 in_library boolean not null,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),verified_at timestamptz,
 check(state<>'verified' or sha256 is not null and verified_at is not null),
 check(path~'^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|pdf|txt|xls|xlsx|ppt|doc|docx|hwp)$')
);
alter table private.inquiry_chat_files enable row level security;
alter table private.inquiry_chat_files owner to postgres;
revoke all on private.inquiry_chat_files from public,anon,authenticated,service_role;
alter table public.inquiry_messages add column file_ids uuid[] not null default '{}';
grant select(file_ids) on public.inquiry_messages to authenticated;
alter table public.inquiry_messages add constraint inquiry_messages_file_ids_check check(cardinality(file_ids)<=3 and array_position(file_ids,null) is null);
alter table public.inquiry_messages drop constraint inquiry_messages_body_check;
alter table public.inquiry_messages add constraint inquiry_messages_body_check check(char_length(body)<=2000 and
 (body~'[^[:space:]]' or body='' and (cardinality(image_paths)>0 or cardinality(file_ids)>0)));
create table private.inquiry_chat_send_receipts(
 operation_id uuid primary key,actor_id uuid not null references public.profiles(id) on delete cascade,inquiry_id uuid not null references public.inquiries(id) on delete cascade,
 request jsonb not null,message_id uuid not null references public.inquiry_messages(id) on delete cascade,created_at timestamptz not null default clock_timestamp()
);
alter table private.inquiry_chat_send_receipts enable row level security;
alter table private.inquiry_chat_send_receipts owner to postgres;
revoke all on private.inquiry_chat_send_receipts from public,anon,authenticated,service_role;

create function private.inquiry_file_extension(p_mime text) returns text language sql immutable set search_path='' as $$
 select case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif'
 when 'video/mp4' then 'mp4' when 'application/pdf' then 'pdf' when 'text/plain' then 'txt' when 'application/vnd.ms-excel' then 'xls'
 when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx' when 'application/vnd.ms-powerpoint' then 'ppt'
 when 'application/msword' then 'doc' when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx' when 'application/x-hwp' then 'hwp' end;
$$;
alter table private.inquiry_chat_files add constraint inquiry_chat_file_type check(private.inquiry_file_extension(mime_type) is not null);
create function private.inquiry_file_session(p_actor uuid,p_session uuid,p_staff boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if p_actor is null or p_session is null then raise insufficient_privilege;end if;
 perform private.assert_active_user(p_actor);
 if private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise insufficient_privilege;end if;
 if p_staff then perform private.require_actor_operator_capability(p_actor,'cs.manage');end if;
end $$;
create function private.inquiry_file_metadata(p_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.filename,'mimeType',f.mime_type,'size',f.size_bytes) order by v.n),'[]'::jsonb)
 from unnest(p_ids) with ordinality v(id,n) join private.inquiry_chat_files f on f.id=v.id and f.sha256 is not null;
$$;
create function public.service_prepare_inquiry_file(p_actor uuid,p_session uuid,p_id uuid,p_name text,p_mime text,p_size integer,p_library boolean) returns jsonb
language plpgsql security definer set search_path='' as $$declare f private.inquiry_chat_files;extension text;begin
 perform private.inquiry_file_session(p_actor,p_session,true);extension:=private.inquiry_file_extension(p_mime);
 if p_id is null or p_library is null or p_size is null or p_size not between 1 and 20971520 or extension is null
 or p_name is null or char_length(btrim(p_name)) not between 1 and 160 or p_name~'[[:cntrl:]/\\]' then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('inquiry-file-library',0));
 select * into f from private.inquiry_chat_files where id=p_id for update;
 if found then
  if f.actor_id is distinct from p_actor or f.session_id<>p_session or f.filename<>btrim(p_name) or f.mime_type<>p_mime or f.size_bytes<>p_size or f.in_library<>p_library then raise sqlstate 'PT409';end if;
  if f.state not in('pending','verified') or f.state='pending' and f.expires_at<=clock_timestamp() then raise check_violation using message='inquiry_file_expired';end if;
 else
  if (select count(*) from private.inquiry_chat_files where actor_id=p_actor and state='pending' and expires_at>clock_timestamp())>=10
   or p_library and (select count(*) from private.inquiry_chat_files where in_library and(state='verified' or state='pending' and expires_at>clock_timestamp()))>=100 then
   raise check_violation using message='inquiry_file_limit';end if;
  insert into private.inquiry_chat_files(id,actor_id,session_id,filename,mime_type,size_bytes,path,in_library,expires_at)
  values(p_id,p_actor,p_session,btrim(p_name),p_mime,p_size,p_actor::text||'/'||p_id::text||'.'||extension,p_library,clock_timestamp()+interval '30 minutes') returning * into f;
 end if;
 return jsonb_build_object('id',f.id,'path',f.path,'state',f.state,'name',f.filename,'mimeType',f.mime_type,'size',f.size_bytes,'sha256',f.sha256);
end $$;
create function public.can_upload_inquiry_file(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_operator_capability(auth.uid(),'cs.manage',false) and not private.is_account_write_fenced(auth.uid()) and exists(
  select 1 from private.inquiry_chat_files f join auth.sessions s on s.id=f.session_id and s.user_id=f.actor_id
  where f.actor_id=auth.uid() and f.session_id::text=auth.jwt()->>'session_id' and f.path=p_path and f.state='pending' and f.expires_at>clock_timestamp()
   and(s.not_after is null or s.not_after>clock_timestamp()));
$$;
create policy inquiry_files_private_insert on storage.objects for insert to authenticated with check(bucket_id='inquiry-files-private' and public.can_upload_inquiry_file(name));
-- There are deliberately no storage SELECT/UPDATE/DELETE policies. Files cannot
-- be overwritten, and every private download rechecks the session and message.
create function public.service_read_inquiry_file(p_actor uuid,p_session uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare f private.inquiry_chat_files;begin
 perform private.inquiry_file_session(p_actor,p_session,true);
 select * into f from private.inquiry_chat_files where id=p_id and actor_id=p_actor and session_id=p_session and state in('pending','verified') and(state='verified' or expires_at>clock_timestamp());
 if not found then raise no_data_found;end if;
 return jsonb_build_object('id',f.id,'path',f.path,'state',f.state,'name',f.filename,'mimeType',f.mime_type,'size',f.size_bytes,'sha256',f.sha256);
end $$;
create function public.service_verify_inquiry_file(p_actor uuid,p_session uuid,p_id uuid,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$declare f private.inquiry_chat_files;begin
 perform private.inquiry_file_session(p_actor,p_session,true);
 select * into f from private.inquiry_chat_files where id=p_id and actor_id=p_actor and session_id=p_session for update;
 if not found or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' then raise insufficient_privilege;end if;
 if f.state='verified' then if f.sha256<>p_sha256 then raise sqlstate 'PT409';end if;
 elsif f.state='pending' and f.expires_at>clock_timestamp() and exists(select 1 from storage.objects o where o.bucket_id='inquiry-files-private' and o.name=f.path
  and o.metadata->>'mimetype'=f.mime_type and o.metadata->>'size'=f.size_bytes::text) then
  update private.inquiry_chat_files set state='verified',sha256=p_sha256,verified_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours' where id=p_id;
 else raise check_violation using message='inquiry_file_unverified';end if;
 return private.inquiry_file_metadata(array[p_id])->0;
end $$;
create function public.admin_inquiry_file_library() returns jsonb language plpgsql volatile security definer set search_path='' as $$begin
 perform private.require_operator_capability('cs.manage',false);
 return private.inquiry_file_metadata(array(select id from private.inquiry_chat_files where in_library and state='verified' order by created_at desc,id));
end $$;
create function public.admin_retire_inquiry_file(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('cs.manage',false);
 update private.inquiry_chat_files set state='retired',expires_at=clock_timestamp() where id=p_id and state in('pending','verified');
 if found then insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.inquiry.file_removed','inquiry_file:'||p_id,jsonb_build_object('fileId',p_id));return true;end if;
 return exists(select 1 from private.inquiry_chat_files where id=p_id and state='retired');
end $$;
create function public.inquiry_message_files(p_inquiry_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not exists(select 1 from public.inquiries where id=p_inquiry_id and(user_id=auth.uid() or public.has_operator_capability('cs.manage',false))) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_object_agg(m.id,private.inquiry_file_metadata(m.file_ids)) from public.inquiry_messages m where m.inquiry_id=p_inquiry_id and cardinality(m.file_ids)>0),'{}'::jsonb);
end $$;
create function public.service_inquiry_file_download(p_actor uuid,p_session uuid,p_file uuid,p_message uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare f private.inquiry_chat_files;staff boolean;begin
 perform private.inquiry_file_session(p_actor,p_session,false);staff:=private.has_operator_capability(p_actor,'cs.manage',false);
 select * into f from private.inquiry_chat_files where id=p_file and sha256 is not null and state in('verified','retired');
 if not found then raise insufficient_privilege;end if;
 if p_message is null then
  if not staff or not f.in_library or f.state<>'verified' then raise insufficient_privilege;end if;
 elsif not exists(select 1 from public.inquiry_messages m join public.inquiries i on i.id=m.inquiry_id
  where m.id=p_message and p_file=any(m.file_ids) and(staff or i.user_id=p_actor)) then raise insufficient_privilege;end if;
 return (private.inquiry_file_metadata(array[p_file])->0)||jsonb_build_object('path',f.path,'sha256',f.sha256);
end $$;
create function public.admin_send_inquiry_chat_message(p_inquiry uuid,p_body text,p_files uuid[],p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();body text:=btrim(coalesce(p_body,''));files uuid[]:=coalesce(p_files,'{}');thread public.inquiries;receipt private.inquiry_chat_send_receipts;request jsonb;message uuid;begin
 perform private.require_operator_capability('cs.manage',false);
 if p_operation is null or p_inquiry is null or char_length(body)>2000 or(body='' and cardinality(files)=0) or cardinality(files)>3
  or array_position(files,null) is not null or cardinality(files)<>(select count(distinct x) from unnest(files)x) then raise invalid_parameter_value;end if;
 request:=jsonb_build_object('inquiryId',p_inquiry,'body',body,'fileIds',files);
 perform pg_advisory_xact_lock(hashtextextended('inquiry-send:'||p_operation::text,0));
 select * into receipt from private.inquiry_chat_send_receipts where operation_id=p_operation;
 if found then
  if receipt.actor_id is distinct from actor or receipt.request is distinct from request then raise sqlstate 'PT409';end if;
  message:=receipt.message_id;
 else
  select * into thread from public.inquiries where id=p_inquiry for update;
  if not found then raise no_data_found using message='inquiry_not_found';end if;
  if thread.status='closed' then raise check_violation using message='inquiry_closed';end if;
  perform id from private.inquiry_chat_files where id=any(files) order by id for share;
  if(select count(*) from private.inquiry_chat_files where id=any(files) and state='verified' and(in_library or actor_id=actor and expires_at>clock_timestamp()))<>cardinality(files) then raise check_violation using message='inquiry_file_unavailable';end if;
  insert into public.inquiry_messages(inquiry_id,author,author_id,body,file_ids) values(p_inquiry,'staff',actor,body,files) returning id into message;
  update public.inquiries set status='answered',handled_by=actor,answered_at=coalesce(answered_at,now()),last_message_at=now() where id=p_inquiry;
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
  values(thread.user_id,'inquiry_answered','문의에 답변이 등록됐어요',left('문의 #'||thread.reference::text||' — '||thread.title,500),'/my/inquiries/'||p_inquiry::text,'inquiry',p_inquiry::text,'inquiry:answered:'||message::text) on conflict(user_id,dedupe_key) do nothing;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.inquiry.answered','inquiries:'||p_inquiry,jsonb_build_object('messageId',message,'previousStatus',thread.status,'attachmentCount',cardinality(files),'operationId',p_operation));
  insert into private.inquiry_chat_send_receipts(operation_id,actor_id,inquiry_id,request,message_id) values(p_operation,actor,p_inquiry,request,message);
 end if;
 return(select jsonb_build_object('messageId',message,'recipientId',i.user_id,'recipientEmail',p.email,'reference',i.reference,'title',i.title,'operationId',p_operation) from public.inquiries i join public.profiles p on p.id=i.user_id where i.id=p_inquiry);
end $$;

CREATE OR REPLACE FUNCTION public.admin_answer_inquiry(target_inquiry_id uuid, target_body text, target_image_paths text[] DEFAULT '{}'::text[])
 RETURNS TABLE(message_id uuid, recipient_id uuid, recipient_email text, inquiry_reference bigint, inquiry_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_thread public.inquiries%rowtype;
  v_message_id uuid;
begin
  perform private.require_operator_capability('cs.manage',false);

  if v_actor is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(v_body)>2000 or (v_body='' and cardinality(coalesce(target_image_paths,'{}'))=0) then
    raise invalid_parameter_value using message = 'invalid_inquiry_body';
  end if;

  select *
  into v_thread
  from public.inquiries as thread
  where thread.id = target_inquiry_id
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;
  if v_thread.status = 'closed' then
    raise check_violation using message = 'inquiry_closed';
  end if;

  v_paths := private.assert_own_inquiry_image_paths(target_image_paths, v_actor);
  if v_body='' and exists(select 1 from unnest(v_paths) image(path) where not exists(
    select 1 from storage.objects object where object.bucket_id='user-uploads' and object.name=image.path)) then
    raise check_violation using message='inquiry_image_missing';
  end if;

  insert into public.inquiry_messages (inquiry_id, author, author_id, body, image_paths)
  values (target_inquiry_id, 'staff', v_actor, v_body, v_paths)
  returning id into v_message_id;

  update public.inquiries as thread
  set
    status = 'answered',
    handled_by = v_actor,
    answered_at = coalesce(thread.answered_at, now()),
    last_message_at = now()
  where thread.id = target_inquiry_id;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  values (
    v_thread.user_id,
    'inquiry_answered',
    '문의에 답변이 등록됐어요',
    left('문의 #' || v_thread.reference::text || ' — ' || v_thread.title, 500),
    '/my/inquiries/' || target_inquiry_id::text,
    'inquiry',
    target_inquiry_id::text,
    'inquiry:answered:' || v_message_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.inquiry.answered',
    'inquiries:' || target_inquiry_id::text,
    jsonb_build_object(
      'messageId', v_message_id,
      'previousStatus', v_thread.status,
      'attachmentCount', cardinality(v_paths)
    )
  );

  return query
    select
      v_message_id,
      v_thread.user_id,
      profile.email,
      v_thread.reference,
      v_thread.title
    from public.profiles as profile
    where profile.id = v_thread.user_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.append_inquiry_message(target_inquiry_id uuid, target_body text, target_image_paths text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_status text;
  v_message_id uuid;
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;
  if char_length(v_body)>2000 or (v_body='' and cardinality(coalesce(target_image_paths,'{}'))=0) then
    raise invalid_parameter_value using message = 'invalid_inquiry_body';
  end if;

  select thread.status
  into v_status
  from public.inquiries as thread
  where thread.id = target_inquiry_id
    and thread.user_id = v_actor
  for update;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  -- 종결 후 재문의는 새 스레드다. 닫힌 대화를 되살리면 어드민 큐의 처리 이력과
  -- 자동 종결 기준(마지막 답변 시각)이 한 행 안에서 여러 번 뒤집힌다.
  if v_status = 'closed' then
    raise check_violation using message = 'inquiry_closed';
  end if;

  v_paths := private.assert_own_inquiry_image_paths(target_image_paths, v_actor);
  if v_body='' and exists(select 1 from unnest(v_paths) image(path) where not exists(
    select 1 from storage.objects object where object.bucket_id='user-uploads' and object.name=image.path)) then
    raise check_violation using message='inquiry_image_missing';
  end if;

  insert into public.inquiry_messages (inquiry_id, author, author_id, body, image_paths)
  values (target_inquiry_id, 'user', v_actor, v_body, v_paths)
  returning id into v_message_id;

  update public.inquiries as thread
  set
    status = 'open',
    last_message_at = now()
  where thread.id = target_inquiry_id;

  return v_message_id;
end;
$function$;


create function public.service_claim_inquiry_file_cleanup(p_limit integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if p_limit not between 1 and 20 then raise invalid_parameter_value;end if;
 with candidates as(select id from private.inquiry_chat_files f where state in('pending','verified','retired') and expires_at<=clock_timestamp()
  and(not in_library or state<>'verified') and not exists(select 1 from public.inquiry_messages where f.id=any(file_ids))
  order by expires_at,id for update skip locked limit p_limit), claimed as(
 update private.inquiry_chat_files f set state='retired' from candidates c where f.id=c.id returning f.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',path)),'[]') into result from claimed;return result;
end $$;
create function public.service_complete_inquiry_file_cleanup(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from private.inquiry_chat_files where id=p_id for update;
 if exists(select 1 from public.inquiry_messages where p_id=any(file_ids)) then raise check_violation;end if;
 update private.inquiry_chat_files set state='cleaned' where id=p_id and state='retired';
end $$;
-- Explicitly seal every new function before granting only its intended callers.
do $$declare entry regprocedure;begin
 for entry in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in('inquiry_file_extension','inquiry_file_session','inquiry_file_metadata'))
 or(n.nspname='public' and p.proname in('service_prepare_inquiry_file','can_upload_inquiry_file','service_read_inquiry_file','service_verify_inquiry_file','admin_inquiry_file_library','admin_retire_inquiry_file','inquiry_message_files','service_inquiry_file_download','admin_send_inquiry_chat_message','service_claim_inquiry_file_cleanup','service_complete_inquiry_file_cleanup')) loop
  execute format('alter function %s owner to postgres',entry);execute format('revoke all on function %s from public,anon,authenticated,service_role',entry);
 end loop;
end $$;
grant execute on function public.service_prepare_inquiry_file(uuid,uuid,uuid,text,text,integer,boolean),public.service_read_inquiry_file(uuid,uuid,uuid),public.service_verify_inquiry_file(uuid,uuid,uuid,text),public.service_inquiry_file_download(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.service_claim_inquiry_file_cleanup(integer),public.service_complete_inquiry_file_cleanup(uuid) to service_role;
grant execute on function public.can_upload_inquiry_file(text),public.admin_inquiry_file_library(),public.admin_retire_inquiry_file(uuid),public.inquiry_message_files(uuid),public.admin_send_inquiry_chat_message(uuid,text,uuid[],uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_inquiry_file_library()'::regprocedure,'cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_retire_inquiry_file(uuid)'::regprocedure,'cs.manage','write',false);
select private.register_operator_rpc_contract('public.admin_send_inquiry_chat_message(uuid,text,uuid[],uuid)'::regprocedure,'cs.manage','write',false);
select private.register_operator_rpc_contract('public.admin_answer_inquiry(uuid,text,text[])'::regprocedure,'cs.manage','write',false);
select private.register_operator_rpc_contract('public.can_upload_inquiry_file(text)'::regprocedure,'cs.manage','mixed',false);
select private.register_operator_rpc_contract('public.inquiry_message_files(uuid)'::regprocedure,'cs.manage','mixed',false);
select private.register_operator_rpc_contract('public.service_inquiry_file_download(uuid,uuid,uuid,uuid)'::regprocedure,'cs.manage','mixed',false);
do $$declare entry regprocedure;begin
 for entry in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in('inquiry_file_extension','inquiry_file_session','inquiry_file_metadata'))
 or(n.nspname='public' and p.proname in('service_prepare_inquiry_file','can_upload_inquiry_file','service_read_inquiry_file','service_verify_inquiry_file','inquiry_message_files','service_inquiry_file_download','service_claim_inquiry_file_cleanup','service_complete_inquiry_file_cleanup')) loop
  perform private.register_operator_internal_contract(entry);
 end loop;
end $$;
select private.register_operator_policy_contract('storage.objects'::regclass,'inquiry_files_private_insert','cs.manage');
notify pgrst,'reload schema';
commit;
