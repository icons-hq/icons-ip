-- Verified product videos use a separate claim and storage lifecycle.
-- The existing image pipeline keeps its MIME/size contract.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('goods-video-staging','goods-video-staging',false,52428800,array['video/mp4']),
 ('goods-videos','goods-videos',true,52428800,array['video/mp4'])
on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table private.goods_media_assets(
 id uuid primary key,
 actor_id uuid references public.profiles(id) on delete set null,
 kind text not null check(kind in('video','shortclip')),
 path text not null unique,
 source_size integer not null check(source_size between 1 and 52428800),
 status text not null default 'pending' check(status in('pending','processing','verified','attached','retired','rejected','cleanup','cleaned')),
 expires_at timestamptz not null,
 metadata jsonb,
 processing_started_at timestamptz,
 verified_at timestamptz,
 attached_at timestamptz,
 staging_cleaned_at timestamptz,
 cleanup_claimed_at timestamptz,
 cleanup_completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 constraint goods_media_path check(path=kind||'/'||id::text||'.mp4'),
 constraint goods_media_verified_metadata check(status not in('verified','attached','retired') or metadata is not null)
);
create index goods_media_actor_active on private.goods_media_assets(actor_id,status,expires_at);
create index goods_media_cleanup on private.goods_media_assets(status,expires_at);
alter table private.goods_media_assets enable row level security;
revoke all on private.goods_media_assets from public,anon,authenticated,service_role;

create table private.goods_media_bindings(
 good_id text primary key references public.goods(id) on update cascade on delete cascade,
 video_asset_id uuid references private.goods_media_assets(id), video_title text,
 shortclip_asset_id uuid references private.goods_media_assets(id), shortclip_title text,
 revision bigint not null default 0 check(revision>=0), updated_at timestamptz not null default clock_timestamp(),
 check((video_asset_id is null and video_title is null) or(video_asset_id is not null and video_title is not null and length(btrim(video_title)) between 1 and 20)),
 check((shortclip_asset_id is null and shortclip_title is null) or(shortclip_asset_id is not null and shortclip_title is not null and length(btrim(shortclip_title)) between 1 and 20)),
 check(video_asset_id is distinct from shortclip_asset_id or video_asset_id is null)
);
create unique index goods_media_video_once on private.goods_media_bindings(video_asset_id) where video_asset_id is not null;
create unique index goods_media_shortclip_once on private.goods_media_bindings(shortclip_asset_id) where shortclip_asset_id is not null;
alter table private.goods_media_bindings enable row level security;
revoke all on private.goods_media_bindings from public,anon,authenticated,service_role;

create table private.goods_media_settings(id boolean primary key default true check(id),priority text not null default 'image' check(priority in('image','video','shortclip')),shortclips boolean not null default false,revision bigint not null default 0 check(revision>=0));
insert into private.goods_media_settings(id) values(true);
alter table private.goods_media_settings enable row level security;
revoke all on private.goods_media_settings from public,anon,authenticated,service_role;

create function private.goods_media_metadata_valid(p_metadata jsonb,p_source_size integer) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text;
begin
 if jsonb_typeof(p_metadata)<>'object' or (select count(*) from jsonb_object_keys(p_metadata))<>7
  or not p_metadata ?& array['width','height','durationMs','byteSize','sha256','videoCodec','audioCodec'] then return false;end if;
 foreach field in array array['width','height','durationMs','byteSize'] loop
  if jsonb_typeof(p_metadata->field)<>'number' or (p_metadata->>field)!~'^[0-9]{1,8}$' then return false;end if;
 end loop;
 return (p_metadata->>'width')::integer between 1 and 1920 and (p_metadata->>'height')::integer between 1 and 1920
  and (p_metadata->>'durationMs')::integer between 1 and 60000 and (p_metadata->>'byteSize')::integer=p_source_size
  and p_source_size between 1 and 52428800 and jsonb_typeof(p_metadata->'sha256')='string' and jsonb_typeof(p_metadata->'videoCodec')='string' and p_metadata->>'sha256'~'^[a-f0-9]{64}$'
  and p_metadata->>'videoCodec'~'^avc1\.[a-fA-F0-9]{6}$' and (p_metadata->'audioCodec'='null'::jsonb or p_metadata->>'audioCodec'='mp4a.40.2');
