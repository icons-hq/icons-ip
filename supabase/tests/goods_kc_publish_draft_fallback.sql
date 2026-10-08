\set ON_ERROR_STOP on
-- 2026-10-07 MD 피드백 QA 결함 1: "저장 후 공개"가 KC 검토 때문에 막히면 앱(app/admin/actions.ts)이
-- 같은 입력을 공개 전환 없이(publish=null) 다시 저장한다. 그 동작이 기대는 DB 계약을 고정한다.
--   * admin_save_good은 저장을 마친 뒤 마지막에 공개로 전환하고, KC 검토가 현재가 아니면
--     goods_kc_review_required로 저장·KC 무효화까지 한 트랜잭션째 되돌린다(첫 호출 롤백).
--   * 같은 입력을 publish=null로 다시 저장하면 초안으로 저장되고, KC 맥락이 바뀌었으면 그때
--     검토가 미검토로 돌아가며 goods_context_changed 이력이 남는다.
--   * 같은 공개·다시 저장을 반복해도 KC 버전이 더 오르지 않는다(멱등).
--   * 검토를 다시 마치면 같은 저장 후 공개가 통과한다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.kc_fallback_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000100801','authenticated','authenticated','kc-fallback-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='KC초안전환100801' where id='00000000-0000-4000-8000-000000100801';
insert into public.verticals(key,label,color) values('kc-fallback-tests','KC 초안 전환 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('kc-fallback-tests','KC 초안 전환 합성검증','kc-fallback-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000100830','kc-fallback-tests','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
insert into public.goods(id,ip_id,name,type,price,image_path,origin_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('kc-fallback-good','kc-fallback-tests','합성 초안 전환 상품','문구',1000,'public-media/kc-fallback-test.webp','00000000-0000-4000-8000-000000100830',
 '합성 제조자','합성 국가','합성 소재','합성 크기','2026-10','합성 CS','02-000'),
 ('kc-fallback-none','kc-fallback-tests','합성 미검토 상품','문구',1000,'public-media/kc-fallback-test.webp','00000000-0000-4000-8000-000000100830',
 '합성 제조자','합성 국가','합성 소재','합성 크기','2026-10','합성 CS','02-000');
-- 어드민 상품 폼과 같은 전체 저장 입력(상품 + 옵션 + 기준값)을 만든다.
create function pg_temp.kc_fallback_payload(target_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',target_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[target_id]) record;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000100801',true);
select public.admin_read_goods_kc('kc-fallback-good') as fb_unset \gset
select public.admin_save_goods_kc('kc-fallback-good',jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable',
 'productCategory','','modelName','','businessRole','','businessName','','identifier','','publicNote','',
 'variantIds',(select jsonb_agg(id::text) from public.goods_variants where good_id='kc-fallback-good' and archived_at is null),'basis','',
 'evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''))),
 'reviewed',null,:'fb_unset'::jsonb->>'contextFingerprint',true) as fb_reviewed \gset
select pg_temp.kc_fallback_payload('kc-fallback-good')||jsonb_build_object('type','키링','notice_maker','바뀐 합성 제조자')
 as fb_changed \gset

-- KC 검토 뒤 유형·고시정보를 바꾸고 저장 후 공개: 마지막 공개 전환이 거절하고 저장 전체가 되돌려진다.
select pg_temp.kc_fallback_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (:'fb_changed'::jsonb||'{"publish":true}')::text),'goods_kc_review_required','23514');
select 1/case when (select type='문구' and notice_maker='합성 제조자' and published_at is null from public.goods where id='kc-fallback-good')
 and public.admin_read_goods_kc('kc-fallback-good')->>'status'='reviewed'
 and public.admin_read_goods_kc('kc-fallback-good')->>'revision'='1'
 and not exists(select 1 from public.audit_log where target='goods:kc-fallback-good' and action='admin.good.kc_invalidated')
 then 1 else 0 end as assert_publish_refusal_rolls_back_save_and_invalidation;

-- 같은 입력을 공개 전환 없이 다시 저장하면 초안으로 저장되고 검토가 무효화된 이유가 남는다.
select public.admin_save_good(:'fb_changed'::jsonb||'{"publish":null}')->>'id' as fb_retry_id \gset
select 1/case when :'fb_retry_id'='kc-fallback-good'
 and (select type='키링' and notice_maker='바뀐 합성 제조자' and published_at is null from public.goods where id='kc-fallback-good')
 and public.admin_read_goods_kc('kc-fallback-good')->>'status'='unreviewed'
 and public.admin_read_goods_kc('kc-fallback-good')->>'revision'='2'
 and public.admin_read_goods_kc('kc-fallback-good')#>>'{history,0,reason}'='goods_context_changed'
 and public.admin_read_goods_kc('kc-fallback-good')#>>'{history,0,revision}'='2'
 then 1 else 0 end as assert_draft_retry_saves_and_records_invalidation;

-- 같은 공개 요청과 다시 저장을 반복해도 KC 버전이 오르지 않는다(맥락이 이미 같다).
select pg_temp.kc_fallback_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (:'fb_changed'::jsonb||'{"publish":true}')::text),'goods_kc_review_required','23514');
select public.admin_save_good(:'fb_changed'::jsonb||'{"publish":null}') is not null as fb_retry_again;
select 1/case when public.admin_read_goods_kc('kc-fallback-good')->>'revision'='2'
 and (select count(*)=1 from public.audit_log where target='goods:kc-fallback-good' and action='admin.good.kc_invalidated')
 and (select published_at is null from public.goods where id='kc-fallback-good')
 then 1 else 0 end as assert_repeated_publish_and_retry_are_idempotent;

-- KC 검토가 원래 없던 초안도 같은 코드로 거절되고, 다시 저장은 검토 기록을 만들지 않는다.
select pg_temp.kc_fallback_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (pg_temp.kc_fallback_payload('kc-fallback-none')||'{"publish":true}')::text),'goods_kc_review_required','23514');
select public.admin_save_good(pg_temp.kc_fallback_payload('kc-fallback-none')||'{"publish":null}') is not null as fb_none_retry;
select 1/case when public.admin_read_goods_kc('kc-fallback-none')->>'revision' is null
 and public.admin_read_goods_kc('kc-fallback-none')->>'status'='unreviewed'
 and jsonb_array_length(public.admin_read_goods_kc('kc-fallback-none')->'history')=0
 and (select published_at is null from public.goods where id='kc-fallback-none')
 then 1 else 0 end as assert_missing_review_retry_stays_unrecorded;

-- 다시 검토를 마치면 같은 입력의 저장 후 공개가 통과한다.
select public.admin_read_goods_kc('kc-fallback-good') as fb_current \gset
select public.admin_save_goods_kc('kc-fallback-good',:'fb_current'::jsonb->'models','reviewed',
 (:'fb_current'::jsonb->>'revision')::integer,:'fb_current'::jsonb->>'contextFingerprint',true) is not null as fb_rereviewed;
select public.admin_save_good(pg_temp.kc_fallback_payload('kc-fallback-good')||'{"publish":true}') is not null as fb_published;
select 1/case when (select published_at is not null and type='키링' from public.goods where id='kc-fallback-good')
 then 1 else 0 end as assert_publish_after_rereview;
rollback;
