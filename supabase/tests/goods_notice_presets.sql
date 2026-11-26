\set ON_ERROR_STOP on
begin;

select 1 / case when (
  not has_table_privilege('anon', 'public.goods_notice_presets', 'select')
  and has_table_privilege('authenticated', 'public.goods_notice_presets', 'select')
  and not has_table_privilege('authenticated', 'public.goods_notice_presets', 'insert,update,delete')
  and not has_table_privilege('service_role', 'public.goods_notice_presets', 'select,insert,update,delete')
  and not has_function_privilege('anon', 'public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)', 'execute')
) then 1 else 0 end as assert_preset_acl;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-4000-8000-000000042401','authenticated','authenticated','preset-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000042402','authenticated','authenticated','preset-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000042401';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042401',true);
select public.admin_save_goods_notice_preset(null, ' 아크릴 기본 ',
  '{"maker":"아이콘스","origin":"대한민국","material":"아크릴","size":"80mm","madeOn":"2026-09","asManager":"아이콘스 고객센터","asContact":"02-000-0000"}', null) as preset_id \gset
select 1 / case when exists (
  select 1 from public.goods_notice_presets where id = :'preset_id'
    and name = '아크릴 기본' and maker = '아이콘스' and origin = '대한민국'
    and material = '아크릴' and size = '80mm' and made_on = '2026-09'
    and as_manager = '아이콘스 고객센터' and as_contact = '02-000-0000'
) then 1 else 0 end as assert_staff_saves_and_reads_seven_fields;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042402',true);
select 1 / case when not exists(select 1 from public.goods_notice_presets) then 1 else 0 end as assert_buyer_cannot_read;
do $$ begin
  perform public.admin_save_goods_notice_preset(null,'권한 우회','{}',null);
  raise exception 'buyer write was allowed';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042401',true);
select updated_at as original_updated_at from public.goods_notice_presets where id = :'preset_id' \gset
select public.admin_save_goods_notice_preset(:'preset_id', '아크릴 개선',
  '{"maker":"수정 제조사","origin":"일본","material":"금속","size":"90mm","madeOn":"2026-10","asManager":"수정 고객센터","asContact":"02-111-1111"}', :'original_updated_at');
select 1 / case when exists (
  select 1 from public.goods_notice_presets where id = :'preset_id'
    and name = '아크릴 개선' and maker = '수정 제조사' and origin = '일본'
    and material = '금속' and size = '90mm' and made_on = '2026-10'
    and as_manager = '수정 고객센터' and as_contact = '02-111-1111'
    and updated_at > :'original_updated_at'
) then 1 else 0 end as assert_update_copies_seven_fields;

do $$ declare row public.goods_notice_presets; notice jsonb;
begin
  select * into row from public.goods_notice_presets where name = '아크릴 개선';
  notice := '{"maker":"제조사","origin":"한국","material":"소재","size":"1mm","madeOn":"2026","asManager":"센터","asContact":"02-000-0000"}';
  begin
    perform public.admin_save_goods_notice_preset(row.id,'덮어쓰기',notice,row.updated_at - interval '1 second');
    raise exception 'stale update was allowed';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.admin_save_goods_notice_preset(null,' 아크릴 개선 ',notice,null);
    raise exception 'ambiguous duplicate name was allowed';
  exception when unique_violation then null; end;
  begin
    perform public.admin_save_goods_notice_preset(null,'필드 누락',notice - 'asContact',null);
    raise exception 'incomplete preset was allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_save_goods_notice_preset(null,'잘못된 형식',notice || '{"maker":3}',null);
    raise exception 'non-string field was allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_delete_goods_notice_preset(row.id,row.updated_at - interval '1 second');
    raise exception 'stale deletion was allowed';
  exception when sqlstate 'PT409' then null; end;
end $$;

-- N11(D1): 칸을 비워 둘 수 있다. 비운 칸은 빈 글로 저장되고, 공백만 적은 칸도 빈 칸이다(가져오는 쪽이 빈 칸은 상품의 값을 건드리지 않는다).
select public.admin_save_goods_notice_preset(null, '키링 공통',
  '{"maker":"아이콘스","origin":"대한민국","material":"아크릴","size":"","madeOn":"  ","asManager":"엑스스퀘어 고객센터","asContact":"02-000-0000"}', null) as partial_id \gset
select 1 / case when exists (
  select 1 from public.goods_notice_presets where id = :'partial_id'
    and maker = '아이콘스' and origin = '대한민국' and material = '아크릴' and size = '' and made_on = ''
    and as_manager = '엑스스퀘어 고객센터' and as_contact = '02-000-0000'
) then 1 else 0 end as assert_blank_fields_saved_as_empty;
-- 채워 둔 칸을 나중에 비울 수 있고, 한 칸만 남겨도 된다.
select updated_at as partial_updated_at from public.goods_notice_presets where id = :'partial_id' \gset
select public.admin_save_goods_notice_preset(:'partial_id', '키링 공통',
  '{"maker":"","origin":"","material":"아크릴","size":"","madeOn":"","asManager":"","asContact":""}', :'partial_updated_at');
select 1 / case when exists (
  select 1 from public.goods_notice_presets where id = :'partial_id'
    and maker = '' and origin = '' and material = '아크릴' and size = '' and made_on = '' and as_manager = '' and as_contact = ''
    and updated_at > :'partial_updated_at'
) then 1 else 0 end as assert_filled_fields_can_be_blanked;

