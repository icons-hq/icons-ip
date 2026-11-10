\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('73000000-0000-4000-8000-000000000001','authenticated','authenticated','goods-relations-staff@example.test','{}','{}'),
 ('73000000-0000-4000-8000-000000000002','authenticated','authenticated','goods-relations-customer@example.test','{}','{}');
update public.profiles set role='staff' where id='73000000-0000-4000-8000-000000000001';
insert into public.ips(id,title,vertical_key,published_at) values
 ('goods-relations-qa','연관상품 검증','character',now()),('goods-relations-private-qa','비공개 연관 검증','character',null);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at)
select 'goods-relations-qa-'||key,case when key='private' then 'goods-relations-private-qa' else 'goods-relations-qa' end,
  '연관 검수 상품 '||key,'문구',1000,'ok',10,null
from unnest(array['a','b','c','draft','private','adult','archived']||array(select 'limit-'||i from generate_series(1,11) i)) key;
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'goods-relations-qa-%' and id<>'goods-relations-qa-draft';
update public.goods set sale_restriction='adult' where id='goods-relations-qa-adult';
update public.goods_variants set stock_qty=0 where good_id='goods-relations-qa-archived';
update public.goods set archived_at=now() where id='goods-relations-qa-archived';
create function pg_temp.relation_input(p_kind text default 'together',p_ids text[] default array['goods-relations-qa-a','goods-relations-qa-b','goods-relations-qa-c']) returns jsonb
language sql as $$ select jsonb_build_object('kind',p_kind,'title','함께 100%','representativeGoodId',p_ids[1],
  'enabled',true,'startsAt',null,'endsAt',null,'goodIds',to_jsonb(p_ids)) $$;
create function pg_temp.relation_good_payload(p_good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',p_good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[p_good_id]) record;
$$;

select 1/case when has_function_privilege('anon','public.get_good_relations(text)','execute')
 and not has_function_privilege('service_role','public.get_good_relations(text)','execute')
 and not has_function_privilege('anon','public.admin_save_goods_relation(uuid,integer,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_relation(uuid,integer,jsonb)','execute')
 and not has_function_privilege('authenticated','private.goods_relation_document(uuid)','execute')
 and not has_table_privilege('authenticated','public.goods_relations','insert')
 and not has_table_privilege('anon','public.goods_relation_members','select') then 1 else 0 end as assert_acl;

set local role authenticated;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.admin_get_goods_relation('74000000-0000-4000-8000-000000000001'); raise exception 'customer read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_list_goods_relations(); raise exception 'customer list allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_search_goods_for_relation(); raise exception 'customer search allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',0,pg_temp.relation_input()); raise exception 'customer save allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',0,pg_temp.relation_input());
select public.admin_save_goods_relation('74000000-0000-4000-8000-000000000002',0,pg_temp.relation_input('similar',array['goods-relations-qa-a','goods-relations-qa-c','goods-relations-qa-b','goods-relations-qa-draft','goods-relations-qa-private','goods-relations-qa-adult','goods-relations-qa-archived'])||'{"title":"유사한 굿즈"}');
do $$ declare saved jsonb; begin
 saved:=public.admin_get_goods_relation('74000000-0000-4000-8000-000000000002');
 if saved->>'revision'<>'1' or saved->'goods'->1->>'id'<>'goods-relations-qa-c' or jsonb_array_length(saved->'goods')<>7 then raise exception 'saved relation order mismatch %',saved; end if;
 if (select count(*) from jsonb_array_elements(saved->'goods') good where (good->>'public')::boolean)<>3 then raise exception 'staff public availability mismatch %',saved; end if;
 if public.admin_list_goods_relations('100%')->>'total'<>'1' then raise exception 'literal relation title search failed'; end if;
 if public.admin_list_goods_relations('goods-relations-qa-b','similar')->>'total'<>'1' then raise exception 'member relation search failed'; end if;
 if public.admin_search_goods_for_relation('goods-relations-qa-archived')->>'total'<>'0' then raise exception 'archived candidate searchable'; end if;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',0,pg_temp.relation_input()); raise exception 'duplicate new save allowed'; exception when sqlstate 'PT409' then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',0,'null'); raise exception 'null payload allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input()||'{"unknown":true}'); raise exception 'unknown field allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input('together',array['goods-relations-qa-a','missing-good'])); raise exception 'missing good allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input('together',array['goods-relations-qa-a','goods-relations-qa-a'])); raise exception 'duplicate good allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input()||'{"representativeGoodId":"goods-relations-qa-adult"}'); raise exception 'absent representative allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input('together',array['goods-relations-qa-a'])); raise exception 'one member allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input('together',array(select 'goods-relations-qa-limit-'||i from generate_series(1,7) i))); raise exception 'seven together members allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input('similar',array(select 'goods-relations-qa-limit-'||i from generate_series(1,11) i))); raise exception 'eleven similar members allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input()||'{"startsAt":"2026-10-13T12:00:00+09:00","endsAt":"2026-10-13T12:00:00+09:00"}'); raise exception 'empty period allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000003',0,pg_temp.relation_input()||'{"startsAt":"infinity"}'); raise exception 'infinite period allowed'; exception when invalid_parameter_value then null; end;
