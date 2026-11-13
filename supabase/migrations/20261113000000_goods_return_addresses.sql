-- 상품별 반품/교환지(S36-040·QNA-031)와 교환·반품 가능/제한 표시(S36-044)의 기반.
--
-- 1. 반품/교환지 주소록(public.return_addresses): 이름·주소·연락처. 설정 화면에서 platform.manage가 관리하고,
--    상품 편집기(catalog.read)가 고른다. 고객은 표를 직접 읽지 않고 공개 RPC(get_good_shipping_policy)와
--    회수 문서로만 본다.
-- 2. 상품의 반품지(goods.return_address_id): 비우면 출고지 설정의 반품 주소가 기본값이다. 출고지 반품 주소는
--    그대로 둔다(ADR-0016 보완 — 상품 우선, 비우면 출고지).
-- 3. 상품 저장(admin_save_good_claim_policy)이 반품·교환 조건과 함께 'returnAddressId'를 받는다. 키가 없으면
--    지금 값을 지킨다(배송정보 템플릿 적용·이전 화면은 반품지를 바꾸지 않는다).
-- 4. 공개 상세의 회수 주소(get_good_shipping_policy.returnAddress)는 상품 반품지가 있으면 그 주소다.
begin;

create table public.return_addresses (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'),
 address text not null check(address=btrim(address) and char_length(address) between 1 and 500 and address !~ '[[:cntrl:]]'),
 phone text not null check(phone ~ '^[0-9][0-9-]{6,18}[0-9]$' and phone !~ '--'),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid references public.profiles(id) on delete restrict,
 constraint return_addresses_name_key unique(name)
);
comment on table public.return_addresses is '반품/교환지 주소록(S36-040). 상품이 고르고, 비운 상품은 출고지 반품 주소를 쓴다. 클레임 회수 묶음은 승인 때 이 값을 스냅샷한다.';
alter table public.return_addresses enable row level security;
revoke all on public.return_addresses from public,anon,authenticated,service_role;
grant select on public.return_addresses to authenticated;
create policy return_addresses_catalog_read on public.return_addresses for select to authenticated
 using((select public.has_operator_capability('catalog.read')));
select private.register_operator_policy_contract('public.return_addresses'::regclass,'return_addresses_catalog_read','catalog.read');

alter table public.goods add column return_address_id uuid references public.return_addresses(id) on delete restrict;
create index goods_return_address_idx on public.goods(return_address_id) where return_address_id is not null;
comment on column public.goods.return_address_id is '상품의 반품/교환지(주소록). null이면 출고지 설정의 반품 주소를 쓴다.';

-- 주소록 저장. 새 주소는 p_id null·p_expected_updated_at null, 수정은 둘 다 필요하다(낙관적 잠금).
create function public.admin_save_return_address(p_id uuid,p_values jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());previous public.return_addresses;saved public.return_addresses;
 name_value text;address_value text;phone_value text;
begin
 perform private.require_operator_capability('platform.manage',true);
 if actor is null then raise insufficient_privilege using message='admin_required';end if;
 if jsonb_typeof(p_values) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in('name','address','phone'))
  or jsonb_typeof(p_values->'name') is distinct from 'string' or jsonb_typeof(p_values->'address') is distinct from 'string'
  or jsonb_typeof(p_values->'phone') is distinct from 'string' then
  raise invalid_parameter_value using message='invalid_return_address';end if;
 name_value:=btrim(p_values->>'name');address_value:=btrim(p_values->>'address');phone_value:=btrim(p_values->>'phone');
 if char_length(name_value) not between 1 and 60 or char_length(address_value) not between 1 and 500
  or name_value ~ '[[:cntrl:]]' or address_value ~ '[[:cntrl:]]' or phone_value !~ '^[0-9][0-9-]{6,18}[0-9]$' or phone_value ~ '--' then
  raise invalid_parameter_value using message='invalid_return_address';end if;
 if p_id is null then
  if p_expected_updated_at is not null then raise invalid_parameter_value using message='invalid_return_address';end if;
  if exists(select 1 from public.return_addresses where name=name_value) then raise unique_violation using message='return_address_name_taken';end if;
  insert into public.return_addresses(name,address,phone,updated_by) values(name_value,address_value,phone_value,actor) returning * into saved;
 else
  select * into previous from public.return_addresses where id=p_id for update;
  if not found then raise no_data_found using message='return_address_not_found';end if;
  if p_expected_updated_at is null or previous.updated_at is distinct from p_expected_updated_at then
   raise sqlstate 'PT409' using message='return_address_conflict';end if;
  if exists(select 1 from public.return_addresses where name=name_value and id<>p_id) then raise unique_violation using message='return_address_name_taken';end if;
  if previous.name=name_value and previous.address=address_value and previous.phone=phone_value then
   return jsonb_build_object('id',previous.id,'updatedAt',previous.updated_at,'replayed',true);end if;
  update public.return_addresses set name=name_value,address=address_value,phone=phone_value,updated_by=actor,
   updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond') where id=p_id returning * into saved;
 end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.return_address.saved','return_addresses:'||saved.id,
  jsonb_build_object('before',case when previous.id is null then null else jsonb_build_object('name',previous.name,'address',previous.address,'phone',previous.phone) end,
   'after',jsonb_build_object('name',saved.name,'address',saved.address,'phone',saved.phone)));
 return jsonb_build_object('id',saved.id,'updatedAt',saved.updated_at,'replayed',false);