do $$ declare row public.goods_notice_presets;
  blank jsonb := '{"maker":"","origin":" ","material":"","size":"","madeOn":"\t","asManager":"","asContact":""}';
begin
  select * into row from public.goods_notice_presets where name = '키링 공통';
  -- 일곱 칸이 모두 빈 템플릿은 새로 만들 수도, 있던 템플릿을 그렇게 고칠 수도 없다. KC 유형 틀만 있어도 같다.
  begin
    perform public.admin_save_goods_notice_preset(null,'빈 템플릿',blank,null);
    raise exception 'empty preset was allowed';
  exception when invalid_parameter_value then if sqlerrm <> 'goods_notice_preset_empty' then raise; end if; end;
  begin
    perform public.admin_save_goods_notice_preset(row.id,row.name,blank,row.updated_at);
    raise exception 'emptying a preset was allowed';
  exception when invalid_parameter_value then if sqlerrm <> 'goods_notice_preset_empty' then raise; end if; end;
  begin
    perform public.admin_save_goods_notice_preset(null,'KC 유형 틀만',
      blank || '{"kcTemplate":{"family":"living","scheme":"not_applicable","publicNote":""}}'::jsonb,null);
    raise exception 'kc-only preset was allowed';
  exception when invalid_parameter_value then if sqlerrm <> 'goods_notice_preset_empty' then raise; end if; end;
  -- 칸을 빠뜨린 요청(비운 것이 아니라 보내지 않은 것)과 1,000자를 넘는 칸은 지금처럼 거절한다.
  begin
    perform public.admin_save_goods_notice_preset(null,'칸 빠짐',(blank - 'size') || '{"maker":"제조사"}'::jsonb,null);
    raise exception 'missing key was allowed';
  exception when invalid_parameter_value then if sqlerrm <> 'invalid_goods_notice_preset' then raise; end if; end;
  begin
    perform public.admin_save_goods_notice_preset(null,'긴 칸',blank || jsonb_build_object('maker',repeat('가',1001)),null);
    raise exception 'oversized field was allowed';
  exception when invalid_parameter_value then if sqlerrm <> 'invalid_goods_notice_preset' then raise; end if; end;
  if (select updated_at from public.goods_notice_presets where id = row.id) is distinct from row.updated_at then
    raise exception 'rejected save changed the preset';
  end if;
  if exists(select 1 from public.goods_notice_presets where name in ('빈 템플릿','KC 유형 틀만','칸 빠짐','긴 칸')) then
    raise exception 'rejected save left a preset';
  end if;
end $$;

select updated_at as delete_updated_at from public.goods_notice_presets where id = :'preset_id' \gset
select public.admin_delete_goods_notice_preset(:'preset_id', :'delete_updated_at');
select 1 / case when not exists(select 1 from public.goods_notice_presets where id = :'preset_id') then 1 else 0 end as assert_delete;

reset role;
select 1 / case when exists (
  select 1 from public.audit_log where actor_id = '00000000-0000-4000-8000-000000042401'
    and action = 'catalog.goods_notice_preset.created' and target = 'goods_notice_presets:' || :'preset_id'
) then 1 else 0 end as assert_creation_audited;
-- 성공한 저장·삭제만 한 번씩 남는다: 첫 템플릿의 등록·수정·삭제 3건 + '키링 공통'의 등록·수정 2건. 거절된 저장은 남지 않는다.
select 1 / case when (
  select count(*) from public.audit_log where actor_id = '00000000-0000-4000-8000-000000042401'
    and action like 'catalog.goods_notice_preset.%'
) = 5 then 1 else 0 end as assert_crud_audit;
select 1 / case when exists (
  select 1 from public.audit_log where action = 'catalog.goods_notice_preset.updated' and target = 'goods_notice_presets:' || :'partial_id'
    and diff->'before'->>'maker' = '아이콘스' and diff->'after'->>'maker' = '' and diff->'after'->>'material' = '아크릴'
) then 1 else 0 end as assert_blanked_field_audited;
-- 표 제약: 저장 함수를 거치지 않아도 모두 빈 템플릿과 공백만 든 칸은 들어가지 않는다.
do $$ begin
  insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact)
    values('표 제약 모두 빈 칸','','','','','','','');
  raise exception 'table accepted an all-blank preset';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact)
    values('표 제약 공백 칸',' ','대한민국','','','','','');
  raise exception 'table accepted a whitespace-only field';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.goods_notice_presets(name,maker,origin,material,size,made_on,as_manager,as_contact)
    values('표 제약 긴 칸',repeat('가',1001),'','','','','','');
  raise exception 'table accepted an oversized field';
exception when check_violation then null; end $$;
select 1 / case when (
  not has_function_privilege('anon', 'public.admin_delete_goods_notice_preset(uuid,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_delete_goods_notice_preset(uuid,timestamptz)', 'execute')
) then 1 else 0 end as assert_delete_acl;

update public.profiles set suspended_at = now(), suspension_reason = '프리셋 권한 테스트' where id = '00000000-0000-4000-8000-000000042401';
set local role authenticated;
do $$ begin
  perform public.admin_save_goods_notice_preset(null,'정지 운영자','{}',null);
  raise exception 'suspended staff write was allowed';
exception when insufficient_privilege then null; end $$;
rollback;