end $$;
revoke all on function private.goods_media_metadata_valid(jsonb,integer) from public,anon,authenticated,service_role;

create function public.service_prepare_goods_media_upload(p_actor_id uuid,p_id uuid,p_kind text,p_source_size integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare claimed private.goods_media_assets%rowtype;
begin
 perform private.require_actor_operator_capability(p_actor_id,'catalog.manage');
 if p_id is null or p_kind is null or p_kind not in('video','shortclip') or p_source_size is null or p_source_size not between 1 and 52428800 then raise check_violation using message='invalid_goods_media_upload';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-media-actor:'||p_actor_id::text,0));
 select * into claimed from private.goods_media_assets where id=p_id for update;
 if found then
  if claimed.actor_id is distinct from p_actor_id or claimed.kind<>p_kind or claimed.source_size<>p_source_size then raise unique_violation using message='goods_media_claim_conflict';end if;
  if claimed.status<>'pending' or claimed.expires_at<=clock_timestamp() then raise check_violation using message='goods_media_claim_closed';end if;
  return jsonb_build_object('id',claimed.id,'path',claimed.path,'kind',claimed.kind,'sourceSize',claimed.source_size,'status',claimed.status);
 end if;
 if (select count(*) from private.goods_media_assets where actor_id=p_actor_id and created_at>clock_timestamp()-interval '1 minute')>=4
  or (select count(*) from private.goods_media_assets where actor_id=p_actor_id and status in('pending','processing') and expires_at>clock_timestamp())>=4
  or (select count(*) from private.goods_media_assets where actor_id=p_actor_id and status='verified' and expires_at>clock_timestamp())>=12 then raise check_violation using message='goods_media_upload_budget';end if;
 insert into private.goods_media_assets(id,actor_id,kind,path,source_size,expires_at) values(p_id,p_actor_id,p_kind,p_kind||'/'||p_id::text||'.mp4',p_source_size,clock_timestamp()+interval '15 minutes') returning * into claimed;
 return jsonb_build_object('id',claimed.id,'path',claimed.path,'kind',claimed.kind,'sourceSize',claimed.source_size,'status',claimed.status);
end $$;
revoke all on function public.service_prepare_goods_media_upload(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.service_prepare_goods_media_upload(uuid,uuid,text,integer) to service_role;

create function public.can_stage_goods_media(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_operator_capability(auth.uid(),'catalog.manage',false) and exists(
  select 1 from private.goods_media_assets a where a.actor_id=auth.uid() and a.path=p_path and a.status='pending' and a.expires_at>clock_timestamp()
 );
$$;
revoke all on function public.can_stage_goods_media(text) from public,anon,authenticated,service_role;
grant execute on function public.can_stage_goods_media(text) to authenticated;
create policy goods_video_staging_insert on storage.objects for insert to authenticated with check(bucket_id='goods-video-staging' and public.can_stage_goods_media(name));

create function public.service_begin_goods_media_verification(p_actor_id uuid,p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare claimed private.goods_media_assets%rowtype;
begin
 perform private.require_actor_operator_capability(p_actor_id,'catalog.manage');
 perform pg_advisory_xact_lock(hashtextextended('goods-media-actor:'||p_actor_id::text,0));
 select * into claimed from private.goods_media_assets where id=p_id and actor_id=p_actor_id for update;
 if not found or claimed.expires_at<=clock_timestamp() or claimed.status not in('pending','processing','verified','attached') then return null;end if;
 if claimed.status in('verified','attached') then
  return jsonb_build_object('id',claimed.id,'path',claimed.path,'kind',claimed.kind,'sourceSize',claimed.source_size,'status',claimed.status,'metadata',claimed.metadata);
 end if;
 if claimed.status='processing' or exists(select 1 from private.goods_media_assets where actor_id=p_actor_id and status='processing' and expires_at>clock_timestamp()) then
  return jsonb_build_object('status','processing','id',claimed.id);
 end if;
 update private.goods_media_assets set status='processing',processing_started_at=clock_timestamp(),expires_at=clock_timestamp()+interval '15 minutes' where id=claimed.id;
 return jsonb_build_object('id',claimed.id,'path',claimed.path,'kind',claimed.kind,'sourceSize',claimed.source_size,'status','claimed');
end $$;
revoke all on function public.service_begin_goods_media_verification(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_begin_goods_media_verification(uuid,uuid) to service_role;

create function public.service_verify_goods_media_upload(p_actor_id uuid,p_id uuid,p_metadata jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare claimed private.goods_media_assets%rowtype;
begin
 perform private.require_actor_operator_capability(p_actor_id,'catalog.manage');
 select * into claimed from private.goods_media_assets where id=p_id and actor_id=p_actor_id for update;
 if not found then return false;end if;
 if claimed.status in('verified','attached') then return claimed.metadata=p_metadata;end if;
 if claimed.status<>'processing' or claimed.expires_at<=clock_timestamp() or not private.goods_media_metadata_valid(p_metadata,claimed.source_size)
  or not exists(select 1 from storage.objects o where o.bucket_id='goods-videos' and o.name=claimed.path and o.metadata->>'mimetype'='video/mp4' and o.metadata->>'size'=claimed.source_size::text) then return false;end if;
 update private.goods_media_assets set status='verified',metadata=p_metadata,verified_at=clock_timestamp(),expires_at=clock_timestamp()+interval '2 hours' where id=claimed.id;
 return true;
end $$;
revoke all on function public.service_verify_goods_media_upload(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_verify_goods_media_upload(uuid,uuid,jsonb) to service_role;

-- Owner cancellation may finish after capability revocation, but never retires an attached asset.
create function public.service_cancel_goods_media_upload(p_actor_id uuid,p_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_actor_id is null then return false;end if;
 -- A verifier may finish its Storage upload after an expired processing lease
 -- was already cleaned. Re-open that same owned claim for another cleanup.
 -- This is used only after a confirmed rejection, never an unknown receipt.
 update private.goods_media_assets set status='rejected',expires_at=clock_timestamp(),cleanup_claimed_at=null,cleanup_completed_at=null where id=p_id and actor_id=p_actor_id and status in('pending','processing','verified','rejected','cleanup','cleaned')
  and not exists(select 1 from private.goods_media_bindings b where b.video_asset_id=p_id or b.shortclip_asset_id=p_id);
 return found;
end $$;
revoke all on function public.service_cancel_goods_media_upload(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_cancel_goods_media_upload(uuid,uuid) to service_role;

create function private.goods_media_asset_json(p_id uuid,p_title text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'kind',a.kind,'path',a.path,'title',p_title)||a.metadata from private.goods_media_assets a where a.id=p_id and a.status='attached';
$$;
revoke all on function private.goods_media_asset_json(uuid,text) from public,anon,authenticated,service_role;
create function private.good_media_snapshot(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'goodName',g.name,'revision',coalesce(b.revision,0),'video',private.goods_media_asset_json(b.video_asset_id,b.video_title),'shortclip',private.goods_media_asset_json(b.shortclip_asset_id,b.shortclip_title))
 from public.goods g left join private.goods_media_bindings b on b.good_id=g.id where g.id=p_good_id;
$$;
revoke all on function private.good_media_snapshot(text) from public,anon,authenticated,service_role;

create function public.admin_get_good_media(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return private.good_media_snapshot(p_good_id);
end $$;
revoke all on function public.admin_get_good_media(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_good_media(text) to authenticated;

create function public.admin_save_good_media(p_good_id text,p_values jsonb,p_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.goods_media_bindings%rowtype;claimed private.goods_media_assets%rowtype;receipt public.audit_log%rowtype;
 field text; value jsonb; selected uuid; video_id uuid; clip_id uuid; video_label text; clip_label text; canonical jsonb:='{}'; request jsonb;before_data jsonb;result jsonb;
begin
 perform private.require_actor_operator_capability(actor,'catalog.manage');
 if p_good_id is null or p_good_id!~'^[a-z0-9][a-z0-9-]{0,199}$' or p_revision is null or p_revision<0 or p_operation_id is null
  or jsonb_typeof(p_values)<>'object' or (select count(*) from jsonb_object_keys(p_values))<>2 or not p_values ?& array['video','shortclip'] then raise check_violation using message='invalid_good_media';end if;
 foreach field in array array['video','shortclip'] loop
  value:=p_values->field;
  if value='null'::jsonb then canonical:=canonical||jsonb_build_object(field,null);continue;end if;
  if jsonb_typeof(value)<>'object' or (select count(*) from jsonb_object_keys(value))<>2 or not value ?& array['id','title']
   or jsonb_typeof(value->'id')<>'string' or (value->>'id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(value->'title')<>'string' or length(btrim(value->>'title')) not between 1 and 20 or (value->>'title')~'[[:cntrl:]]' then raise check_violation using message='invalid_good_media';end if;
  selected:=(value->>'id')::uuid;
  if field='video' then video_id:=selected;video_label:=btrim(value->>'title');else clip_id:=selected;clip_label:=btrim(value->>'title');end if;
  canonical:=canonical||jsonb_build_object(field,jsonb_build_object('id',selected,'title',btrim(value->>'title')));
 end loop;
 if video_id is not null and video_id=clip_id then raise check_violation using message='invalid_good_media';end if;
 request:=jsonb_build_object('goodId',p_good_id,'values',canonical,'revision',p_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods-media-operation:'||p_operation_id::text,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if found then
  if receipt.actor_id is distinct from actor or receipt.action<>'admin.goods_media.updated' or receipt.diff->'request'<>request then raise unique_violation using message='operation_conflict';end if;
  return receipt.diff->'result';
 end if;
 perform 1 from public.goods where id=p_good_id and archived_at is null for update;
 if not found then raise no_data_found using message='good_unavailable';end if;
 insert into private.goods_media_bindings(good_id) values(p_good_id) on conflict(good_id) do nothing;
 select * into previous from private.goods_media_bindings where good_id=p_good_id for update;
 if previous.revision<>p_revision then raise sqlstate 'PT409' using message='revision_conflict';end if;
 before_data:=private.good_media_snapshot(p_good_id);
 perform 1 from private.goods_media_assets where id=any(array[video_id,clip_id,previous.video_asset_id,previous.shortclip_asset_id]) order by id for update;
 foreach field in array array['video','shortclip'] loop
  selected:=case when field='video' then video_id else clip_id end;
  if selected is null then continue;end if;
  select * into claimed from private.goods_media_assets where id=selected;
  if not found or claimed.kind<>field or not private.goods_media_metadata_valid(claimed.metadata,claimed.source_size) then raise check_violation using message='goods_media_asset_unavailable';end if;
  if selected is not distinct from (case when field='video' then previous.video_asset_id else previous.shortclip_asset_id end) then
   if claimed.status<>'attached' then raise check_violation using message='goods_media_asset_unavailable';end if;
  elsif claimed.actor_id is distinct from actor or claimed.status<>'verified' or claimed.expires_at<=clock_timestamp()
   or exists(select 1 from private.goods_media_bindings b where b.video_asset_id=selected or b.shortclip_asset_id=selected) then
   raise check_violation using message='goods_media_asset_unavailable';
  end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='goods-videos' and o.name=claimed.path and o.metadata->>'mimetype'='video/mp4' and o.metadata->>'size'=claimed.source_size::text) then raise check_violation using message='goods_media_asset_unavailable';end if;
 end loop;
 update private.goods_media_assets set status='attached',attached_at=coalesce(attached_at,clock_timestamp()) where id=any(array[video_id,clip_id]);
 update private.goods_media_bindings set video_asset_id=video_id,video_title=video_label,shortclip_asset_id=clip_id,shortclip_title=clip_label,revision=revision+1,updated_at=clock_timestamp() where good_id=p_good_id;
 update private.goods_media_assets set status='retired',expires_at=clock_timestamp()+interval '7 days' where id=any(array[previous.video_asset_id,previous.shortclip_asset_id])
  and id is distinct from video_id and id is distinct from clip_id and not exists(select 1 from private.goods_media_bindings b where b.video_asset_id=goods_media_assets.id or b.shortclip_asset_id=goods_media_assets.id);
 result:=private.good_media_snapshot(p_good_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods_media.updated',p_good_id,jsonb_build_object('request',request,'before',before_data,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_good_media(text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good_media(text,jsonb,bigint,uuid) to authenticated;

-- A hard-delete cascade must start the same seven-day retirement period as
-- an explicit detach, measured from the removal rather than initial attach.
create function private.retire_deleted_good_media() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update private.goods_media_assets set status='retired',expires_at=clock_timestamp()+interval '7 days'
 where id=any(array[old.video_asset_id,old.shortclip_asset_id]) and status='attached'
  and not exists(select 1 from private.goods_media_bindings b where b.video_asset_id=goods_media_assets.id or b.shortclip_asset_id=goods_media_assets.id);
 return old;
end $$;
revoke all on function private.retire_deleted_good_media() from public,anon,authenticated,service_role;
create trigger goods_media_deleted_binding after delete on private.goods_media_bindings for each row execute function private.retire_deleted_good_media();

create function public.get_goods_media_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('priority',priority,'shortclips',shortclips) from private.goods_media_settings where id;
$$;
revoke all on function public.get_goods_media_settings() from public,anon,authenticated,service_role;
grant execute on function public.get_goods_media_settings() to anon,authenticated;
create function public.admin_get_goods_media_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'store.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 return jsonb_build_object('values',public.get_goods_media_settings(),'revision',(select revision from private.goods_media_settings where id));
end $$;
revoke all on function public.admin_get_goods_media_settings() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_media_settings() to authenticated;

create function public.admin_save_goods_media_settings(p_values jsonb,p_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();stored private.goods_media_settings%rowtype;receipt public.audit_log%rowtype;request jsonb;result jsonb;
begin
 perform private.require_actor_operator_capability(actor,'store.manage');
 if p_revision is null or p_revision<0 or p_operation_id is null or jsonb_typeof(p_values)<>'object' or (select count(*) from jsonb_object_keys(p_values))<>2
  or not p_values ?& array['priority','shortclips'] or jsonb_typeof(p_values->'priority')<>'string' or p_values->>'priority' not in('image','video','shortclip') or jsonb_typeof(p_values->'shortclips')<>'boolean' then raise check_violation using message='invalid_goods_media_settings';end if;
 request:=jsonb_build_object('values',p_values,'revision',p_revision);
 perform pg_advisory_xact_lock(hashtextextended('goods-media-operation:'||p_operation_id::text,0));
 select * into receipt from public.audit_log where id=p_operation_id;
 if found then
  if receipt.actor_id is distinct from actor or receipt.action<>'admin.goods_media_settings.updated' or receipt.diff->'request'<>request then raise unique_violation using message='operation_conflict';end if;
  return receipt.diff->'result';
 end if;
 select * into stored from private.goods_media_settings where id for update;
 if stored.revision<>p_revision then raise sqlstate 'PT409' using message='revision_conflict';end if;
 update private.goods_media_settings set priority=p_values->>'priority',shortclips=(p_values->>'shortclips')::boolean,revision=revision+1 where id;
 result:=jsonb_build_object('values',p_values,'revision',stored.revision+1);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.goods_media_settings.updated','product-detail',jsonb_build_object('request',request,'result',result));
 return result;
end $$;
revoke all on function public.admin_save_goods_media_settings(jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_media_settings(jsonb,bigint,uuid) to authenticated;

create function public.get_good_media(p_good_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('settings',public.get_goods_media_settings(),'video',private.goods_media_asset_json(b.video_asset_id,b.video_title),'shortclip',private.goods_media_asset_json(b.shortclip_asset_id,b.shortclip_title))
 from public.goods g join public.ips ip on ip.id=g.ip_id left join private.goods_media_bindings b on b.good_id=g.id
 where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;
$$;
revoke all on function public.get_good_media(text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_media(text) to anon,authenticated;

-- Atomically reserve expired/orphaned objects before Storage deletion. A save
-- cannot attach a reserved asset; live bindings exclude public cleanup.
create function public.service_claim_goods_media_cleanup(p_limit integer default 20) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare candidate private.goods_media_assets%rowtype;result jsonb:='[]';mode text;
begin
 for candidate in select a.* from private.goods_media_assets a where (
   (a.status in('verified','attached','retired') and a.staging_cleaned_at is null)
   or (a.status in('pending','processing','verified','rejected','retired') and a.expires_at<=clock_timestamp())
   or (a.status='cleanup' and a.cleanup_claimed_at<clock_timestamp()-interval '10 minutes')
   -- Storage can finish after a worker's lease and even after its profile was
   -- deleted. The immutable path is sufficient evidence for service cleanup.
   or (a.status='cleaned' and exists(select 1 from storage.objects o where o.bucket_id in('goods-video-staging','goods-videos') and o.name=a.path))
  ) order by a.created_at,a.id for update skip locked limit greatest(1,least(coalesce(p_limit,20),50)) loop
  mode:=case when candidate.status in('verified','attached','retired') and candidate.staging_cleaned_at is null then 'staging' else 'all' end;
  if mode='all' and exists(select 1 from private.goods_media_bindings b where b.video_asset_id=candidate.id or b.shortclip_asset_id=candidate.id) then continue;end if;
  if mode='all' then update private.goods_media_assets set status='cleanup',cleanup_claimed_at=clock_timestamp() where id=candidate.id;end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',candidate.id,'path',candidate.path,'mode',mode));
 end loop;
 return result;
end $$;
revoke all on function public.service_claim_goods_media_cleanup(integer) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_goods_media_cleanup(integer) to service_role;

create function public.service_complete_goods_media_cleanup(p_id uuid,p_mode text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_mode='staging' then
  update private.goods_media_assets set staging_cleaned_at=clock_timestamp() where id=p_id and status in('verified','attached','retired');
 elsif p_mode='all' then
  update private.goods_media_assets set status='cleaned',cleanup_completed_at=clock_timestamp(),staging_cleaned_at=coalesce(staging_cleaned_at,clock_timestamp()) where id=p_id and status='cleanup'
   and not exists(select 1 from private.goods_media_bindings b where b.video_asset_id=p_id or b.shortclip_asset_id=p_id);
 else return false;end if;
 return found;
end $$;
revoke all on function public.service_complete_goods_media_cleanup(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_complete_goods_media_cleanup(uuid,text) to service_role;

select private.register_operator_rpc_contract('public.service_prepare_goods_media_upload(uuid,uuid,text,integer)'::regprocedure,'catalog.manage','service_start',false);
select private.register_operator_rpc_contract('public.service_begin_goods_media_verification(uuid,uuid)'::regprocedure,'catalog.manage','service_start',false);
select private.register_operator_rpc_contract('public.service_verify_goods_media_upload(uuid,uuid,jsonb)'::regprocedure,'catalog.manage','service_start',false);
select private.register_operator_rpc_contract('public.service_cancel_goods_media_upload(uuid,uuid)'::regprocedure,'catalog.manage','service_finish',false);
select private.register_operator_rpc_contract('public.can_stage_goods_media(text)'::regprocedure,'catalog.manage','mixed',false);
select private.register_operator_policy_contract('storage.objects'::regclass,'goods_video_staging_insert','catalog.manage');
select private.register_operator_rpc_contract('public.admin_get_good_media(text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_good_media(text,jsonb,bigint,uuid)'::regprocedure,'catalog.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_get_goods_media_settings()'::regprocedure,'store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_media_settings(jsonb,bigint,uuid)'::regprocedure,'store.manage','manual',false);
select private.register_operator_rpc_contract('public.service_claim_goods_media_cleanup(integer)'::regprocedure,'catalog.manage','service_finish',false);
select private.register_operator_rpc_contract('public.service_complete_goods_media_cleanup(uuid,text)'::regprocedure,'catalog.manage','service_finish',false);
select private.register_operator_internal_contract('private.goods_media_metadata_valid(jsonb,integer)'::regprocedure);
select private.register_operator_internal_contract('private.goods_media_asset_json(uuid,text)'::regprocedure);
select private.register_operator_internal_contract('private.good_media_snapshot(text)'::regprocedure);
select private.register_operator_internal_contract('private.retire_deleted_good_media()'::regprocedure);
select private.register_operator_internal_contract('public.get_good_media(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_media_settings()'::regprocedure);
notify pgrst,'reload schema';
