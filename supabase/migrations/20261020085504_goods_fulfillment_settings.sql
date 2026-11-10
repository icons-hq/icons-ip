-- Product contract: checkout methods, explicit prepaid charges,
-- and immutable private download assets share a product contract revision.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('goods-digital-private','goods-digital-private',false,52428800,array['application/pdf','application/zip','image/png','image/jpeg','audio/mpeg','video/mp4','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table private.goods_digital_assets(
 id uuid primary key,actor_id uuid references public.profiles(id) on delete set null,session_id uuid not null,
 filename text not null check(char_length(filename) between 1 and 160 and filename!~'[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in('application/pdf','application/zip','image/png','image/jpeg','audio/mpeg','video/mp4','text/plain')),
 path text not null unique,size_bytes integer not null check(size_bytes between 1 and 52428800),sha256 text check(sha256~'^[0-9a-f]{64}$'),
 state text not null default 'pending' check(state in('pending','verified','retired','cleaned')),
 expires_at timestamptz not null,verified_at timestamptz,cleanup_claimed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 check(state<>'verified' or sha256 is not null and verified_at is not null),
 check(path~'^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|zip|png|jpg|mp3|mp4|txt)$')
);
create index digital_asset_actor_pending on private.goods_digital_assets(actor_id,state,expires_at);
alter table private.goods_digital_assets enable row level security;
revoke all on private.goods_digital_assets from public,anon,authenticated,service_role;
create table private.goods_fulfillment_settings(
 good_id text primary key references public.goods(id) on update cascade on delete cascade,
 revision bigint not null check(revision>0),mode text not null check(mode in('shipping','no_delivery','digital')),
 methods jsonb not null check(jsonb_typeof(methods)='array'),asset_ids uuid[] not null default '{}',
 public_note text not null default '',evidence text not null,updated_at timestamptz not null default clock_timestamp(),
 check(cardinality(asset_ids)<=10),check(mode='digital' or cardinality(asset_ids)=0)
);
alter table private.goods_fulfillment_settings enable row level security;
revoke all on private.goods_fulfillment_settings from public,anon,authenticated,service_role;
alter table public.order_items add column fulfillment_terms_snapshot jsonb;
create table private.order_digital_downloads(
 id uuid primary key,order_id uuid not null references public.orders(id) on delete cascade,
 order_item_id uuid not null references public.order_items(id) on delete cascade,
 asset_id uuid not null references private.goods_digital_assets(id),actor_id uuid,session_id uuid,
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'),created_at timestamptz not null default clock_timestamp()
);
create index order_digital_downloads_item on private.order_digital_downloads(order_item_id,created_at);
alter table private.order_digital_downloads enable row level security;
revoke all on private.order_digital_downloads from public,anon,authenticated,service_role;

create function private.digital_file_metadata(p_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.filename,'mimeType',a.mime_type,'size',a.size_bytes) order by v.n),'[]')
 from unnest(p_ids) with ordinality v(id,n) join private.goods_digital_assets a on a.id=v.id and a.state='verified';
$$;
create function private.goods_fulfillment_document(p_good text,p_internal boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goodId',g.id,'revision',coalesce(s.revision,0),'mode',coalesce(s.mode,'shipping'),
  'methods',coalesce(s.methods,'[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}]'),
  'files',private.digital_file_metadata(coalesce(s.asset_ids,'{}')),'publicNote',coalesce(s.public_note,''))
  ||case when p_internal then jsonb_build_object('evidence',coalesce(s.evidence,''),'updatedAt',coalesce(s.updated_at,g.updated_at)) else '{}'::jsonb end
 from public.goods g left join private.goods_fulfillment_settings s on s.good_id=g.id where g.id=p_good;
