-- Gift source and delivery ownership; no raw recipient address enters public rows.
begin;
create table private.gift_runtime (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 privacy_ready boolean not null default false
);
insert into private.gift_runtime(singleton) values(true);
create table private.gift_intents (
 id uuid primary key,sender_id uuid not null references public.profiles(id) on delete restrict,
 recipient_id uuid references public.profiles(id) on delete restrict,
 state text not null default 'awaiting_acceptance' check(state in('awaiting_acceptance','accepted','ordered','declined','expired','canceled')),
 revision bigint not null default 1 check(revision>0),message text not null default '' check(char_length(message)<=300 and message!~'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 sender_label text not null,recipient_label text,expires_at timestamptz not null,
 accepted_at timestamptz,closed_at timestamptz,order_id uuid unique references public.orders(id) on delete restrict,
 ordered_source_revision text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((order_id is null)=(ordered_source_revision is null)),check(state<>'ordered' or order_id is not null),
 check(state not in('accepted','ordered') or recipient_id is not null)
);
create index gift_intents_sender on private.gift_intents(sender_id,created_at desc,id);
create index gift_intents_recipient on private.gift_intents(recipient_id,created_at desc,id);
create table private.gift_items (
 gift_id uuid not null references private.gift_intents(id) on delete cascade,position integer not null check(position between 0 and 99),
 good_id text not null,variant_id uuid not null,qty integer not null check(qty>0),input_revision bigint not null check(input_revision>=0),
 input_values jsonb not null,item_display jsonb not null,
 primary key(gift_id,position),foreign key(variant_id,good_id) references public.goods_variants(id,good_id) on update cascade on delete restrict
);
create table private.gift_recipient_addresses (
 gift_id uuid primary key references private.gift_intents(id) on delete cascade,recipient_id uuid not null references public.profiles(id) on delete restrict,
 revision bigint not null default 1 check(revision>0),address jsonb not null,updated_at timestamptz not null default clock_timestamp()
);
create table private.gift_link_tokens (
 token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),gift_id uuid not null references private.gift_intents(id) on delete cascade,
 generation bigint not null check(generation>0),expires_at timestamptz not null,revoked_at timestamptz,consumed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),unique(gift_id,generation)
);
create table private.gift_claim_sessions (
 session_hash text primary key check(session_hash~'^[a-f0-9]{64}$'),token_hash text not null references private.gift_link_tokens(token_hash) on delete cascade,
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create index gift_claim_sessions_token on private.gift_claim_sessions(token_hash,expires_at);
create table private.gift_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id) on delete restrict,gift_id uuid not null references private.gift_intents(id) on delete restrict,
 kind text not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),revision bigint not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.order_delivery_private_snapshots (
 order_id uuid primary key references public.orders(id) on delete restrict,gift_id uuid not null unique references private.gift_intents(id) on delete restrict,
 recipient_id uuid not null references public.profiles(id) on delete restrict,address jsonb not null,address_revision integer not null default 0,
 gift_address_revision bigint not null,source_revision text not null,shipping_evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create function private.gift_require_actor(p_actor uuid,p_new_write boolean default true) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor) then raise insufficient_privilege using message='gift_auth_required';end if;
 if p_new_write and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor
  and p.suspended_at is null and not private.is_account_write_fenced(p.id) and p.onboarded_at is not null
  and nullif(btrim(coalesce(p.email,u.email)),'') is not null and nullif(btrim(p.nickname),'') is not null
  and p.birth_date is not null and p.birth_date<=current_date and p.consents->>'terms'='true' and p.consents->>'privacy'='true') then
  raise insufficient_privilege using message='gift_account_unavailable';end if;
end $$;
create function private.gift_require_runtime() returns void language plpgsql volatile security definer set search_path='' as $$begin
 perform singleton from private.gift_runtime where singleton and enabled and privacy_ready for share;
 if not found then
  raise object_not_in_prerequisite_state using message='gift_not_available';end if;
