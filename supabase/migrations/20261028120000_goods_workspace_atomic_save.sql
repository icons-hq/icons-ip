-- 10/27 회의 R13·D6②: 상품 등록 화면의 기본 입력과 KC·예약판매를 한 트랜잭션으로 저장한다.
--
-- 기존 admin_save_good 래퍼 체인과 섹션 RPC(admin_save_goods_kc·admin_save_goods_preorder)는
-- 재정의하지 않는다. 새 래퍼가 같은 트랜잭션에서 순서대로 호출하므로 하나라도 실패하면
-- 기본 입력까지 모두 되돌린다.
--   1. 작업 ID 영수증: 같은 요청을 다시 보내면 저장 결과를 돌려준다(신규 등록 재시도 중복 방지).
--      다른 요청이 같은 작업 ID를 쓰면 거절한다.
--   2. 저장 전 CAS: 화면이 본 KC 버전·맥락 지문을 기본 저장 전 상태로 확인한다. 기본 저장이 KC
--      검토를 무효화해도(상품명·옵션 변경) 그 뒤 새 버전으로 KC를 저장할 수 있다(kc_update 층과 같은 순서).
--   3. admin_save_good / admin_save_good_from_draft
--   4. 옵션 참조 해석: 저장된 옵션은 id, 새 옵션은 attributes로 찾는다. 활성 옵션을 먼저 보고, 없으면 이번 저장이 만든
--      옵션(사용 중지로 등록해 바로 보관된 새 옵션)에서 찾는다. 실패는 섹션별 코드(kc·preorder)로 알린다.
--   5. KC: 검토 완료(reviewed)는 화면의 확인 체크(attested=true)가 있어야 한다(admin_save_goods_kc가 강제).
--   6. 예약판매: 옵션별 정책 저장. 활성화는 admin_save_goods_preorder가 platform.manage+admin을 다시 검사한다.
-- 공개는 하지 않는다(신규 등록 동시 공개 없음, 기존 게시 상태 전환 유지). 서버 임시저장은 섹션을 담지 않는다.

create table private.goods_workspace_operations(
  operation_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  good_id text not null,
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.goods_workspace_operations enable row level security;
revoke all on table private.goods_workspace_operations from public,anon,authenticated,service_role;

-- 화면이 보낸 옵션 참조를 이 상품의 옵션 하나로 해석한다. 저장된 옵션은 id로 찾는다(보관된 옵션 포함 — 기존 독립 패널과
-- 같은 범위). 새 옵션은 저장 전 id가 없으므로 옵션값 조합으로 찾는다(한 제출 안에서 조합은 중복될 수 없다 —
-- private.save_goods_options). 활성 옵션을 먼저 보고, 없으면 이번 저장이 만든 옵션(p_new_variants)에서 찾는다:
-- 새 옵션을 '사용 중지'로 등록하면 save_goods_options가 저장과 함께 보관하지만 KC 모델 연결·예약 초안 대상이 될 수 있다.
-- 이전 저장에서 보관된 옵션은 조합으로 찾지 않는다(같은 조합의 낡은 옵션을 잘못 고르지 않게).
-- 실패 코드는 섹션(kc·preorder)을 담아 화면이 해당 카드에 안내한다.
create function private.resolve_goods_workspace_variant(p_good_id text,p_ref jsonb,p_new_variants uuid[],p_section text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare matched uuid[]; invalid text; unresolved text;
begin
  if p_section is null or p_section not in ('kc','preorder') then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  invalid:='invalid_goods_workspace_'||p_section||'_variant';
  unresolved:='goods_workspace_'||p_section||'_variant_unresolved';
  if jsonb_typeof(p_ref) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_ref))<>1 then
    raise check_violation using message=invalid;
  end if;
  if p_ref ? 'id' then
    if jsonb_typeof(p_ref->'id') is distinct from 'string'
      or p_ref->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise check_violation using message=invalid;
    end if;
    select array_agg(id) into matched from public.goods_variants where id=(p_ref->>'id')::uuid and good_id=p_good_id;
  elsif p_ref ? 'attributes' then
    if jsonb_typeof(p_ref->'attributes') is distinct from 'object' then
      raise check_violation using message=invalid;
    end if;
    select array_agg(id) into matched from public.goods_variants
      where good_id=p_good_id and archived_at is null and attributes=p_ref->'attributes';
    if coalesce(cardinality(matched),0)=0 then
      select array_agg(id) into matched from public.goods_variants
        where good_id=p_good_id and id=any(coalesce(p_new_variants,'{}')) and attributes=p_ref->'attributes';
    end if;
  else
    raise check_violation using message=invalid;
  end if;
  if coalesce(cardinality(matched),0)<>1 then raise check_violation using message=unresolved; end if;
  return matched[1];
