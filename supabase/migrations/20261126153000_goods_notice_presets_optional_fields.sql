-- 어드민 화면 규칙 PR 2 · N11(결정 D1): 상품정보제공고시 템플릿의 칸을 비워 둘 수 있게 한다.
--
-- 지금까지는 일곱 칸을 모두 채워야 템플릿이 저장됐다. 상품마다 다른 '크기 · 중량'·'제조연월'에도 무언가 적어야 했고,
-- 템플릿을 가져오면 그 값이 상품의 값을 덮었다. 고치는 것을 잊으면 틀린 법정 표시가 공개된다.
--
-- 바뀌는 것
--   - 비운 칸은 빈 글('')로 저장한다. 칸은 계속 not null이다 — 템플릿을 읽는 쪽(상품등록의 [템플릿에서 가져오기],
--     엑셀 일괄등록의 고시 템플릿 열)이 늘 글자를 받는다. 두 곳 모두 앱 코드이고, 비운 칸은 상품의 값을 건드리지 않는다.
--   - 일곱 칸이 모두 빈 템플릿은 저장할 수 없다(가져올 내용이 없다). KC 유형 틀만 있는 템플릿도 같다. 템플릿 이름은 계속 필수다.
-- 그대로인 것
--   - 템플릿은 상품에 복사만 되고 연결되지 않는다(#424). 이 테이블을 읽어 상품에 값을 쓰는 DB 함수는 없다.
--   - 상품을 공개할 때 고시 일곱 칸이 모두 있어야 하는 검사(private.set_good_published)는 상품의 값을 본다. 바뀌지 않는다.
--   - 권한(catalog.manage), 감사 기록, 동시 수정 거절(PT409), KC 유형 틀 저장 규칙.

alter table public.goods_notice_presets
  drop constraint goods_notice_presets_maker_check,
  drop constraint goods_notice_presets_origin_check,
  drop constraint goods_notice_presets_material_check,
  drop constraint goods_notice_presets_size_check,
  drop constraint goods_notice_presets_made_on_check,
  drop constraint goods_notice_presets_as_manager_check,
  drop constraint goods_notice_presets_as_contact_check,
  add constraint goods_notice_presets_maker_check
    check (char_length(maker) <= 1000 and (maker = '' or maker ~ '[^[:space:]]')),
  add constraint goods_notice_presets_origin_check
    check (char_length(origin) <= 1000 and (origin = '' or origin ~ '[^[:space:]]')),
  add constraint goods_notice_presets_material_check
    check (char_length(material) <= 1000 and (material = '' or material ~ '[^[:space:]]')),
  add constraint goods_notice_presets_size_check
    check (char_length(size) <= 1000 and (size = '' or size ~ '[^[:space:]]')),
  add constraint goods_notice_presets_made_on_check
    check (char_length(made_on) <= 1000 and (made_on = '' or made_on ~ '[^[:space:]]')),
  add constraint goods_notice_presets_as_manager_check
    check (char_length(as_manager) <= 1000 and (as_manager = '' or as_manager ~ '[^[:space:]]')),
  add constraint goods_notice_presets_as_contact_check
    check (char_length(as_contact) <= 1000 and (as_contact = '' or as_contact ~ '[^[:space:]]')),
  add constraint goods_notice_presets_any_field_check
    check (maker <> '' or origin <> '' or material <> '' or size <> '' or made_on <> '' or as_manager <> '' or as_contact <> '');

-- 지금 DB의 원문(20261020085156 PT409·20261020085215 운영자 권한 가드가 고친 뒤의 본문)에서 두 곳만 바꾼다:
-- 칸 길이 검사(1~1000 → 0~1000)와 '모두 빈 템플릿' 거절.
-- 일곱 칸의 이름은 계속 모두 보내야 한다(비운 칸은 빈 글) — 칸을 빠뜨린 요청과 일부러 비운 칸을 구분한다.
create or replace function public.admin_save_goods_notice_preset(
  target_id uuid, target_name text, target_notice jsonb, expected_updated_at timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  normalized_name text := btrim(coalesce(target_name, ''), E' \t\n\r\f\v');
  normalized_notice jsonb;
  normalized_kc jsonb;
  previous public.goods_notice_presets;
  saved public.goods_notice_presets;
begin
  perform private.require_operator_capability('catalog.manage',false);

  if actor is null or not public.has_operator_capability('catalog.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;
  if char_length(normalized_name) not between 1 and 80
    or jsonb_typeof(target_notice) is distinct from 'object' then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  if not target_notice ?& array['maker','origin','material','size','madeOn','asManager','asContact']
    or exists (select 1 from jsonb_each(target_notice) as field
      where field.key not in ('maker','origin','material','size','madeOn','asManager','asContact','kcTemplate')
        or (field.key<>'kcTemplate' and jsonb_typeof(field.value) <> 'string')) then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  select jsonb_object_agg(field.key, btrim(field.value, E' \t\n\r\f\v'))
    into normalized_notice from jsonb_each_text(target_notice) as field where field.key<>'kcTemplate';
  if target_notice ? 'kcTemplate' then normalized_kc:=private.normalize_goods_notice_kc_template(target_notice->'kcTemplate'); end if;
  if exists (select 1 from jsonb_each_text(normalized_notice) as field
    where char_length(field.value) > 1000) then
    raise invalid_parameter_value using message = 'invalid_goods_notice_preset';
  end if;
  -- 비운 칸은 상품에 가져올 때 건드리지 않는다. 일곱 칸이 모두 비면 가져올 내용이 없는 템플릿이다.
  if not exists (select 1 from jsonb_each_text(normalized_notice) as field where field.value <> '') then
    raise invalid_parameter_value using message = 'goods_notice_preset_empty';
  end if;

  if target_id is not null then
    select * into previous from public.goods_notice_presets where id = target_id for update;
    if not found then raise no_data_found using message = 'goods_notice_preset_not_found'; end if;
    if expected_updated_at is distinct from previous.updated_at then
      raise sqlstate 'PT409' using message = 'goods_notice_preset_conflict';
    end if;
  end if;

  if target_id is null then
    insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact,kc_template)
    values (normalized_name,normalized_notice->>'maker',normalized_notice->>'origin',
      normalized_notice->>'material',normalized_notice->>'size',normalized_notice->>'madeOn',
      normalized_notice->>'asManager',normalized_notice->>'asContact',normalized_kc) returning * into saved;
  else
    update public.goods_notice_presets set name = normalized_name,
      maker = normalized_notice->>'maker', origin = normalized_notice->>'origin',
      material = normalized_notice->>'material', size = normalized_notice->>'size',
      made_on = normalized_notice->>'madeOn', as_manager = normalized_notice->>'asManager',
      as_contact = normalized_notice->>'asContact',
      kc_template = case when target_notice ? 'kcTemplate' then normalized_kc else previous.kc_template end,
      updated_at = greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond')
    where id = target_id returning * into saved;
  end if;

  insert into public.audit_log(actor_id,action,target,diff)
    values(actor, case when target_id is null then 'catalog.goods_notice_preset.created'
      else 'catalog.goods_notice_preset.updated' end, 'goods_notice_presets:' || saved.id::text,
      jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(saved)));
  return saved.id;
end;
$$;

-- 함수 본문이 바뀌었으니 운영자 계약의 본문 지문을 다시 등록한다(안 하면 operator_capability_coverage가 drift로 실패한다).
select private.register_operator_rpc_contract(
  'public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)'::regprocedure, 'catalog.manage', 'write', false
);