exception when unique_violation then
 -- 같은 이름의 동시 등록은 이름 유일 제약이 막는다. 화면에는 같은 문구로 돌려준다.
 if sqlerrm='return_address_name_taken' or sqlerrm like '%return_addresses_name_key%' then raise unique_violation using message='return_address_name_taken';end if;
 raise;
end $$;
revoke all on function public.admin_save_return_address(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_return_address(uuid,jsonb,timestamptz) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_return_address(uuid,jsonb,timestamptz)'::regprocedure,'platform.manage','write',true);

-- 주소록 삭제. 상품이 고른 주소는 지울 수 없다(상품에서 먼저 비운다). 이미 접수된 클레임의 회수 묶음은
-- 스냅샷이라 삭제와 무관하다.
create function public.admin_delete_return_address(p_id uuid,p_expected_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());previous public.return_addresses;
begin
 perform private.require_operator_capability('platform.manage',true);
 if actor is null then raise insufficient_privilege using message='admin_required';end if;
 select * into previous from public.return_addresses where id=p_id for update;
 if not found then raise no_data_found using message='return_address_not_found';end if;
 if p_expected_updated_at is null or previous.updated_at is distinct from p_expected_updated_at then
  raise sqlstate 'PT409' using message='return_address_conflict';end if;
 if exists(select 1 from public.goods where return_address_id=p_id) then raise foreign_key_violation using message='return_address_in_use';end if;
 begin
  delete from public.return_addresses where id=p_id;
 exception when foreign_key_violation then raise foreign_key_violation using message='return_address_in_use';
 end;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.return_address.deleted','return_addresses:'||p_id,
  jsonb_build_object('before',jsonb_build_object('name',previous.name,'address',previous.address,'phone',previous.phone)));
 return true;
