-- Public product questions/reviews use their own templates. Private inquiry
-- templates and their message/email delivery contracts remain unchanged.
create table public.cs_reply_templates (
 id uuid primary key,
 surface text not null check(surface in ('product_question','review')),
 category text not null check(category in ('product','shipping','return','exchange','refund','other')),
 title text not null check(char_length(title) between 1 and 35 and title=btrim(title)),
 body text not null check(char_length(body) between 1 and 2000 and body=btrim(body) and body ~ '[^[:space:]]'),
 revision integer not null default 1 check(revision>0),
 archived_at timestamptz,
 created_by uuid references public.profiles(id) on delete set null,
 updated_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(surface<>'review' or char_length(body) between 2 and 1000)
);
alter table public.cs_reply_templates enable row level security;
revoke all on public.cs_reply_templates from public,anon,authenticated,service_role;
grant select on public.cs_reply_templates to authenticated;
create policy cs_reply_templates_staff_read on public.cs_reply_templates for select to authenticated using((select public.is_staff()));
create index cs_reply_templates_surface_title_idx on public.cs_reply_templates(surface,title,id);

create function public.admin_save_cs_reply_template(p_id uuid,p_surface text,p_category text,p_title text,p_body text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.cs_reply_templates; saved public.cs_reply_templates;
 title_value text:=btrim(coalesce(p_title,'')); body_value text:=btrim(coalesce(p_body,''),E' \t\n\r\f\v');
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_id is null or p_surface is null or p_surface not in ('product_question','review')
   or p_category is null or p_category not in ('product','shipping','return','exchange','refund','other')
   or char_length(title_value) not between 1 and 35 or title_value ~ '[[:cntrl:]]'
   or char_length(body_value) not between (case when p_surface='review' then 2 else 1 end) and (case when p_surface='review' then 1000 else 2000 end)
   or p_expected_revision is null or p_expected_revision<0 then
   raise invalid_parameter_value using message='invalid_cs_reply_template';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('cs_reply_template:'||p_id::text,0));
 select * into previous from public.cs_reply_templates where id=p_id for update;
 if found then
   if previous.surface<>p_surface or previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='cs_reply_template_changed'; end if;
   if previous.archived_at is not null then raise check_violation using message='cs_reply_template_archived'; end if;
   if (previous.category,previous.title,previous.body)=(p_category,title_value,body_value) then return to_jsonb(previous); end if;
   update public.cs_reply_templates set category=p_category,title=title_value,body=body_value,revision=revision+1,
     updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
 else
   if p_expected_revision<>0 then raise sqlstate 'PT409' using message='cs_reply_template_changed'; end if;
   insert into public.cs_reply_templates(id,surface,category,title,body,created_by,updated_by)
     values(p_id,p_surface,p_category,title_value,body_value,actor,actor) returning * into saved;
 end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.cs_reply_template.saved','cs_reply_templates:'||p_id::text,
   jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
 return to_jsonb(saved);