end $$;

reset role;
set local role anon;
do $$ declare a jsonb; b jsonb; begin
 a:=public.get_good_relations('goods-relations-qa-a'); b:=public.get_good_relations('goods-relations-qa-b');
 if jsonb_array_length(a->'groups')<>2 or a->'groups'->0->'goodIds'<>'["goods-relations-qa-b","goods-relations-qa-c"]'::jsonb
   or a->'groups'->1->'goodIds'<>'["goods-relations-qa-c","goods-relations-qa-b"]'::jsonb then raise exception 'representative target/order failed %',a; end if;
 if jsonb_array_length(b->'groups')<>1 or b->'groups'->0->>'kind'<>'similar'
   or b->'groups'->0->'goodIds'<>'["goods-relations-qa-a","goods-relations-qa-c"]'::jsonb then raise exception 'similar reciprocal exposure failed %',b; end if;
 if (a->'groups'->0)?'revision' or (a->'groups'->0)?'createdBy' then raise exception 'private metadata leaked'; end if;
 if public.get_good_relations('goods-relations-qa-adult')<>'{"groups":[],"nextChangeAt":null}'::jsonb
   or public.get_good_relations('goods-relations-qa-private')<>'{"groups":[],"nextChangeAt":null}'::jsonb then raise exception 'nonpublic target has relations'; end if;
end $$;
reset role;

-- Losing the representative or all other public members hides the whole block.
update public.goods set published_at=null where id='goods-relations-qa-a';
set local role anon;
select 1/case when jsonb_array_length(public.get_good_relations('goods-relations-qa-b')->'groups')=0 then 1 else 0 end as assert_representative_visibility;
reset role;
update public.goods set published_at=now() where id='goods-relations-qa-a';
update public.goods set published_at=null where id in ('goods-relations-qa-b','goods-relations-qa-c');
set local role anon;
select 1/case when jsonb_array_length(public.get_good_relations('goods-relations-qa-a')->'groups')=0 then 1 else 0 end as assert_minimum_public_members;
reset role;
update public.goods set published_at=now() where id in ('goods-relations-qa-b','goods-relations-qa-c');

-- Same statement_timestamp proves start is inclusive and end is exclusive.
do $$ begin
 update public.goods_relations set starts_at=statement_timestamp(),ends_at=statement_timestamp()+interval '1 day' where id='74000000-0000-4000-8000-000000000001';
 if not exists(select 1 from jsonb_array_elements(public.get_good_relations('goods-relations-qa-a')->'groups') item where item->>'id'='74000000-0000-4000-8000-000000000001') then raise exception 'inclusive start excluded'; end if;
 update public.goods_relations set starts_at=null,ends_at=statement_timestamp() where id='74000000-0000-4000-8000-000000000001';
 if exists(select 1 from jsonb_array_elements(public.get_good_relations('goods-relations-qa-a')->'groups') item where item->>'id'='74000000-0000-4000-8000-000000000001') then raise exception 'exclusive end included'; end if;
 update public.goods_relations set starts_at=statement_timestamp()+interval '1 hour',ends_at=null where id='74000000-0000-4000-8000-000000000001';
 if (public.get_good_relations('goods-relations-qa-a')->>'nextChangeAt')::timestamptz<>statement_timestamp()+interval '1 hour' then raise exception 'future boundary missing'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',1,pg_temp.relation_input('together',array['goods-relations-qa-b','goods-relations-qa-c','goods-relations-qa-a'])||'{"title":"순서변경검수","enabled":false}');
