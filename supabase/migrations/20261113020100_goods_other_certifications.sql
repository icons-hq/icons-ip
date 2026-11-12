-- ==========================================================================
-- ICONS · 기타 인증(SHEET-014, 2026-11-11 사용자 결정 "기타 인증 여러 건") — ADR-0036
--
-- KC 외 인증(종류·인증기관·인증번호·고객 노출 여부)을 상품마다 최대 20건 기록하고,
-- 고객 노출을 선택한 것만 상품 상세의 제품 안전정보(KC 고지 옆)에 보인다.
--   * 원본은 private.goods_other_certifications(상품당 1행·버전·entries jsonb)다. 고객 데이터는
--     goods.other_certification_disclosures allowlist projection(종류·인증기관·인증번호)뿐이다.
--     KC 고지(goods.kc_disclosures)와 열을 나눠, 이전 앱 판(KC 행만 받는 엄격한 parser)이 새 항목
--     때문에 상세 읽기를 실패하지 않게 한다(배포 되돌리기 안전).
--   * projection은 트리거가 원본에서 다시 계산한다. 일반 writer·상품 복사·Data API 직접 갱신은
--     값을 넣을 수 없다(goods.kc_disclosures와 같은 방식).
--   * 기타 인증은 공개 조건이 아니고 검토 단계가 없다(판매자 자가 신고). 공개 중에도 고칠 수 있고
--     저장마다 감사 로그에 전후 값을 남긴다. 보관 상품은 복원한 뒤 고친다. 상품 복사는 승계하지 않는다.
--   * 조회는 catalog.read, 저장은 catalog.manage. 버전(revision) CAS로 동시 수정을 거절한다.
--   * 등록 화면 원자 저장(admin_save_good_workspace)에 otherCertifications 섹션을 더한다.
--     하나라도 실패하면 기본 입력까지 되돌린다. 같은 migration 끝에서 운영자 계약을 다시 등록한다.
-- ==========================================================================

alter table public.goods add column other_certification_disclosures jsonb not null default '[]'::jsonb
  check (jsonb_typeof(other_certification_disclosures)='array');
comment on column public.goods.other_certification_disclosures is
  '고객 상세에 보이는 기타 인증(종류·인증기관·인증번호). private.goods_other_certifications에서 트리거가 다시 계산하는 allowlist projection이다.';