end $$;
create function private.gift_source(p_gift private.gift_intents) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('kind','gift','id',p_gift.id,'revision',coalesce(p_gift.ordered_source_revision,p_gift.revision::text||':'||
  encode(extensions.digest(coalesce((select jsonb_agg(jsonb_build_array(i.good_id,i.variant_id) order by i.position)::text from private.gift_items i where i.gift_id=p_gift.id),'[]'),'sha256'),'hex')));
$$;
create function private.gift_lock_subjects(p_actors uuid[]) returns void
language plpgsql volatile security definer set search_path='' as $$declare subject uuid;begin
 -- Match the common transaction actor lock before account-action/profile locks.
 -- All participants are known before taking any source or domain row lock.
 for subject in select distinct id from unnest(p_actors) ids(id) where id is not null order by id loop
  perform pg_advisory_xact_lock(hashtextextended(subject::text,0));
 end loop;
 for subject in select distinct id from unnest(p_actors) ids(id) where id is not null order by id loop
  perform private.lock_account_action_subject(subject);
 end loop;
 perform 1 from public.profiles where id=any(p_actors) order by id for share;
end $$;
create function private.gift_lock(p_id uuid,p_extra_actor uuid default null) returns private.gift_intents
language plpgsql volatile security definer set search_path='' as $$
declare gift private.gift_intents;previous_recipient uuid;begin
 select * into gift from private.gift_intents where id=p_id;
 if not found then raise no_data_found using message='gift_not_found';end if;
 previous_recipient:=gift.recipient_id;
 perform private.gift_lock_subjects(array[gift.sender_id,gift.recipient_id,p_extra_actor]);
 perform private.lock_goods_transaction_source(gift.sender_id,private.gift_source(gift));
 select * into gift from private.gift_intents where id=p_id for update;
 -- Never acquire a newly bound recipient lock after the source lock. The caller
 -- reloads and retries with the current complete participant set instead.
 if gift.recipient_id is distinct from previous_recipient then raise sqlstate 'PT409' using message='gift_changed';end if;
 return gift;
end $$;
create function private.gift_operation_replay(p_actor uuid,p_gift_id uuid,p_kind text,p_request jsonb,p_operation_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$declare receipt private.gift_operations;begin
 if p_operation_id is null then raise invalid_parameter_value using message='gift_operation_required';end if;
 perform pg_advisory_xact_lock(hashtextextended('gift-operation:'||p_operation_id::text,0));
 select * into receipt from private.gift_operations where id=p_operation_id;
 if not found then return false;end if;
 if receipt.actor_id is distinct from p_actor or receipt.gift_id<>p_gift_id or receipt.kind<>p_kind
  or receipt.request_hash<>encode(extensions.digest(p_request::text,'sha256'),'hex') then raise unique_violation using message='gift_operation_conflict';end if;
 return true;
end $$;
create function private.gift_record_operation(p_actor uuid,p_gift_id uuid,p_kind text,p_request jsonb,p_operation_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$declare gift private.gift_intents;begin
 select * into gift from private.gift_intents where id=p_gift_id;
 insert into private.gift_operations(id,actor_id,gift_id,kind,request_hash,revision)
 values(p_operation_id,p_actor,p_gift_id,p_kind,encode(extensions.digest(p_request::text,'sha256'),'hex'),gift.revision);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,p_actor,'gift.'||p_kind,'gift:'||p_gift_id,
  jsonb_build_object('giftId',p_gift_id,'state',gift.state,'revision',gift.revision));
end $$;
create function private.gift_selection(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('goodId',i.good_id,'variantId',i.variant_id,'qty',i.qty,'inputRevision',i.input_revision,'inputValues',i.input_values) order by i.position),'[]')
 from private.gift_items i where i.gift_id=p_id;