end $$;
revoke all on function public.admin_delete_return_address(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_delete_return_address(uuid,timestamptz) to authenticated;
select private.register_operator_rpc_contract('public.admin_delete_return_address(uuid,timestamptz)'::regprocedure,'platform.manage','write',true);

-- 상품 저장: 반품·교환 조건과 같은 칸 묶음으로 반품지를 받는다(최소 앵커 치환 — T15b가 섹션 호출로 이어받는다).
do $migration$
declare definition text:=pg_get_functiondef('public.admin_save_good_claim_policy(text,jsonb,timestamptz)'::regprocedure);
 anchors text[]:=array[
  $a$next_free_return_fee bigint; next_exchange_fee bigint;$a$,
  $a$where key not in ('returnAllowed','exchangeAllowed','restrictionReason','returnFee','returnFreeShippingFee','exchangeFee')) then$a$,
  $a$  if target_policy ? 'restrictionReason' and jsonb_typeof(target_policy->'restrictionReason') not in ('string','null') then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;$a$,
  $a$  next_exchange_fee:=case when target_policy?'exchangeFee' then (target_policy->>'exchangeFee')::bigint else previous.claim_exchange_fee end;$a$,
  $a$'returnFreeShippingFee',previous.claim_return_free_shipping_fee,'exchangeFee',previous.claim_exchange_fee);$a$,
  $a$'returnFee',next_return_fee,'returnFreeShippingFee',next_free_return_fee,'exchangeFee',next_exchange_fee);$a$,
  $a$claim_exchange_fee=next_exchange_fee where id=target_good_id returning * into saved;$a$];
 replacements text[]:=array[
  $a$next_free_return_fee bigint; next_exchange_fee bigint; next_return_address uuid;$a$,
  $a$where key not in ('returnAllowed','exchangeAllowed','restrictionReason','returnFee','returnFreeShippingFee','exchangeFee','returnAddressId')) then$a$,
  $a$  if target_policy ? 'restrictionReason' and jsonb_typeof(target_policy->'restrictionReason') not in ('string','null') then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;
  -- 반품/교환지(S36-040): 주소록 id 또는 null(출고지 반품 주소).
  if target_policy ? 'returnAddressId' and not (jsonb_typeof(target_policy->'returnAddressId')='null'
    or (jsonb_typeof(target_policy->'returnAddressId')='string'
      and target_policy->>'returnAddressId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then
    raise invalid_parameter_value using message='invalid_good_claim_policy';
  end if;$a$,
  $a$  next_exchange_fee:=case when target_policy?'exchangeFee' then (target_policy->>'exchangeFee')::bigint else previous.claim_exchange_fee end;
  next_return_address:=case when target_policy?'returnAddressId' then (target_policy->>'returnAddressId')::uuid else previous.return_address_id end;
  -- 잠금 순서: 상품(위 for update) → 주소록(for share). 승인 스냅샷(prepare_claim_collections)도 같은 순서다.
  if next_return_address is not null then
    perform 1 from public.return_addresses where id=next_return_address for share;
    if not found then raise check_violation using message='return_address_not_found'; end if;
  end if;$a$,
  $a$'returnFreeShippingFee',previous.claim_return_free_shipping_fee,'exchangeFee',previous.claim_exchange_fee,'returnAddressId',previous.return_address_id);$a$,
  $a$'returnFee',next_return_fee,'returnFreeShippingFee',next_free_return_fee,'exchangeFee',next_exchange_fee,'returnAddressId',next_return_address);$a$,
  $a$claim_exchange_fee=next_exchange_fee,return_address_id=next_return_address where id=target_good_id returning * into saved;$a$];
 i integer;
begin
 for i in 1..array_length(anchors,1) loop
  if (length(definition)-length(replace(definition,anchors[i],'')))/length(anchors[i])<>1 then
   raise exception 'admin_save_good_claim_policy anchor % must appear once',i;end if;
  definition:=replace(definition,anchors[i],replacements[i]);
 end loop;
 execute definition;
end $migration$;

-- 공개 상세의 회수 주소: 상품 반품지가 있으면 그 주소, 없으면 출고지 반품 주소(T19 본문 위 앵커 치환).
do $migration$
declare definition text:=pg_get_functiondef('public.get_good_shipping_policy(text)'::regprocedure);
 address_anchor text:=$a$'returnAddress', origin.return_address,$a$;
 address_replacement text:=$a$'returnAddress', coalesce(return_place.address, origin.return_address),$a$;
 join_anchor text:=$a$join public.fulfillment_origins origin on origin.id = policy_good.origin_id and origin.is_active$a$;
 join_replacement text:=$a$join public.fulfillment_origins origin on origin.id = policy_good.origin_id and origin.is_active
  left join public.return_addresses return_place on return_place.id = good.return_address_id$a$;
begin
 if (length(definition)-length(replace(definition,address_anchor,'')))/length(address_anchor)<>1
  or (length(definition)-length(replace(definition,join_anchor,'')))/length(join_anchor)<>1 then
  raise exception 'get_good_shipping_policy anchors must appear once';end if;
 execute replace(replace(definition,address_anchor,address_replacement),join_anchor,join_replacement);
end $migration$;

-- 상품 복사·그룹상품 만들기도 반품·교환 조건과 함께 반품지를 그대로 옮긴다(복사본이 원본 설정을 유지하는 규칙).
do $migration$
declare fn regprocedure;definition text;
 anchor text:=$a$'exchangeFee',source_good.claim_exchange_fee),$a$;
 replacement text:=$a$'exchangeFee',source_good.claim_exchange_fee,'returnAddressId',source_good.return_address_id),$a$;
begin
 foreach fn in array array[
  'private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure,
  'private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure] loop
  definition:=pg_get_functiondef(fn);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception '% claim policy anchor must appear once',fn;end if;
  execute replace(definition,anchor,replacement);
 end loop;
end $migration$;

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure;contract record;begin
 foreach fn in array array[
  'public.admin_save_good_claim_policy(text,jsonb,timestamptz)'::regprocedure,
  'public.get_good_shipping_policy(text)'::regprocedure,
  'private.admin_clone_good_before_discount_display(uuid,text,text,text,text)'::regprocedure,
  'private.create_goods_group_product(text,uuid,text,uuid)'::regprocedure] loop
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