do $$ declare value jsonb; begin
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',1,pg_temp.relation_input()); raise exception 'stale overwrite allowed'; exception when sqlstate 'PT409' then null; end;
 value:=public.admin_get_goods_relation('74000000-0000-4000-8000-000000000001');
 if value->>'revision'<>'2' or value->>'state'<>'stopped' or value->>'representativeGoodId'<>'goods-relations-qa-b'
   or value->'goods'->1->>'id'<>'goods-relations-qa-c' then raise exception 'saved change overwritten %',value; end if;
 if public.admin_list_goods_relations('순서변경검수','all','stopped')->>'total'<>'1' then raise exception 'stopped filter failed'; end if;
end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where target='goods_relation:74000000-0000-4000-8000-000000000001')=2
 and exists(select 1 from public.audit_log where target='goods_relation:74000000-0000-4000-8000-000000000001'
   and diff#>>'{before,revision}'='1' and diff#>>'{after,revision}'='2' and diff#>>'{after,goods,0,id}'='goods-relations-qa-b')
 then 1 else 0 end as assert_single_audited_save_and_order;
set local role authenticated;
do $$ begin
 for index in 1..21 loop
 perform public.admin_save_goods_relation(('75000000-0000-4000-8000-'||lpad(index::text,12,'0'))::uuid,0,pg_temp.relation_input()||jsonb_build_object('title','페이지 검수 '||index,'enabled',false));
 end loop;
 if public.admin_list_goods_relations('페이지 검수','all','all',2,20)->>'total'<>'21'
  or jsonb_array_length(public.admin_list_goods_relations('페이지 검수','all','all',2,20)->'rows')<>1 then raise exception 'relation pagination failed'; end if;
end $$;
-- Existing draft URL edits must remain usable while the draft is pre-arranged.
select public.admin_save_goods_relation('74000000-0000-4000-8000-000000000004',0,
  pg_temp.relation_input('similar',array['goods-relations-qa-draft','goods-relations-qa-b']));
select public.admin_save_good(pg_temp.relation_good_payload('goods-relations-qa-draft')||'{"id":"goods-relations-qa-draft-renamed"}');
select 1/case when public.admin_get_goods_relation('74000000-0000-4000-8000-000000000004')->>'representativeGoodId'='goods-relations-qa-draft-renamed'
 and public.admin_get_goods_relation('74000000-0000-4000-8000-000000000004')#>>'{goods,0,id}'='goods-relations-qa-draft-renamed'
 then 1 else 0 end as assert_draft_id_cascades;
reset role;
select pg_temp.publish_goods_kc_fixture('goods-relations-qa-draft-renamed');
set local role anon;
select 1/case when exists(select 1 from jsonb_array_elements(public.get_good_relations('goods-relations-qa-b')->'groups') item
 where item->>'id'='74000000-0000-4000-8000-000000000004' and item->'goodIds'='["goods-relations-qa-draft-renamed"]'::jsonb)
 then 1 else 0 end as assert_renamed_draft_public_readback;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
select 1/case when (select count(*) from public.goods_relations)=0 and (select count(*) from public.goods_relation_members)=0 then 1 else 0 end as assert_customer_rls;
reset role;
update public.profiles set suspended_at=now(),suspension_reason='검수' where id='73000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform public.admin_save_goods_relation('74000000-0000-4000-8000-000000000001',2,pg_temp.relation_input()); raise exception 'suspended staff allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