$$;
create function private.gift_selection_display(p_selection jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item jsonb;good public.goods;variant public.goods_variants;custom jsonb;result jsonb:='[]';begin
 if jsonb_typeof(p_selection) is distinct from 'array' or jsonb_array_length(p_selection) not between 1 and 100 or octet_length(p_selection::text)>100000 then
  raise invalid_parameter_value using message='gift_selection_invalid';end if;
 if (select count(distinct jsonb_build_array(e->'goodId',e->'variantId',e->'inputRevision',e->'inputValues')) from jsonb_array_elements(p_selection)e)<>jsonb_array_length(p_selection) then
  raise invalid_parameter_value using message='gift_selection_duplicate';end if;
 for item in select e from jsonb_array_elements(p_selection)e loop
  if not private.transaction_json_keys(item,array['goodId','variantId','qty','inputRevision','inputValues'])
   or jsonb_typeof(item->'goodId') is distinct from 'string' or char_length(item->>'goodId') not between 1 and 200
   or jsonb_typeof(item->'variantId') is distinct from 'string' or item->>'variantId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or not private.transaction_uint(item->'qty',1,2147483647) or not private.transaction_uint(item->'inputRevision',0,2147483647)
   or jsonb_typeof(item->'inputValues') is distinct from 'object' or (select count(*) from jsonb_object_keys(item->'inputValues'))>5
   or exists(select 1 from jsonb_each(item->'inputValues')e where e.key!~'^[0-9a-f-]{36}$' or jsonb_typeof(e.value)<>'string' or char_length(e.value#>>'{}')>100) then
   raise invalid_parameter_value using message='gift_selection_invalid';end if;
  select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=item->>'goodId' and g.archived_at is null and g.published_at is not null
   and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null;
  if not found then raise no_data_found using message='gift_good_unavailable';end if;
  select * into variant from public.goods_variants where id=(item->>'variantId')::uuid and good_id=good.id and archived_at is null;
  if not found then raise no_data_found using message='gift_variant_unavailable';end if;
  custom:=private.resolve_goods_custom_inputs(good.id,(item->>'inputRevision')::integer,item->'inputValues');
  result:=result||jsonb_build_array(jsonb_build_object('goodId',good.id,'variantId',variant.id,'name',good.name,'variantName',variant.name,
   'qty',(item->>'qty')::integer,'imagePath',good.image_path,'customInputs',custom));
 end loop;return result;
end $$;
create function private.gift_item_identity_changed() returns trigger language plpgsql volatile security definer set search_path='' as $$begin
 if tg_op='UPDATE' and (to_jsonb(new)-'good_id')=(to_jsonb(old)-'good_id') then
  -- Identity-only FK cascades change the private source fingerprint without
  -- taking a gift row lock behind the catalog writer's goods lock.
  return new;
 end if;raise check_violation using message='gift_selection_immutable';
end $$;
create trigger gift_item_identity before update on private.gift_items for each row execute function private.gift_item_identity_changed();
create function private.gift_detail(p_actor uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare gift private.gift_intents;address private.gift_recipient_addresses;purchase public.orders;party text;effective_state text;delivery jsonb;begin
 select * into gift from private.gift_intents where id=p_id and (sender_id=p_actor or recipient_id=p_actor);
 if not found or p_actor is null then return null;end if;
 party:=case when gift.sender_id=p_actor then 'sender' else 'recipient' end;
 effective_state:=case when gift.order_id is null and gift.state in('awaiting_acceptance','accepted') and gift.expires_at<=statement_timestamp() then 'expired' else gift.state end;
 select * into address from private.gift_recipient_addresses where gift_id=gift.id;
 select * into purchase from public.orders where id=gift.order_id;
 if purchase.id is not null then select jsonb_build_object('address',d.address,'addressRevision',d.address_revision) into delivery from private.order_delivery_private_snapshots d where d.order_id=purchase.id;end if;
 return jsonb_build_object('id',gift.id,'party',party,'isRecipient',coalesce(gift.recipient_id=p_actor,false),'state',effective_state,'revision',gift.revision,'message',gift.message,'senderLabel',gift.sender_label,
  'recipientLabel',gift.recipient_label,'createdAt',gift.created_at,'expiresAt',gift.expires_at,'acceptedAt',gift.accepted_at,
  'items',(select coalesce(jsonb_agg(i.item_display||jsonb_build_object('goodId',i.good_id) order by i.position),'[]') from private.gift_items i where i.gift_id=gift.id),
  'address',case when gift.recipient_id=p_actor then case when purchase.id is not null then delivery->'address' else address.address end else null end,
  'addressRevision',case when gift.recipient_id=p_actor then case when purchase.id is not null then (delivery->>'addressRevision')::bigint else address.revision end else null end,
  'order',case when purchase.id is null then null else jsonb_build_object('id',purchase.id,'status',purchase.status,'createdAt',purchase.created_at,
   'expiresAt',purchase.expires_at,'total',case when party='sender' then purchase.total else null end,
   'paymentMethod',case when party='sender' then purchase.payment_method::text else null end) end,
  'shipments',case when purchase.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'shippedAt',s.shipped_at,'deliveredAt',s.delivered_at,
   'expectedShipDate',s.expected_ship_date,'carrier',case when gift.recipient_id=p_actor then s.carrier else null end,
   'trackingNumber',case when gift.recipient_id=p_actor then s.tracking_number else null end) order by s.created_at,s.id),'[]') from public.order_shipments s where s.order_id=purchase.id) end);