$$;
create function public.admin_get_goods_fulfillment(p_good text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('catalog.manage',false);return private.goods_fulfillment_document(p_good,true);end $$;
create function public.admin_save_goods_fulfillment(p_good text,p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old private.goods_fulfillment_settings;prior public.audit_log;request jsonb;result jsonb;method jsonb;asset_ids uuid[];good public.goods;begin
 perform private.production_identity(p_actor,p_session,null,'catalog.manage');
 if p_revision is null or p_revision<0 or p_operation is null or not private.transaction_json_keys(p_values,array['mode','methods','assetIds','publicNote','evidence','confirmed'])
  or coalesce(p_values->>'mode','') not in('shipping','no_delivery','digital') or p_values->'confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(p_values->'methods') is distinct from 'array' or jsonb_array_length(p_values->'methods') not between 1 and 5
  or jsonb_typeof(p_values->'assetIds') is distinct from 'array' or jsonb_array_length(p_values->'assetIds')>10
  or jsonb_typeof(p_values->'publicNote') is distinct from 'string' or char_length(p_values->>'publicNote')>1000
  or jsonb_typeof(p_values->'evidence') is distinct from 'string' or char_length(btrim(p_values->>'evidence')) not between 2 and 1000
  or ((p_values->>'publicNote')||(p_values->>'evidence'))~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 if (select count(distinct value->>'method') from jsonb_array_elements(p_values->'methods'))<>jsonb_array_length(p_values->'methods') then raise invalid_parameter_value;end if;
 for method in select value from jsonb_array_elements(p_values->'methods') loop
  if not private.transaction_json_keys(method,array['method','feeAmount','feeBasis','installationFee'])
   or coalesce(method->>'method','') not in('parcel','quick','pickup','direct','freight','none','digital')
   or coalesce(method->>'feeBasis','') not in('per_order','per_item')
   or jsonb_typeof(method->'installationFee') is distinct from 'number' or method->>'installationFee'!~'^(0|[1-9][0-9]*)$' or (method->>'installationFee')::numeric>1000000
   or (method->>'method'='parcel') is distinct from (method->'feeAmount'='null'::jsonb)
   or method->>'method'<>'parcel' and (jsonb_typeof(method->'feeAmount') is distinct from 'number' or method->>'feeAmount'!~'^(0|[1-9][0-9]*)$' or (method->>'feeAmount')::numeric>1000000)
   or method->>'method' in('pickup','none','digital') and (method->'feeAmount'<>'0'::jsonb or method->'installationFee'<>'0'::jsonb)
   or method->>'method'='parcel' and method->>'feeBasis'<>'per_order'
   or p_values->>'mode'='shipping' and method->>'method' not in('parcel','quick','pickup','direct','freight')
   or p_values->>'mode'='no_delivery' and method->>'method'<>'none'
   or p_values->>'mode'='digital' and method->>'method'<>'digital' then raise invalid_parameter_value;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_values->'assetIds') a where jsonb_typeof(a)<>'string' or a#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise invalid_parameter_value;end if;
 select coalesce(array_agg((a#>>'{}')::uuid),'{}') into asset_ids from jsonb_array_elements(p_values->'assetIds') a;
 if cardinality(asset_ids)<>(select count(distinct a) from unnest(asset_ids)a) or (p_values->>'mode'='digital') is distinct from (cardinality(asset_ids)>0) then raise invalid_parameter_value;end if;
 select * into good from public.goods where id=p_good and archived_at is null for update;if not found then raise no_data_found;end if;
 select * into old from private.goods_fulfillment_settings where good_id=p_good for update;
 request:=jsonb_build_object('goodId',p_good,'values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then if prior.actor_id is distinct from p_actor or prior.action<>'goods.fulfillment.settings' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;return prior.diff->'result';end if;
 if coalesce(old.revision,0)<>p_revision then raise sqlstate 'PT409' using message='fulfillment_changed';end if;
 perform private.assert_goods_transaction_runtime();
 if p_values->>'mode'='digital' and (exists(select 1 from private.goods_production_settings where good_id=p_good and enabled)
  or exists(select 1 from public.goods_variants where good_id=p_good and preorder_policy_id is not null and archived_at is null)) then raise check_violation using message='digital_supply_conflict';end if;
 -- Files are immutable after verification; replacing a product's selection does
 -- not replace files purchased under an earlier order contract.
 perform id from private.goods_digital_assets where id=any(asset_ids) order by id for share;
 if (select count(*) from private.goods_digital_assets where id=any(asset_ids) and state='verified')<>cardinality(asset_ids) then raise check_violation using message='digital_asset_unavailable';end if;
 insert into private.goods_fulfillment_settings(good_id,revision,mode,methods,asset_ids,public_note,evidence)
 values(p_good,p_revision+1,p_values->>'mode',p_values->'methods',asset_ids,btrim(p_values->>'publicNote'),btrim(p_values->>'evidence'))
 on conflict(good_id) do update set revision=excluded.revision,mode=excluded.mode,methods=excluded.methods,asset_ids=excluded.asset_ids,
 public_note=excluded.public_note,evidence=excluded.evidence,updated_at=clock_timestamp();
 result:=private.goods_fulfillment_document(p_good,true);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'goods.fulfillment.settings','good:'||p_good,jsonb_build_object('request',request,'result',result));return result;
end $$;
create function private.digital_operator_session(p_actor uuid,p_session uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform private.require_actor_operator_capability(p_actor,'catalog.manage');
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;
end $$;
create function public.service_prepare_digital_asset(p_actor uuid,p_session uuid,p_id uuid,p_name text,p_mime text,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare asset private.goods_digital_assets;extension text;begin
 perform private.digital_operator_session(p_actor,p_session);
 extension:=case p_mime when 'application/pdf' then 'pdf' when 'application/zip' then 'zip' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'audio/mpeg' then 'mp3' when 'video/mp4' then 'mp4' when 'text/plain' then 'txt' end;
 if p_id is null or p_size is null or p_size not between 1 and 52428800 or extension is null or p_name is null or char_length(btrim(p_name)) not between 1 and 160 or p_name~'[[:cntrl:]/\\]' then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('digital-upload:'||p_actor::text,0));
 select * into asset from private.goods_digital_assets where id=p_id for update;
 if found then
  if asset.actor_id is distinct from p_actor or asset.session_id<>p_session or asset.filename<>btrim(p_name) or asset.mime_type<>p_mime or asset.size_bytes<>p_size then raise sqlstate 'PT409';end if;
  if asset.state not in('pending','verified') or asset.state='pending' and asset.expires_at<=clock_timestamp() then raise check_violation using message='digital_upload_expired';end if;
 else
  if (select count(*) from private.goods_digital_assets where actor_id=p_actor and created_at>clock_timestamp()-interval '1 minute')>=10
   or (select count(*) from private.goods_digital_assets where actor_id=p_actor and state='pending' and expires_at>clock_timestamp())>=10 then raise check_violation using message='digital_upload_budget';end if;
  insert into private.goods_digital_assets(id,actor_id,session_id,filename,mime_type,size_bytes,path,expires_at)
   values(p_id,p_actor,p_session,btrim(p_name),p_mime,p_size,p_actor::text||'/'||p_id::text||'.'||extension,clock_timestamp()+interval '30 minutes') returning * into asset;
 end if;
 return jsonb_build_object('id',asset.id,'path',asset.path,'state',asset.state,'name',asset.filename,'mimeType',asset.mime_type,'size',asset.size_bytes,'sha256',asset.sha256);
end $$;
create function public.can_upload_digital_asset(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_operator_capability(auth.uid(),'catalog.manage',false) and not private.is_account_write_fenced(auth.uid()) and exists(
  select 1 from private.goods_digital_assets a join auth.sessions s on s.id=a.session_id and s.user_id=a.actor_id
  where a.actor_id=auth.uid() and a.session_id::text=auth.jwt()->>'session_id' and a.path=p_path and a.state='pending' and a.expires_at>clock_timestamp()
   and(s.not_after is null or s.not_after>clock_timestamp()));
$$;
create policy goods_digital_private_insert on storage.objects for insert to authenticated with check(bucket_id='goods-digital-private' and public.can_upload_digital_asset(name));
-- No SELECT, UPDATE, or DELETE policies: application download endpoints check
-- current order access for every request and never issue public/signed URLs.
create function public.service_verify_digital_asset(p_actor uuid,p_session uuid,p_id uuid,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$declare asset private.goods_digital_assets;begin
 perform private.digital_operator_session(p_actor,p_session);
 select * into asset from private.goods_digital_assets where id=p_id and actor_id=p_actor and session_id=p_session for update;
 if not found or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' then raise insufficient_privilege;end if;
 if asset.state='verified' then if asset.sha256<>p_sha256 then raise sqlstate 'PT409';end if;
 elsif asset.state='pending' and asset.expires_at>clock_timestamp() and exists(select 1 from storage.objects o where o.bucket_id='goods-digital-private' and o.name=asset.path
  and o.metadata->>'mimetype'=asset.mime_type and o.metadata->>'size'=asset.size_bytes::text) then
  update private.goods_digital_assets set state='verified',sha256=p_sha256,verified_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours' where id=p_id;
 else raise check_violation using message='digital_upload_unverified';end if;
 return private.digital_file_metadata(array[p_id])->0;
end $$;
create function private.digital_asset_referenced(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.goods_fulfillment_settings where p_id=any(asset_ids))
 or exists(select 1 from public.order_items where fulfillment_terms_snapshot->'files' @> jsonb_build_array(jsonb_build_object('id',p_id)))
 or exists(select 1 from private.order_digital_downloads where asset_id=p_id);
$$;
create function public.service_retire_digital_asset(p_actor uuid,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 -- Cancellation remains possible after privilege revocation, but only for the
 -- original uploader's unattached file.
 if p_actor is null then return false;end if;
 perform 1 from private.goods_digital_assets where id=p_id for update;
 if private.digital_asset_referenced(p_id) then return false;end if;
 update private.goods_digital_assets set state='retired',expires_at=clock_timestamp() where id=p_id and actor_id=p_actor and state in('pending','verified','retired');return found;
end $$;
create function public.service_claim_digital_cleanup(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if p_limit not between 1 and 50 then raise invalid_parameter_value;end if;
 with candidates as(select id from private.goods_digital_assets where state in('pending','verified','retired') and expires_at<=clock_timestamp()
  and(cleanup_claimed_at is null or cleanup_claimed_at<clock_timestamp()-interval '10 minutes') and not private.digital_asset_referenced(id)
  order by expires_at,id for update skip locked limit p_limit), claimed as(
 update private.goods_digital_assets a set state='retired',cleanup_claimed_at=clock_timestamp() from candidates c where a.id=c.id returning a.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',path)),'[]') into result from claimed;return result;
end $$;
create function public.service_complete_digital_cleanup(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from private.goods_digital_assets where id=p_id for update;
 if private.digital_asset_referenced(p_id) then raise check_violation using message='digital_asset_in_use';end if;
 update private.goods_digital_assets set state='cleaned' where id=p_id and state='retired';
end $$;
revoke all on function private.digital_file_metadata(uuid[]),private.goods_fulfillment_document(text,boolean),private.digital_operator_session(uuid,uuid),private.digital_asset_referenced(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_get_goods_fulfillment(text),public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid),public.can_upload_digital_asset(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_fulfillment(text),public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid),public.can_upload_digital_asset(text) to authenticated;
revoke all on function public.service_prepare_digital_asset(uuid,uuid,uuid,text,text,integer),public.service_verify_digital_asset(uuid,uuid,uuid,text),public.service_retire_digital_asset(uuid,uuid),public.service_claim_digital_cleanup(integer),public.service_complete_digital_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_prepare_digital_asset(uuid,uuid,uuid,text,text,integer),public.service_verify_digital_asset(uuid,uuid,uuid,text),public.service_retire_digital_asset(uuid,uuid),public.service_claim_digital_cleanup(integer),public.service_complete_digital_cleanup(uuid) to service_role;
select private.register_operator_internal_contract('private.digital_file_metadata(uuid[])'::regprocedure);
select private.register_operator_internal_contract('private.goods_fulfillment_document(text,boolean)'::regprocedure);
select private.register_operator_internal_contract('private.digital_operator_session(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.digital_asset_referenced(uuid)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_get_goods_fulfillment(text)'::regprocedure,'catalog.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_internal_contract('public.can_upload_digital_asset(text)'::regprocedure);
select private.register_operator_internal_contract('public.service_prepare_digital_asset(uuid,uuid,uuid,text,text,integer)'::regprocedure);
select private.register_operator_internal_contract('public.service_verify_digital_asset(uuid,uuid,uuid,text)'::regprocedure);
select private.register_operator_internal_contract('public.service_retire_digital_asset(uuid,uuid)'::regprocedure);
select private.register_operator_internal_contract('public.service_claim_digital_cleanup(integer)'::regprocedure);
select private.register_operator_internal_contract('public.service_complete_digital_cleanup(uuid)'::regprocedure);
create function public.service_read_digital_asset(p_actor uuid,p_session uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a private.goods_digital_assets;begin
 perform private.digital_operator_session(p_actor,p_session);
 select * into a from private.goods_digital_assets where id=p_id and actor_id=p_actor and session_id=p_session and state in('pending','verified') and(state='verified' or expires_at>clock_timestamp());
 if not found then raise no_data_found;end if;
 return jsonb_build_object('id',a.id,'path',a.path,'state',a.state,'name',a.filename,'mimeType',a.mime_type,'size',a.size_bytes,'sha256',a.sha256);
end $$;
revoke all on function public.service_read_digital_asset(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_read_digital_asset(uuid,uuid,uuid) to service_role;
select private.register_operator_internal_contract('public.service_read_digital_asset(uuid,uuid,uuid)'::regprocedure);
notify pgrst,'reload schema';
commit;