end $$;
revoke all on function private.resolve_goods_workspace_variant(text,jsonb,uuid[],text) from public,anon,authenticated,service_role;

create function public.admin_save_good_workspace(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; operation uuid; good jsonb; draft jsonb; sections jsonb; kc jsonb; preorders jsonb;
  request_hash text; prior private.goods_workspace_operations; previous_id text; current_review private.goods_kc_reviews;
  saved jsonb; saved_id text; models jsonb:='[]'::jsonb; model jsonb; resolved jsonb; kc_revision integer; kc_saved jsonb;
  entry jsonb; variant uuid; policy jsonb; preorder_results jsonb:='[]'::jsonb; result jsonb;
  prior_variants uuid[]:='{}'; new_variants uuid[]:='{}';
  uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  if jsonb_typeof(p_request) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_request) key where key not in ('operationId','good','draft','sections'))
    or jsonb_typeof(p_request->'operationId') is distinct from 'string' or p_request->>'operationId' !~ uuid_pattern
    or jsonb_typeof(p_request->'good') is distinct from 'object'
    or coalesce(jsonb_typeof(p_request->'draft'),'null') not in ('null','object')
    or coalesce(jsonb_typeof(p_request->'sections'),'null') not in ('null','object') then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  operation:=(p_request->>'operationId')::uuid;
  good:=p_request->'good';
  draft:=case when jsonb_typeof(p_request->'draft')='object' then p_request->'draft' end;
  sections:=case when jsonb_typeof(p_request->'sections')='object' then p_request->'sections' else '{}'::jsonb end;
  if exists(select 1 from jsonb_object_keys(sections) key where key not in ('kc','preorders')) then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  if draft is not null and (exists(select 1 from jsonb_object_keys(draft) key where key not in ('id','revision'))
    or jsonb_typeof(draft->'id') is distinct from 'string' or draft->>'id' !~ uuid_pattern
    or jsonb_typeof(draft->'revision') is distinct from 'number' or draft->>'revision' !~ '^[1-9][0-9]*$'
    or (draft->>'revision')::numeric>2147483647) then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  -- 공개는 기존 게시 상태 전환이 맡는다. 래퍼는 초안 저장만 한다.
  if coalesce(good->'publish','null'::jsonb) not in ('null'::jsonb,'false'::jsonb) then
    raise check_violation using message='goods_workspace_publish_unsupported';
  end if;
  kc:=case when jsonb_typeof(sections->'kc')='object' then sections->'kc' end;
  if sections ? 'kc' and coalesce(jsonb_typeof(sections->'kc'),'null') not in ('null','object') then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  if kc is not null and ((select array_agg(key order by key) from jsonb_object_keys(kc) key)
      is distinct from array['attested','expectedContextFingerprint','expectedRevision','models','status']
    or jsonb_typeof(kc->'models') is distinct from 'array' or jsonb_array_length(kc->'models')>50
    or jsonb_typeof(kc->'attested') is distinct from 'boolean'
    or jsonb_typeof(kc->'status') is distinct from 'string' or kc->>'status' not in ('unreviewed','reviewed')
    or jsonb_typeof(kc->'expectedRevision') not in ('null','number')
    or (jsonb_typeof(kc->'expectedRevision')='number' and (kc->>'expectedRevision' !~ '^[1-9][0-9]*$' or (kc->>'expectedRevision')::numeric>2147483647))
    or jsonb_typeof(kc->'expectedContextFingerprint') not in ('null','string')) then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  preorders:=case when jsonb_typeof(sections->'preorders')='array' then sections->'preorders' end;
  if sections ? 'preorders' and coalesce(jsonb_typeof(sections->'preorders'),'null') not in ('null','array') then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  if preorders is not null and (jsonb_array_length(preorders)>100 or exists(select 1 from jsonb_array_elements(preorders) item
    where jsonb_typeof(item) is distinct from 'object'
      or (select array_agg(key order by key) from jsonb_object_keys(item) key) is distinct from array['expectedRevision','policyId','values','variant']
      or jsonb_typeof(item->'policyId') not in ('null','string') or (jsonb_typeof(item->'policyId')='string' and item->>'policyId' !~ uuid_pattern)
      or jsonb_typeof(item->'expectedRevision') not in ('null','number')
      or (jsonb_typeof(item->'expectedRevision')='number' and (item->>'expectedRevision' !~ '^[1-9][0-9]*$' or (item->>'expectedRevision')::numeric>2147483647))
      or jsonb_typeof(item->'values') is distinct from 'object')) then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  previous_id:=nullif(good->>'previous_id','');

  -- 1. 작업 영수증. 같은 요청의 재시도는 저장 결과를 그대로 돌려준다.
  request_hash:=encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('goods-workspace-operation:'||operation::text,0));
  select * into prior from private.goods_workspace_operations where operation_id=operation;
  if found then
    if prior.actor_id<>actor or prior.request_hash<>request_hash then
      raise sqlstate 'PT409' using message='goods_workspace_operation_conflict';
    end if;
    return prior.receipt||jsonb_build_object('replayed',true);
  end if;

  -- 2. 저장 전 CAS. admin_save_good(카테고리 트리 → 상품 행)·admin_save_goods_kc(상품 행 → KC 행)와 같은 잠금 순서다.
  perform private.lock_catalog_category_tree();
  if previous_id is not null then
    perform 1 from public.goods where id=previous_id for update;
    -- 저장 전 옵션. 저장 뒤 이 목록에 없는 옵션이 이번 저장이 만든 새 옵션이다(옵션 참조 해석).
    select coalesce(array_agg(id),'{}') into prior_variants from public.goods_variants where good_id=previous_id;
    if kc is not null then
      select * into current_review from private.goods_kc_reviews where good_id=previous_id for update;
      if current_review.revision is distinct from (kc->>'expectedRevision')::integer
        or kc->>'expectedContextFingerprint' is distinct from private.goods_kc_fingerprint(previous_id) then
        raise sqlstate 'PT409' using message='goods_kc_review_changed';
      end if;
    end if;
  elsif kc is not null and (kc->'expectedRevision'<>'null'::jsonb or kc->'expectedContextFingerprint'<>'null'::jsonb) then
    raise sqlstate 'PT409' using message='goods_kc_review_changed';
  end if;

  -- 3. 기본 상품·옵션 저장
  if draft is null then saved:=public.admin_save_good(good);
  else saved:=public.admin_save_good_from_draft(good,(draft->>'id')::uuid,(draft->>'revision')::integer);
  end if;
  saved_id:=saved->>'id';
  if coalesce(saved_id,'')='' then raise check_violation using message='goods_workspace_save_failed'; end if;

  if coalesce((saved->>'draftAlreadyCompleted')::boolean,false) then
    -- 이 임시저장은 다른 요청(다른 탭·다른 작업 ID)이 이미 상품으로 등록했다. 같은 작업의 재시도는 위 영수증이 돌려주므로,
    -- 여기 온 요청의 KC·예약판매 섹션은 그 등록에 들어간 적이 없다. 섹션이 있으면 저장되지 않은 입력을 성공으로
    -- 알리지 않도록 거절한다(화면 입력은 유지된다). 섹션이 없으면 등록된 상품을 돌려준다.
    if kc is not null or coalesce(jsonb_array_length(preorders),0)>0 then
      raise sqlstate 'PT409' using message='goods_workspace_draft_completed_sections_skipped';
    end if;
    result:=jsonb_build_object('id',saved_id,'operationId',operation,'created',false,'draftAlreadyCompleted',true,
      'good',saved,'kc',null,'preorders','[]'::jsonb);
  else
    select coalesce(array_agg(id),'{}') into new_variants from public.goods_variants
      where good_id=saved_id and not (id=any(prior_variants));
    -- 4·5. KC: 옵션 참조를 저장된 옵션 id로 바꾼 뒤 저장 후의 새 버전·맥락 지문으로 저장한다.
    if kc is not null then
      for model in select value from jsonb_array_elements(kc->'models') loop
        if jsonb_typeof(model) is distinct from 'object' or model ? 'variantIds'
          or jsonb_typeof(model->'variantRefs') is distinct from 'array' or jsonb_array_length(model->'variantRefs')>200 then
          raise check_violation using message='invalid_goods_kc_models';
        end if;
        select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into resolved from (
          select distinct private.resolve_goods_workspace_variant(saved_id,ref,new_variants,'kc')::text id
          from jsonb_array_elements(model->'variantRefs') ref) refs;
        models:=models||jsonb_build_array((model-'variantRefs')||jsonb_build_object('variantIds',resolved));
      end loop;
      select revision into kc_revision from private.goods_kc_reviews where good_id=saved_id;
      kc_saved:=public.admin_save_goods_kc(saved_id,models,kc->>'status',kc_revision,
        private.goods_kc_fingerprint(saved_id),(kc->>'attested')::boolean);
    end if;
    -- 6. 예약판매: 옵션별 정책. 활성화 권한·조건은 admin_save_goods_preorder가 검사한다.
    if preorders is not null then
      for entry in select value from jsonb_array_elements(preorders) loop
        variant:=private.resolve_goods_workspace_variant(saved_id,entry->'variant',new_variants,'preorder');
        policy:=public.admin_save_goods_preorder(saved_id,variant,(entry->>'policyId')::uuid,entry->'values',
          (entry->>'expectedRevision')::integer);
        preorder_results:=preorder_results||jsonb_build_array(policy||jsonb_build_object('variantId',variant));
      end loop;
    end if;
    result:=jsonb_build_object('id',saved_id,'operationId',operation,'created',previous_id is null,'good',saved,
      'kc',case when kc_saved is null then null else jsonb_build_object('changed',kc_saved->'changed',
        'status',kc_saved#>'{configuration,status}','revision',kc_saved#>'{configuration,revision}') end,
      'preorders',preorder_results);
  end if;
  insert into private.goods_workspace_operations(operation_id,actor_id,request_hash,good_id,receipt)
    values(operation,actor,request_hash,saved_id,result);
  insert into public.audit_log(id,actor_id,action,target,diff) values(operation,actor,'admin.good.workspace_saved','goods:'||saved_id,
    jsonb_build_object('created',previous_id is null,'draft',draft is not null,'kc',kc is not null,
      'preorders',coalesce(jsonb_array_length(preorders),0),'draftAlreadyCompleted',coalesce((saved->>'draftAlreadyCompleted')::boolean,false)));
  return result;
end $$;
revoke all on function public.admin_save_good_workspace(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good_workspace(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_good_workspace(jsonb)'::regprocedure,'catalog.manage','write',false);
notify pgrst,'reload schema';