end $$;
create function private.gift_operation_result(p_actor uuid,p_operation_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('receipt',jsonb_build_object('operationId',o.id,'kind',o.kind,'revision',o.revision),
  'gift',private.gift_detail(p_actor,o.gift_id)) from private.gift_operations o where o.id=p_operation_id and o.actor_id=p_actor;
$$;
create function public.get_my_gift(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.gift_detail(auth.uid(),p_id);
$$;
create function public.list_my_gifts(p_party text,p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare actor uuid:=auth.uid();begin
 perform private.gift_require_actor(actor,false);
 if p_party not in('sender','recipient') or (p_before is null)<>(p_before_id is null) then raise invalid_parameter_value using message='gift_list_invalid';end if;
 return (select jsonb_build_object('items',coalesce(jsonb_agg(private.gift_detail(actor,g.id) order by g.created_at desc,g.id desc) filter(where g.row_number<=20),'[]'),'hasMore',count(*)>20)
  from (select i.*,row_number() over(order by i.created_at desc,i.id desc) from private.gift_intents i where (case when p_party='sender' then i.sender_id else i.recipient_id end)=actor
   and (p_before is null or (i.created_at,i.id)<(p_before,p_before_id)) order by i.created_at desc,i.id desc limit 21)g);
end $$;
create function public.get_gift_availability() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and privacy_ready from private.gift_runtime where singleton),false);
$$;
create function public.create_my_gift(p_id uuid,p_selection jsonb,p_message text,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();request jsonb;display jsonb;line jsonb;ordinal bigint;begin
 if actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 if p_id is null or p_message is null or char_length(p_message)>300 or p_message~'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise invalid_parameter_value using message='gift_input_invalid';end if;
 perform private.gift_lock_subjects(array[actor]);
 perform private.lock_goods_transaction_source(actor,jsonb_build_object('kind','gift','id',p_id,'revision','new'));
 request:=jsonb_build_object('selection',p_selection,'message',p_message);
 if private.gift_operation_replay(actor,p_id,'created',request,p_operation_id) then return private.gift_operation_result(actor,p_operation_id);end if;
 perform private.gift_require_actor(actor);perform private.gift_require_runtime();
 if exists(select 1 from private.gift_intents where id=p_id) then raise unique_violation using message='gift_identity_conflict';end if;
 if (select count(*) from private.gift_intents where sender_id=actor and state in('awaiting_acceptance','accepted') and expires_at>clock_timestamp())>=50 then
  raise check_violation using message='gift_open_limit';end if;
 display:=private.gift_selection_display(p_selection);
 insert into private.gift_intents(id,sender_id,message,sender_label,expires_at) values(p_id,actor,p_message,(select nickname from public.profiles where id=actor),clock_timestamp()+interval '7 days');
 for line,ordinal in select value,ordinality from jsonb_array_elements(p_selection) with ordinality as entries(value,ordinality) loop
  insert into private.gift_items(gift_id,position,good_id,variant_id,qty,input_revision,input_values,item_display)
  values(p_id,ordinal-1,line->>'goodId',(line->>'variantId')::uuid,(line->>'qty')::integer,(line->>'inputRevision')::bigint,line->'inputValues',display->(ordinal::integer-1));
 end loop;
 perform private.gift_record_operation(actor,p_id,'created',request,p_operation_id);return private.gift_operation_result(actor,p_operation_id);
end $$;
create function public.issue_my_gift_link(p_id uuid,p_expected_revision bigint,p_token_hash text,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();gift private.gift_intents;request jsonb;generation bigint;begin
 if actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_lock(p_id,actor);
 if gift.sender_id<>actor then raise insufficient_privilege using message='gift_not_found';end if;
 if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$' or p_expected_revision is null then raise invalid_parameter_value using message='gift_link_invalid';end if;
 request:=jsonb_build_object('revision',p_expected_revision,'tokenHash',p_token_hash);
 if private.gift_operation_replay(actor,p_id,'link_issued',request,p_operation_id) then
  if not exists(select 1 from private.gift_link_tokens where token_hash=p_token_hash and revoked_at is null and consumed_at is null and expires_at>clock_timestamp()) then raise check_violation using message='gift_link_closed';end if;
  return private.gift_operation_result(actor,p_operation_id)||jsonb_build_object('generation',(select t.generation from private.gift_link_tokens t where token_hash=p_token_hash));
 end if;
 perform private.gift_require_actor(actor);perform private.gift_require_runtime();
 if gift.revision<>p_expected_revision then raise sqlstate 'PT409' using message='gift_changed';end if;
 if gift.state<>'awaiting_acceptance' or gift.expires_at<=clock_timestamp() then raise check_violation using message='gift_link_closed';end if;
 select coalesce(max(t.generation),0)+1 into generation from private.gift_link_tokens t where gift_id=p_id;
 if generation>100 then raise check_violation using message='gift_link_limit';end if;
 update private.gift_link_tokens set revoked_at=clock_timestamp() where gift_id=p_id and revoked_at is null;
 delete from private.gift_claim_sessions s using private.gift_link_tokens t where s.token_hash=t.token_hash and t.gift_id=p_id;
 insert into private.gift_link_tokens(token_hash,gift_id,generation,expires_at) values(p_token_hash,p_id,generation,gift.expires_at);
 update private.gift_intents set revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 perform private.gift_record_operation(actor,p_id,'link_issued',request,p_operation_id);
 return private.gift_operation_result(actor,p_operation_id)||jsonb_build_object('generation',generation);
end $$;
create function public.service_begin_gift_claim_session(p_token_hash text,p_session_hash text) returns timestamptz
language plpgsql volatile security definer set search_path='' as $$declare token private.gift_link_tokens;gift private.gift_intents;ends timestamptz;begin
 if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$' or p_session_hash is null or p_session_hash!~'^[a-f0-9]{64}$' then return null;end if;
 select * into token from private.gift_link_tokens where token_hash=p_token_hash;
 if not found then return null;end if;
 gift:=private.gift_lock(token.gift_id);select * into token from private.gift_link_tokens where token_hash=p_token_hash for update;
 if gift.state<>'awaiting_acceptance' or token.revoked_at is not null or token.consumed_at is not null or token.expires_at<=clock_timestamp() then return null;end if;
 delete from private.gift_claim_sessions where token_hash=p_token_hash and expires_at<=clock_timestamp();
 if (select count(*) from private.gift_claim_sessions where token_hash=p_token_hash)>=5 then return null;end if;
 ends:=least(token.expires_at,clock_timestamp()+interval '10 minutes');
 insert into private.gift_claim_sessions(session_hash,token_hash,expires_at) values(p_session_hash,p_token_hash,ends);return ends;
end $$;
create function private.gift_session_id(p_session_hash text,p_at timestamptz) returns uuid language sql stable security definer set search_path='' as $$
 select t.gift_id from private.gift_claim_sessions s join private.gift_link_tokens t on t.token_hash=s.token_hash
 where s.session_hash=p_session_hash and s.expires_at>p_at and t.expires_at>p_at and t.revoked_at is null and t.consumed_at is null;
$$;
create function public.read_my_gift_invitation(p_session_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare gift private.gift_intents;actor uuid:=auth.uid();begin
 perform private.gift_require_actor(actor,false);
 select * into gift from private.gift_intents where id=private.gift_session_id(p_session_hash,statement_timestamp()) and state='awaiting_acceptance' and expires_at>statement_timestamp();
 if not found then return null;end if;
 return jsonb_build_object('id',gift.id,'revision',gift.revision,'message',gift.message,'senderLabel',gift.sender_label,'expiresAt',gift.expires_at,
  'items',(select jsonb_agg(i.item_display||jsonb_build_object('goodId',i.good_id) order by i.position) from private.gift_items i where gift_id=gift.id));
end $$;
create function public.respond_to_gift(p_id uuid,p_session_hash text,p_accept boolean,p_address jsonb,p_expected_revision bigint,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();gift private.gift_intents;request jsonb;address jsonb;at_time timestamptz;begin
 if actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_lock(p_id,actor);
 if p_accept is null or p_expected_revision is null then raise invalid_parameter_value using message='gift_response_invalid';end if;
 address:=case when p_accept then private.normalize_order_address_change(p_address) else null end;
 if not p_accept and p_address is not null then raise invalid_parameter_value using message='gift_response_invalid';end if;
 request:=jsonb_build_object('sessionHash',p_session_hash,'accept',p_accept,'address',address,'revision',p_expected_revision);
 if private.gift_operation_replay(actor,p_id,'responded',request,p_operation_id) then return private.gift_operation_result(actor,p_operation_id);end if;
 perform private.gift_require_actor(actor);perform private.gift_require_runtime();
 at_time:=clock_timestamp();
 if private.gift_session_id(p_session_hash,at_time) is distinct from p_id then raise insufficient_privilege using message='gift_invitation_unavailable';end if;
 if gift.revision<>p_expected_revision then raise sqlstate 'PT409' using message='gift_changed';end if;
 if gift.state<>'awaiting_acceptance' or gift.expires_at<=at_time then raise check_violation using message='gift_response_closed';end if;
 perform private.gift_require_actor(gift.sender_id);
 if p_accept then
  perform private.gift_selection_display(private.gift_selection(p_id));
  insert into private.gift_recipient_addresses(gift_id,recipient_id,address) values(p_id,actor,address);
 end if;
 update private.gift_intents set recipient_id=actor,recipient_label=(select nickname from public.profiles where id=actor),state=case when p_accept then 'accepted' else 'declined' end,
  accepted_at=case when p_accept then clock_timestamp() end,closed_at=case when not p_accept then clock_timestamp() end,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 update private.gift_link_tokens set consumed_at=clock_timestamp() where gift_id=p_id and revoked_at is null;
 perform private.gift_record_operation(actor,p_id,'responded',request,p_operation_id);return private.gift_operation_result(actor,p_operation_id);
end $$;
create function public.update_my_gift_address(p_id uuid,p_address jsonb,p_expected_revision bigint,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();gift private.gift_intents;address_value jsonb;request jsonb;begin
 if actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_lock(p_id,actor);perform private.gift_require_actor(actor,false);
 if gift.recipient_id is distinct from actor then raise insufficient_privilege using message='gift_not_found';end if;
 address_value:=private.normalize_order_address_change(p_address);request:=jsonb_build_object('address',address_value,'revision',p_expected_revision);
 if private.gift_operation_replay(actor,p_id,'address_changed',request,p_operation_id) then return private.gift_operation_result(actor,p_operation_id);end if;
 if p_expected_revision is null or gift.revision<>p_expected_revision then raise sqlstate 'PT409' using message='gift_changed';end if;
 if gift.state<>'accepted' or gift.order_id is not null or gift.expires_at<=clock_timestamp() then raise check_violation using message='gift_address_closed';end if;
 delete from private.goods_transaction_quotes where actor_id=gift.sender_id and source->>'kind'='gift' and source->>'id'=gift.id::text and order_id is null;
 update private.gift_recipient_addresses set address=address_value,revision=revision+1,updated_at=clock_timestamp() where gift_id=p_id;
 update private.gift_intents set revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 perform private.gift_record_operation(actor,p_id,'address_changed',request,p_operation_id);return private.gift_operation_result(actor,p_operation_id);
end $$;
create function public.close_my_gift(p_id uuid,p_expected_revision bigint,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();gift private.gift_intents;request jsonb;begin
 if actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_lock(p_id,actor);perform private.gift_require_actor(actor,false);
 if gift.sender_id<>actor and gift.recipient_id is distinct from actor then raise insufficient_privilege using message='gift_not_found';end if;
 request:=jsonb_build_object('revision',p_expected_revision);
 if private.gift_operation_replay(actor,p_id,'closed',request,p_operation_id) then return private.gift_operation_result(actor,p_operation_id);end if;
 if p_expected_revision is null or gift.revision<>p_expected_revision then raise sqlstate 'PT409' using message='gift_changed';end if;
 if gift.state not in('awaiting_acceptance','accepted') or gift.order_id is not null then raise check_violation using message='gift_close_unavailable';end if;
 update private.gift_intents set state='canceled',closed_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 update private.gift_link_tokens set revoked_at=clock_timestamp() where gift_id=p_id and revoked_at is null;
 delete from private.gift_claim_sessions s using private.gift_link_tokens t where s.token_hash=t.token_hash and t.gift_id=p_id;
 delete from private.goods_transaction_quotes where actor_id=gift.sender_id and source->>'kind'='gift' and source->>'id'=gift.id::text and order_id is null;
 delete from private.gift_recipient_addresses where gift_id=p_id;
 perform private.gift_record_operation(actor,p_id,'closed',request,p_operation_id);return private.gift_operation_result(actor,p_operation_id);
end $$;
create function public.service_expire_gifts(p_limit integer default 100) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare candidate record;gift private.gift_intents;changed integer:=0;begin
 for candidate in select id from private.gift_intents where order_id is null and state in('awaiting_acceptance','accepted') and expires_at<=clock_timestamp()
  order by sender_id,id limit greatest(1,least(coalesce(p_limit,100),100)) loop
  begin gift:=private.gift_lock(candidate.id);exception when sqlstate 'PT409' then continue;end;
  if gift.order_id is not null or gift.state not in('awaiting_acceptance','accepted') or gift.expires_at>clock_timestamp() then continue;end if;
  update private.gift_intents set state='expired',closed_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=gift.id;
  update private.gift_link_tokens set revoked_at=clock_timestamp() where gift_id=gift.id and revoked_at is null;
  delete from private.goods_transaction_quotes where actor_id=gift.sender_id and source->>'kind'='gift' and source->>'id'=gift.id::text and order_id is null;
  delete from private.gift_recipient_addresses where gift_id=gift.id;changed:=changed+1;
 end loop;
 delete from private.gift_claim_sessions s where s.expires_at<=clock_timestamp() or exists(select 1 from private.gift_link_tokens t where t.token_hash=s.token_hash and (t.revoked_at is not null or t.consumed_at is not null));
 return jsonb_build_object('expired',changed);
end $$;
create function private.order_delivery_snapshot(p_order_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when d.order_id is not null then jsonb_build_object('address',d.address,'addressRevision',d.address_revision,'shippingEvidence',d.shipping_evidence)
  else jsonb_build_object('address',o.address,'addressRevision',o.address_revision,'shippingEvidence',o.shipping_fee_breakdown) end
 from public.orders o left join private.order_delivery_private_snapshots d on d.order_id=o.id where o.id=p_order_id;
$$;
create function private.bind_goods_transaction_delivery_snapshot(p_order_id uuid,p_actor uuid,p_source jsonb,p_address jsonb,p_shipping_snapshot jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$declare gift private.gift_intents;destination private.gift_recipient_addresses;purchase public.orders;begin
 if p_source->>'kind'<>'gift' then return;end if;
 gift:=private.gift_lock((p_source->>'id')::uuid);
 if gift.sender_id is distinct from p_actor or private.gift_source(gift)<>p_source or gift.state<>'accepted' or gift.order_id is not null or gift.expires_at<=clock_timestamp() then
  raise check_violation using message='gift_source_changed';end if;
 select * into destination from private.gift_recipient_addresses where gift_id=gift.id for update;
 if not found or destination.recipient_id is distinct from gift.recipient_id or destination.address is distinct from p_address then
  raise check_violation using message='gift_address_changed';end if;
 select * into purchase from public.orders where id=p_order_id;
 if not found or purchase.user_id is distinct from p_actor or purchase.address is not null then raise check_violation using message='gift_public_address_forbidden';end if;
 if jsonb_typeof(p_shipping_snapshot) is distinct from 'array' then raise check_violation using message='gift_shipping_evidence_invalid';end if;
 insert into private.order_delivery_private_snapshots(order_id,gift_id,recipient_id,address,gift_address_revision,source_revision,shipping_evidence)
 values(p_order_id,gift.id,gift.recipient_id,p_address,destination.revision,p_source->>'revision',p_shipping_snapshot);
 delete from private.gift_recipient_addresses where gift_id=gift.id;
 update private.gift_intents set state='ordered',order_id=p_order_id,ordered_source_revision=p_source->>'revision',revision=revision+1,updated_at=clock_timestamp() where id=gift.id;
end $$;

-- A customer must use the safe party DTO for gifts. Existing non-gift RLS stays
-- unchanged; the restrictive policy also closes future permissive additions.
create function private.gift_direct_order_read_allowed(p_order_id uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=p_order_id and (private.has_operator_capability(p_actor,'sales.read',false)
  or (o.user_id=p_actor and not exists(select 1 from private.order_delivery_private_snapshots d where d.order_id=o.id))));
$$;
create function public.gift_direct_order_read_allowed(p_order_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.gift_direct_order_read_allowed(p_order_id,auth.uid());
$$;
create policy gift_orders_private_read on public.orders as restrictive for select to authenticated using(public.gift_direct_order_read_allowed(id));
create policy gift_shipments_private_read on public.order_shipments as restrictive for select to authenticated using(public.gift_direct_order_read_allowed(order_id));
create policy gift_items_private_read on public.order_items as restrictive for select to authenticated using(public.gift_direct_order_read_allowed(order_id));

-- Seal tables and internal routines; only existing trusted owner functions may
-- call private delivery getters. No caller receives direct private table grants.
do $$declare item regclass;fn regprocedure;begin
 foreach item in array array['private.gift_runtime'::regclass,'private.gift_intents'::regclass,'private.gift_items'::regclass,
  'private.gift_recipient_addresses'::regclass,'private.gift_link_tokens'::regclass,'private.gift_claim_sessions'::regclass,
  'private.gift_operations'::regclass,'private.order_delivery_private_snapshots'::regclass] loop
  execute format('alter table %s enable row level security',item);execute format('revoke all on %s from public,anon,authenticated,service_role',item);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname=any(array['gift_require_actor','gift_require_runtime','gift_source','gift_lock_subjects','gift_lock','gift_operation_replay','gift_record_operation','gift_selection',
   'gift_selection_display','gift_item_identity_changed','gift_detail','gift_operation_result','gift_session_id','gift_direct_order_read_allowed','order_delivery_snapshot','bind_goods_transaction_delivery_snapshot']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname=any(array['get_my_gift','list_my_gifts','get_gift_availability','create_my_gift','issue_my_gift_link','service_begin_gift_claim_session','read_my_gift_invitation',
   'respond_to_gift','update_my_gift_address','close_my_gift','service_expire_gifts','gift_direct_order_read_allowed']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to %s',fn,case when fn::text ~ '(^|[.])service_' then 'service_role' else 'authenticated' end);
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
grant execute on function public.get_gift_availability() to anon;
select private.register_operator_internal_contract('public.get_gift_availability()'::regprocedure);
select private.register_operator_internal_contract('public.gift_direct_order_read_allowed(uuid)'::regprocedure);
select private.register_operator_policy_contract('public.orders'::regclass,'gift_orders_private_read','sales.read');
select private.register_operator_policy_contract('public.order_shipments'::regclass,'gift_shipments_private_read','sales.read');
select private.register_operator_policy_contract('public.order_items'::regclass,'gift_items_private_read','sales.read');
commit;
notify pgrst,'reload schema';