create table private.goods_other_certifications (
  good_id text primary key references public.goods(id) on update cascade on delete cascade,
  revision integer not null check (revision>0),
  entries jsonb not null check (jsonb_typeof(entries)='array' and jsonb_array_length(entries)<=20),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.goods_other_certifications enable row level security;
revoke all on private.goods_other_certifications from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.goods_other_certifications to postgres;

-- 항목 하나: {kind, agency, number, visible}. 종류·인증번호는 필수, 인증기관은 선택이다. 한 줄 입력이라
-- 제어 문자를 거절하고 앞뒤 공백(JavaScript trim과 같은 문자)을 지운다. 같은 종류·번호는 한 번만 둔다.
-- 이 규칙은 lib/admin/goods-kc-other-certifications.ts와 같아야 한다.
create function private.normalize_goods_other_certifications(p_entries jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare entry jsonb; normalized jsonb:='[]'::jsonb; cert_kind text; cert_agency text; cert_number text;
  seen text[]:='{}'; entry_key text;
begin
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>20 then
    raise check_violation using message='invalid_goods_other_certifications';
  end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(entry)<>'object' or not (entry ?& array['kind','agency','number','visible'])
      or exists(select 1 from jsonb_object_keys(entry) key where key not in ('kind','agency','number','visible'))
      or jsonb_typeof(entry->'kind')<>'string' or jsonb_typeof(entry->'agency')<>'string'
      or jsonb_typeof(entry->'number')<>'string' or jsonb_typeof(entry->'visible')<>'boolean' then
      raise check_violation using message='invalid_goods_other_certifications';
    end if;
    cert_kind:=private.goods_kc_trim(entry->>'kind');
    cert_agency:=private.goods_kc_trim(entry->>'agency');
    cert_number:=private.goods_kc_trim(entry->>'number');
    if char_length(cert_kind)>100 or char_length(cert_agency)>100 or char_length(cert_number)>100
      or cert_kind ~ '[[:cntrl:]]' or cert_agency ~ '[[:cntrl:]]' or cert_number ~ '[[:cntrl:]]' then
      raise check_violation using message='invalid_goods_other_certifications';
    end if;
    if cert_kind='' or cert_number='' then
      raise check_violation using message='goods_other_certification_incomplete';
    end if;
    entry_key:=lower(cert_kind)||chr(31)||lower(cert_number);
    if entry_key=any(seen) then raise check_violation using message='goods_other_certification_duplicate'; end if;
    seen:=array_append(seen,entry_key);
    normalized:=normalized||jsonb_build_array(jsonb_build_object('kind',cert_kind,'agency',cert_agency,'number',cert_number,
      'visible',(entry->>'visible')::boolean));
  end loop;
  return normalized;
end $$;
revoke all on function private.normalize_goods_other_certifications(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.normalize_goods_other_certifications(jsonb) to postgres;

-- 고객 노출을 고른 항목만, 입력 순서대로. 고객에게는 종류·인증기관·인증번호만 나간다.
create function private.goods_other_certification_disclosures(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_agg(jsonb_build_object('kind',item.entry->>'kind','agency',item.entry->>'agency',
      'number',item.entry->>'number') order by item.ordinal)
    from private.goods_other_certifications certification
    cross join lateral jsonb_array_elements(certification.entries) with ordinality item(entry,ordinal)
    where certification.good_id=p_good_id and (item.entry->>'visible')::boolean),'[]'::jsonb);
$$;
revoke all on function private.goods_other_certification_disclosures(text) from public, anon, authenticated, service_role;
grant execute on function private.goods_other_certification_disclosures(text) to postgres;

-- 열 값은 언제나 원본에서 다시 계산한다. 새 상품(복사 포함)은 빈 목록으로 시작한다.
create function private.guard_goods_other_certification_disclosures() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.other_certification_disclosures:=case when tg_op='INSERT' then '[]'::jsonb
    else private.goods_other_certification_disclosures(old.id) end;
  return new;
end $$;
revoke all on function private.guard_goods_other_certification_disclosures() from public, anon, authenticated, service_role;
grant execute on function private.guard_goods_other_certification_disclosures() to postgres;
create trigger goods_other_certification_disclosures_guard before insert or update of other_certification_disclosures
  on public.goods for each row execute function private.guard_goods_other_certification_disclosures();

create function public.admin_read_goods_other_certifications(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare good public.goods; certification private.goods_other_certifications;
begin
  if not public.has_operator_capability('catalog.read',false) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  select * into good from public.goods where id=p_good_id;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into certification from private.goods_other_certifications where good_id=p_good_id;
  return jsonb_build_object('revision',certification.revision,'entries',coalesce(certification.entries,'[]'::jsonb),
    'publishedAt',good.published_at,'archivedAt',good.archived_at,'updatedAt',certification.updated_at,
    'updatedByName',(select nickname from public.profiles where id=certification.updated_by));
end $$;
revoke all on function public.admin_read_goods_other_certifications(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_read_goods_other_certifications(text) to authenticated;

-- 잠금 순서는 상품 행 → 기타 인증 행(admin_save_goods_kc의 상품 행 → KC 행과 같다).
create function public.admin_save_goods_other_certifications(p_good_id text, p_entries jsonb, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; good public.goods; current_set private.goods_other_certifications;
  saved_set private.goods_other_certifications; normalized_entries jsonb;
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  normalized_entries:=private.normalize_goods_other_certifications(p_entries);
  select * into good from public.goods where id=p_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if good.archived_at is not null then raise check_violation using message='catalog_item_archived'; end if;
  select * into current_set from private.goods_other_certifications where good_id=p_good_id for update;
  if current_set.revision is distinct from p_expected_revision then
    raise sqlstate 'PT409' using message='goods_other_certifications_changed';
  end if;
  if coalesce(current_set.entries,'[]'::jsonb)=normalized_entries then
    return jsonb_build_object('changed',false,'configuration',public.admin_read_goods_other_certifications(p_good_id));
  end if;
  insert into private.goods_other_certifications(good_id,revision,entries,updated_by,updated_at)
    values(p_good_id,coalesce(current_set.revision,0)+1,normalized_entries,actor,clock_timestamp())
    on conflict(good_id) do update set revision=excluded.revision,entries=excluded.entries,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at
    returning * into saved_set;
  -- 트리거가 원본에서 고객 표시 목록을 다시 계산한다(넣는 값은 무시된다).
  update public.goods set other_certification_disclosures='[]'::jsonb where id=p_good_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.other_certifications_saved','goods:'||p_good_id,
    jsonb_build_object('revision',saved_set.revision,'before',coalesce(current_set.entries,'[]'::jsonb),'after',normalized_entries));
  return jsonb_build_object('changed',true,'configuration',public.admin_read_goods_other_certifications(p_good_id));
end $$;
revoke all on function public.admin_save_goods_other_certifications(text,jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_goods_other_certifications(text,jsonb,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 등록 화면 원자 저장 — otherCertifications 섹션({entries, expectedRevision})
-- ---------------------------------------------------------------------------
-- 현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다(다른 migration이 같은 줄을 고쳤으면 실패한다).
create function private.goods_other_certifications_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> 1 then
      raise exception 'goods_other_certifications_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_other_certifications_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

select private.goods_other_certifications_patch('public.admin_save_good_workspace(jsonb)'::regprocedure, jsonb_build_array(
  jsonb_build_array(
    $anchor$  prior_variants uuid[]:='{}'; new_variants uuid[]:='{}';$anchor$,
    $patched$  prior_variants uuid[]:='{}'; new_variants uuid[]:='{}';
  other_certifications jsonb; other_saved jsonb;$patched$),
  jsonb_build_array(
    $anchor$where key not in ('kc','preorders')) then$anchor$,
    $patched$where key not in ('kc','preorders','otherCertifications')) then$patched$),
  jsonb_build_array(
    $anchor$  previous_id:=nullif(good->>'previous_id','');$anchor$,
    $patched$  -- 기타 인증(SHEET-014): {entries, expectedRevision}. 항목 규칙은 admin_save_goods_other_certifications가 검사한다.
  other_certifications:=case when jsonb_typeof(sections->'otherCertifications')='object' then sections->'otherCertifications' end;
  if sections ? 'otherCertifications' and coalesce(jsonb_typeof(sections->'otherCertifications'),'null') not in ('null','object') then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  if other_certifications is not null and ((select array_agg(key order by key) from jsonb_object_keys(other_certifications) key)
      is distinct from array['entries','expectedRevision']
    or jsonb_typeof(other_certifications->'entries') is distinct from 'array' or jsonb_array_length(other_certifications->'entries')>20
    or jsonb_typeof(other_certifications->'expectedRevision') not in ('null','number')
    or (jsonb_typeof(other_certifications->'expectedRevision')='number' and (other_certifications->>'expectedRevision' !~ '^[1-9][0-9]*$'
      or (other_certifications->>'expectedRevision')::numeric>2147483647))) then
    raise invalid_parameter_value using message='invalid_goods_workspace_request';
  end if;
  previous_id:=nullif(good->>'previous_id','');$patched$),
  jsonb_build_array(
    $anchor$    if kc is not null or coalesce(jsonb_array_length(preorders),0)>0 then$anchor$,
    $patched$    if kc is not null or coalesce(jsonb_array_length(preorders),0)>0 or other_certifications is not null then$patched$),
  jsonb_build_array(
    $anchor$      'good',saved,'kc',null,'preorders','[]'::jsonb);$anchor$,
    $patched$      'good',saved,'kc',null,'preorders','[]'::jsonb,'otherCertifications',null);$patched$),
  jsonb_build_array(
    $anchor$    result:=jsonb_build_object('id',saved_id,'operationId',operation,'created',previous_id is null,'good',saved,$anchor$,
    $patched$    -- 7. 기타 인증: 저장된 상품에 같은 트랜잭션으로 저장한다. 실패하면 기본 입력까지 되돌린다.
    if other_certifications is not null then
      other_saved:=public.admin_save_goods_other_certifications(saved_id,other_certifications->'entries',
        (other_certifications->>'expectedRevision')::integer);
    end if;
    result:=jsonb_build_object('id',saved_id,'operationId',operation,'created',previous_id is null,'good',saved,$patched$),
  jsonb_build_array(
    $anchor$      'preorders',preorder_results);$anchor$,
    $patched$      'preorders',preorder_results,
      'otherCertifications',case when other_saved is null then null else jsonb_build_object('changed',other_saved->'changed',
        'revision',other_saved#>'{configuration,revision}') end);$patched$),
  jsonb_build_array(
    $anchor$'draft',draft is not null,'kc',kc is not null,$anchor$,
    $patched$'draft',draft is not null,'kc',kc is not null,
      'otherCertifications',coalesce(jsonb_array_length(other_certifications->'entries'),0),$patched$)));

drop function private.goods_other_certifications_patch(regprocedure, jsonb);

-- 운영자 계약: 새 RPC 두 개를 등록하고, 앵커 치환한 원자 저장의 본문 지문을 다시 적는다(분류는 기존 행 그대로).
select private.register_operator_rpc_contract('public.admin_read_goods_other_certifications(text)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_save_goods_other_certifications(text,jsonb,integer)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_save_good_workspace(jsonb)'::regprocedure,'catalog.manage','write',false);
notify pgrst, 'reload schema';