end $$;
revoke all on function public.admin_save_cs_reply_template(uuid,text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_cs_reply_template(uuid,text,text,text,text,integer) to authenticated;

create function public.admin_archive_cs_reply_template(p_id uuid,p_archived boolean,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.cs_reply_templates; saved public.cs_reply_templates;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_id is null or p_archived is null or p_expected_revision is null then raise invalid_parameter_value using message='invalid_cs_reply_template'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cs_reply_template:'||p_id::text,0));
 select * into previous from public.cs_reply_templates where id=p_id for update;
 if not found then raise no_data_found using message='cs_reply_template_not_found'; end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='cs_reply_template_changed'; end if;
 if (previous.archived_at is not null)=p_archived then return to_jsonb(previous); end if;
 update public.cs_reply_templates set archived_at=case when p_archived then clock_timestamp() else null end,
   revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.cs_reply_template.archived','cs_reply_templates:'||p_id::text,
   jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
 return to_jsonb(saved);
end $$;
revoke all on function public.admin_archive_cs_reply_template(uuid,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_archive_cs_reply_template(uuid,boolean,integer) to authenticated;

create table private.review_reply_batches (
 actor_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
revoke all on private.review_reply_batches from public,anon,authenticated,service_role;
grant all on private.review_reply_batches to postgres;

create function public.admin_reply_reviews_batch(p_request_id uuid,p_items jsonb,p_reply text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reply_value text:=btrim(coalesce(p_reply,'')); payload jsonb;
 previous private.review_reply_batches; entry jsonb; current_review public.reviews;
 target_id uuid; expected_reply_at timestamptz; expected_edited_at timestamptz;
 results jsonb:='[]'; outcome jsonb; result jsonb; failure_code text;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise invalid_parameter_value using message='invalid_review_batch'; end if;
 if jsonb_array_length(p_items) not between 1 and 50 or char_length(reply_value) not between 5 and 1000 then raise invalid_parameter_value using message='invalid_review_batch'; end if;
 for entry in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(entry)<>'object' or not(entry ?& array['id','expectedReplyAt','expectedEditedAt','expectedStatus'])
     or exists(select 1 from jsonb_object_keys(entry) key where key not in ('id','expectedReplyAt','expectedEditedAt','expectedStatus'))
     or jsonb_typeof(entry->'id')<>'string' or entry->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(entry->'expectedReplyAt') not in ('string','null') or jsonb_typeof(entry->'expectedEditedAt') not in ('string','null')
     or entry->>'expectedStatus' is null or entry->>'expectedStatus' not in ('visible','hidden') then
     raise invalid_parameter_value using message='invalid_review_batch';
   end if;
   begin expected_reply_at:=(entry->>'expectedReplyAt')::timestamptz; expected_edited_at:=(entry->>'expectedEditedAt')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_review_batch'; end;
 end loop;
 if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise invalid_parameter_value using message='invalid_review_batch'; end if;
 select jsonb_build_object('reply',reply_value,'items',jsonb_agg(value order by (value->>'id')::uuid)) into payload from jsonb_array_elements(p_items);
 perform pg_advisory_xact_lock(hashtextextended('review_reply_batch:'||actor::text||':'||p_request_id::text,0));
 select * into previous from private.review_reply_batches where actor_id=actor and request_id=p_request_id;
 if found then
   if previous.payload<>payload then raise sqlstate 'PT409' using message='review_batch_request_changed'; end if;
   return previous.result;
 end if;
 -- All batches lock rows in the same order; per-item subtransactions keep a
 -- deleted/stale target from discarding other successful replies.
 for entry in select value from jsonb_array_elements(payload->'items') loop
   target_id:=(entry->>'id')::uuid;
   begin
     select * into current_review from public.reviews where id=target_id for update;
     if not found then raise no_data_found using message='review_not_found'; end if;
     expected_reply_at:=(entry->>'expectedReplyAt')::timestamptz; expected_edited_at:=(entry->>'expectedEditedAt')::timestamptz;
     if current_review.admin_reply_at is distinct from expected_reply_at
       or current_review.edited_at is distinct from expected_edited_at or current_review.status::text<>entry->>'expectedStatus' then
       raise sqlstate 'PT409' using message='review_changed';
     end if;
     if current_review.admin_reply is not distinct from reply_value then
       outcome:=jsonb_build_object('reviewId',target_id,'status','unchanged','code',null);
     else
       perform public.admin_reply_to_review(target_id,reply_value);
       outcome:=jsonb_build_object('reviewId',target_id,'status','saved','code',null);
     end if;
   exception when others then
     failure_code:=case sqlerrm when 'review_not_found' then 'review_not_found' when 'review_changed' then 'review_changed'
       when 'staff_required' then 'staff_required' when 'invalid_review_reply' then 'invalid_review_reply' else 'save_failed' end;
     outcome:=jsonb_build_object('reviewId',target_id,'status','failed','code',failure_code,'databaseCode',sqlstate);
   end;
   results:=results||jsonb_build_array(outcome);
 end loop;
 result:=jsonb_build_object('requestId',p_request_id,'items',results);
 insert into private.review_reply_batches(actor_id,request_id,payload,result) values(actor,p_request_id,payload,result);
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.review.batch_replied','review_reply_batches:'||p_request_id::text,result);
 return result;
end $$;
revoke all on function public.admin_reply_reviews_batch(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_reply_reviews_batch(uuid,jsonb,text) to authenticated;

create function public.admin_review_reply_batch_result(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
 return (select result from private.review_reply_batches where actor_id=auth.uid() and request_id=p_request_id);
end $$;
revoke all on function public.admin_review_reply_batch_result(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_review_reply_batch_result(uuid) to authenticated;
notify pgrst,'reload schema';
