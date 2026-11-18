begin;
-- 카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치(2026-11-18 사용자 지시).
--
-- 세 기능은 판매·운영하지 않기로 해 migration 시점부터 전부 꺼진 상태로 시작한다. 꺼진 기능은
-- 공개 표면에서 사라지고(진입점·라우트·스태프 시연 포함) 누구에게도 동작하지 않는다. 앱은
-- 셸·라우트에서 이 값을 읽어 막고, 실패하면 꺼짐으로 읽는다(fail-closed). 세 기능에는 전용
-- 서버 동작·RPC가 없다 — 바인더는 라우트 게이트를 지난 뒤에만 본인 user_cards(RLS)를 읽고,
-- 마켓·트레이드는 화면 로컬 mock이라 DB를 쓰지 않는다.
--
-- 행은 private에 두고 앱 롤은 함수로만 만난다. 공개 읽기는 세 불리언만 돌려주고, 바꾸기는
-- 통합·계정 주매니저(platform.manage, 권한 전환 전에는 기존 admin)만 감사 기록과 함께 한다.
-- 같은 작업 ID는 같은 결과를 다시 돌려주고(멱등), 화면이 본 revision과 다르면 거절한다.

create table private.collectible_feature_control (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 1 check(revision>0),
 binder_enabled boolean not null default false,
 market_enabled boolean not null default false,
 exchange_enabled boolean not null default false,
 updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default clock_timestamp()
);
insert into private.collectible_feature_control(singleton) values(true);
alter table private.collectible_feature_control enable row level security;
revoke all on private.collectible_feature_control from public,anon,authenticated,service_role;

-- 행이 없거나 읽지 못하면 전부 꺼짐이다.
create function private.collectible_features_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'binder',coalesce((select c.binder_enabled from private.collectible_feature_control c where c.singleton),false),
  'market',coalesce((select c.market_enabled from private.collectible_feature_control c where c.singleton),false),
  'exchange',coalesce((select c.exchange_enabled from private.collectible_feature_control c where c.singleton),false));
$$;
revoke all on function private.collectible_features_state() from public,anon,authenticated,service_role;

-- 공개 읽기: 셸 진입점·라우트·서버 동작이 매번 이 값으로 판정한다. 누가 바꿨는지는 내보내지 않는다.
create function public.get_collectible_features() returns jsonb
language sql stable security definer set search_path='' as $$
 select private.collectible_features_state();
$$;
revoke all on function public.get_collectible_features() from public,anon,authenticated,service_role;
grant execute on function public.get_collectible_features() to anon,authenticated;

create function private.collectible_features_admin_document() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',c.revision,'binder',c.binder_enabled,'market',c.market_enabled,'exchange',c.exchange_enabled,
  'updatedAt',c.updated_at,'updatedBy',(select p.nickname from public.profiles p where p.id=c.updated_by))
 from private.collectible_feature_control c where c.singleton;
$$;
revoke all on function private.collectible_features_admin_document() from public,anon,authenticated,service_role;

-- volatile: PostgREST는 stable 함수를 읽기 전용 트랜잭션에서 실행하는데, 권한 가드는 volatile이라 그 안에서
-- 거절(25006 → HTTP 405)된다. 다른 admin_get_* 읽기와 같이 volatile로 둔다.
create function public.admin_get_collectible_features() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.require_operator_capability('platform.manage',true);
 return private.collectible_features_admin_document();
end $$;
revoke all on function public.admin_get_collectible_features() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_collectible_features() to authenticated;

create function public.admin_save_collectible_features(p_binder boolean,p_market boolean,p_exchange boolean,
 p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;previous private.collectible_feature_control;request jsonb;receipt jsonb;
begin
 actor:=private.require_operator_capability('platform.manage',true);
 if p_binder is null or p_market is null or p_exchange is null or p_expected_revision is null or p_expected_revision<1
  or p_operation_id is null then raise invalid_parameter_value using message='invalid_collectible_features';end if;
 request:=jsonb_build_object('binder',p_binder,'market',p_market,'exchange',p_exchange,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('collectible-features-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.collectible_features.settings',request);
 if receipt is not null then return receipt;end if;
 select * into previous from private.collectible_feature_control where singleton for update;
 if not found then raise no_data_found using message='collectible_features_missing';end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='collectible_features_changed';end if;
 update private.collectible_feature_control set revision=revision+1,binder_enabled=p_binder,market_enabled=p_market,
  exchange_enabled=p_exchange,updated_by=actor,updated_at=clock_timestamp() where singleton;
 receipt:=private.collectible_features_admin_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.collectible_features.settings','collectible_features',
  jsonb_build_object('request',request,'before',jsonb_build_object('binder',previous.binder_enabled,'market',previous.market_enabled,
   'exchange',previous.exchange_enabled),'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid) to authenticated;

-- 운영자 RPC 지문(ACL 확정 뒤). 실행 메타데이터 지문은 등록 함수가 함께 남긴다.
select private.register_operator_rpc_contract('public.admin_get_collectible_features()'::regprocedure,'platform.manage','read',true);
select private.register_operator_rpc_contract('public.admin_save_collectible_features(boolean,boolean,boolean,bigint,uuid)'::regprocedure,'platform.manage','write',true);
commit;
