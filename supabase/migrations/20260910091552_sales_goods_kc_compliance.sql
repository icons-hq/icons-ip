-- #477: a review records the supplied evidence; it does not decide a product's
-- legal classification. Existing public goods are deliberately not backfilled,
-- approved, unpublished, or changed by this migration.
alter table public.goods add column kc_disclosures jsonb not null default '[]'::jsonb
  check (jsonb_typeof(kc_disclosures)='array');

create table private.goods_kc_reviews (
  good_id text primary key references public.goods(id) on update cascade on delete cascade,
  revision integer not null check (revision>0),
  status text not null check (status in ('unreviewed','reviewed')),
  models jsonb not null check (jsonb_typeof(models)='array' and jsonb_array_length(models)<=50),
  context_snapshot jsonb not null,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status='reviewed' and reviewed_by is not null and reviewed_at is not null)
    or (status='unreviewed' and reviewed_by is null and reviewed_at is null))
);
create table private.goods_kc_review_events (
  good_id text not null references public.goods(id) on update cascade on delete restrict,
  revision integer not null,
  snapshot jsonb not null,
  reason text not null,
  actor_id uuid references public.profiles(id),
  changed_at timestamptz not null default clock_timestamp(),
  primary key(good_id,revision)
);
alter table private.goods_kc_reviews enable row level security;
alter table private.goods_kc_review_events enable row level security;
revoke all on private.goods_kc_reviews,private.goods_kc_review_events from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.goods_kc_reviews to postgres;
grant select,insert on private.goods_kc_review_events to postgres;

-- Match JavaScript trim for the whitespace accepted by a multiline editor.
-- A tab/newline/Unicode-space-only value can never satisfy a required field.
create function private.goods_kc_trim(p_text text) returns text
language sql immutable set search_path='' as $$
  select btrim(p_text,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)
    ||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)
    ||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
revoke all on function private.goods_kc_trim(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_trim(text) to postgres;

create function private.normalize_goods_kc_models(p_models jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare row jsonb; item jsonb; normalized jsonb; models jsonb:='[]'; field text; value text; ids jsonb; evidence jsonb;
  fields text[]:=array['family','scheme','productCategory','modelName','businessRole','businessName','identifier','publicNote','variantIds','basis','evidence'];
begin
  if p_models is null or jsonb_typeof(p_models)<>'array' or jsonb_array_length(p_models)>50 then
    raise check_violation using message='invalid_goods_kc_models';
  end if;
  for row in select elem from jsonb_array_elements(p_models) elem loop
    if jsonb_typeof(row)<>'object' or not (row ?& fields)
      or exists(select 1 from jsonb_object_keys(row) key where not(key=any(fields))) then
      raise check_violation using message='invalid_goods_kc_models';
    end if;
    normalized:='{}';
    foreach field in array array['family','scheme','productCategory','modelName','businessRole','businessName','identifier','publicNote','basis'] loop
      if jsonb_typeof(row->field)<>'string' then raise check_violation using message='invalid_goods_kc_models'; end if;
      value:=private.goods_kc_trim(row->>field);
      if length(value)>(case field when 'basis' then 2000 when 'publicNote' then 1000 when 'identifier' then 100 else 200 end)
        or (field not in ('basis','publicNote') and value ~ '[[:cntrl:]]')
        or (field in ('basis','publicNote') and replace(replace(replace(value,E'\n',''),E'\r',''),E'\t','') ~ '[[:cntrl:]]') then
        raise check_violation using message='invalid_goods_kc_models';
      end if;
      normalized:=normalized||jsonb_build_object(field,value);
    end loop;
    if normalized->>'family' not in ('','electrical','living','children','other')
      or normalized->>'scheme' not in ('','safety_certification','safety_confirmation','supplier_conformity','safety_standard_compliance','not_applicable')
      or normalized->>'businessRole' not in ('','manufacturer','importer')
      or (normalized->>'scheme'<>'' and (normalized->>'family'=''
        or (normalized->>'family'='other' and normalized->>'scheme'<>'not_applicable')
        or (normalized->>'scheme'='safety_standard_compliance' and normalized->>'family'<>'living'))) then
      raise check_violation using message='invalid_goods_kc_combination';
    end if;
    if jsonb_typeof(row->'variantIds')<>'array' or jsonb_array_length(row->'variantIds')>200 then
      raise check_violation using message='invalid_goods_kc_models';
    end if;
    for item in select elem from jsonb_array_elements(row->'variantIds') elem loop
      if jsonb_typeof(item)<>'string' or item#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise check_violation using message='invalid_goods_kc_models';
      end if;
    end loop;
    select coalesce(jsonb_agg(lower(id) order by lower(id)),'[]') into ids from jsonb_array_elements_text(row->'variantIds') id;
    if (select count(distinct lower(id)) from jsonb_array_elements_text(row->'variantIds') id)<>jsonb_array_length(ids) then
      raise check_violation using message='invalid_goods_kc_models';
    end if;
    if jsonb_typeof(row->'evidence')<>'object' or not(row->'evidence' ?& array['applicability','certificate','testReport','declaration'])
      or exists(select 1 from jsonb_object_keys(row->'evidence') key where key not in ('applicability','certificate','testReport','declaration')) then
      raise check_violation using message='invalid_goods_kc_models';
    end if;
    evidence:='{}';
    foreach field in array array['applicability','certificate','testReport','declaration'] loop
      if jsonb_typeof(row->'evidence'->field)<>'string' then raise check_violation using message='invalid_goods_kc_models'; end if;
      value:=private.goods_kc_trim(row->'evidence'->>field);
      if length(value)>500 or value ~ '[[:cntrl:]]' then raise check_violation using message='invalid_goods_kc_models'; end if;
      evidence:=evidence||jsonb_build_object(field,value);
    end loop;
    models:=models||jsonb_build_array(normalized||jsonb_build_object('variantIds',ids,'evidence',evidence));
  end loop;
  return models;
end $$;
revoke all on function private.normalize_goods_kc_models(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.normalize_goods_kc_models(jsonb) to postgres;

create function private.goods_kc_context(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('good',jsonb_build_object('ipId',good.ip_id,'name',good.name,'type',good.type,
    'maker',good.notice_maker,'origin',good.notice_origin,'material',good.notice_material,'size',good.notice_size),
    'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',variant.id,'name',variant.name,'attributes',variant.attributes,
      'active',variant.archived_at is null) order by variant.id),'[]') from public.goods_variants variant where variant.good_id=good.id))
  from public.goods good where good.id=p_good_id;
$$;
revoke all on function private.goods_kc_context(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_context(text) to postgres;

create function private.goods_kc_fingerprint(p_good_id text) returns text
language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(private.goods_kc_context(p_good_id)::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.goods_kc_fingerprint(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_fingerprint(text) to postgres;

create function private.goods_kc_review_problems(p_good_id text,p_models jsonb) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare row jsonb; errors text[]:='{}'; scheme text; covered uuid[];
begin
  if jsonb_array_length(p_models)=0 then return array['KC 모델 검토가 필요합니다.']; end if;
  for row in select elem from jsonb_array_elements(p_models) elem loop
    scheme:=row->>'scheme';
    if row->>'family'='' or scheme='' or row->>'productCategory'='' or row->>'modelName'=''
      or row->>'businessRole'='' or row->>'businessName'='' then
      errors:=array_append(errors,'제품군·제도·품목·모델·사업자를 입력해주세요.');
    end if;
    if row->>'basis'='' or row#>>'{evidence,applicability}'='' then
      errors:=array_append(errors,'적용 판단 사유와 근거 참조가 필요합니다.');
    end if;
    if jsonb_array_length(row->'variantIds')=0 then errors:=array_append(errors,'모델에 적용 옵션을 연결해주세요.'); end if;
    if exists(select 1 from jsonb_array_elements_text(row->'variantIds') id where not exists(
      select 1 from public.goods_variants variant where variant.good_id=p_good_id and variant.id=id::uuid)) then
      errors:=array_append(errors,'이 상품에 없는 옵션이 포함되어 있습니다.');
    end if;
    if scheme in ('safety_certification','safety_confirmation') then
      if row->>'identifier'='' or row#>>'{evidence,certificate}'='' then
        errors:=array_append(errors,'인증·신고번호와 해당 문서 근거가 필요합니다.');
      end if;
    elsif row->>'identifier'<>'' then
      errors:=array_append(errors,'선택한 제도에는 인증·신고번호를 입력하지 않습니다.');
    end if;
    if scheme='supplier_conformity' and (row#>>'{evidence,testReport}'='' or row#>>'{evidence,declaration}'='') then
      errors:=array_append(errors,'시험성적서와 공급자 확인서 근거가 필요합니다.');
    end if;
    if scheme='not_applicable' and row->>'publicNote'='' then
      errors:=array_append(errors,'해당 없음의 고객 안내가 필요합니다.');
    end if;
  end loop;
  select coalesce(array_agg(distinct id::uuid),'{}') into covered from jsonb_array_elements(p_models) model
    cross join lateral jsonb_array_elements_text(model->'variantIds') id;
  if exists(select 1 from public.goods_variants variant where variant.good_id=p_good_id and variant.archived_at is null
    and not(variant.id=any(covered))) then errors:=array_append(errors,'모든 사용 중인 옵션의 모델 검토가 필요합니다.'); end if;
  return errors;
end $$;
revoke all on function private.goods_kc_review_problems(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_review_problems(text,jsonb) to postgres;

-- Stopping an option does not invalidate its evidence. Re-activation is allowed
-- only when that exact option/model was covered, without an identity change.
create function private.goods_kc_covers_variant(p_good_id text,p_variant_id uuid,p_name text,p_attributes jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.goods_kc_reviews review where review.good_id=p_good_id and review.status='reviewed'
    and exists(select 1 from jsonb_array_elements(review.models) model where model->'variantIds' ? p_variant_id::text)
    and exists(select 1 from jsonb_array_elements(review.context_snapshot->'variants') variant
      where variant->>'id'=p_variant_id::text and variant->>'name'=p_name and variant->'attributes'=p_attributes));
$$;
revoke all on function private.goods_kc_covers_variant(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_covers_variant(text,uuid,text,jsonb) to postgres;

create function private.goods_kc_review_current(p_good_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.goods_kc_reviews review where review.good_id=p_good_id and review.status='reviewed'
    and review.context_snapshot->'good'=private.goods_kc_context(p_good_id)->'good'
    and cardinality(private.goods_kc_review_problems(p_good_id,review.models))=0
    and not exists(select 1 from jsonb_array_elements(review.models) model
      cross join lateral jsonb_array_elements_text(model->'variantIds') id
      left join public.goods_variants variant on variant.id=id::uuid and variant.good_id=p_good_id
      where variant.id is null or not private.goods_kc_covers_variant(p_good_id,variant.id,variant.name,variant.attributes)));
$$;
revoke all on function private.goods_kc_review_current(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_review_current(text) to postgres;

create function private.goods_kc_public_disclosures(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select jsonb_agg(jsonb_build_object('family',model->>'family','scheme',model->>'scheme',
      'productCategory',model->>'productCategory','modelName',model->>'modelName',
      'businessRole',model->>'businessRole','businessName',model->>'businessName',
      'identifier',model->>'identifier','publicNote',model->>'publicNote',
      'variants',(select jsonb_agg(jsonb_build_object('id',variant.id,'name',variant.name) order by variant.id)
        from public.goods_variants variant where variant.good_id=p_good_id and model->'variantIds' ? variant.id::text)) order by ordinal)
    from private.goods_kc_reviews review cross join lateral jsonb_array_elements(review.models) with ordinality model_entry(model,ordinal)
    where review.good_id=p_good_id and private.goods_kc_review_current(p_good_id)),'[]');
$$;
revoke all on function private.goods_kc_public_disclosures(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_public_disclosures(text) to postgres;

create function private.invalidate_goods_kc_review(p_good_id text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare changed private.goods_kc_reviews;
begin
  update private.goods_kc_reviews set revision=revision+1,status='unreviewed',reviewed_by=null,reviewed_at=null,
    updated_by=auth.uid(),updated_at=clock_timestamp() where good_id=p_good_id returning * into changed;
  if not found then return; end if;
  insert into private.goods_kc_review_events(good_id,revision,snapshot,reason,actor_id)
    values(p_good_id,changed.revision,to_jsonb(changed),p_reason,auth.uid());
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.kc_invalidated','goods:'||p_good_id,
    jsonb_build_object('revision',changed.revision,'reason',p_reason));
end $$;
revoke all on function private.invalidate_goods_kc_review(text,text) from public,anon,authenticated,service_role;
grant execute on function private.invalidate_goods_kc_review(text,text) to postgres;

create function private.guard_goods_kc() returns trigger
language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
  if new.archived_at is not null then new.published_at:=null; end if;
  if tg_op='INSERT' then
    new.kc_disclosures:='[]';
    if new.published_at is not null then raise check_violation using message='goods_kc_review_required'; end if;
    return new;
  end if;
  changed:=row(old.ip_id,old.name,old.type,old.notice_maker,old.notice_origin,old.notice_material,old.notice_size)
    is distinct from row(new.ip_id,new.name,new.type,new.notice_maker,new.notice_origin,new.notice_material,new.notice_size);
  if changed then
    if new.published_at is not null then raise check_violation using message='goods_kc_reassessment_required'; end if;
    perform private.invalidate_goods_kc_review(old.id,'goods_context_changed');
  end if;
  if new.published_at is not null and old.published_at is null and (changed or not private.goods_kc_review_current(old.id)) then
    raise check_violation using message='goods_kc_review_required';
  end if;
  -- The column cannot be supplied by any generic catalog writer, clone payload,
  -- workbook, or trusted direct update. It is always an explicit public allowlist.
  new.kc_disclosures:=case when changed then '[]'::jsonb else private.goods_kc_public_disclosures(old.id) end;
  return new;
end $$;
revoke all on function private.guard_goods_kc() from public,anon,authenticated,service_role;
grant execute on function private.guard_goods_kc() to postgres;
create trigger goods_kc_guard before insert or update of published_at,archived_at,kc_disclosures,id,ip_id,name,type,
  notice_maker,notice_origin,notice_material,notice_size on public.goods for each row execute function private.guard_goods_kc();

create function private.guard_goods_variant_kc() returns trigger
language plpgsql security definer set search_path='' as $$
declare good public.goods; target_good_id text; invalidate boolean:=false; identity_changed boolean:=false; expands boolean:=false; covered boolean:=false;
begin
  target_good_id:=case when tg_op='DELETE' then old.good_id else new.good_id end;
  select * into good from public.goods where id=target_good_id for update;
  if not found then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='DELETE' then
    invalidate:=exists(select 1 from private.goods_kc_reviews review where review.good_id=target_good_id and exists(
      select 1 from jsonb_array_elements(review.models) model where model->'variantIds' ? old.id::text));
    if good.published_at is not null and (old.archived_at is null or invalidate) then
      raise check_violation using message='goods_kc_reassessment_required';
    end if;
  elsif tg_op='INSERT' then
    expands:=new.archived_at is null;
    invalidate:=expands;
  else
    identity_changed:=row(old.name,old.attributes) is distinct from row(new.name,new.attributes);
    expands:=old.archived_at is not null and new.archived_at is null;
    covered:=private.goods_kc_covers_variant(target_good_id,new.id,new.name,new.attributes);
    invalidate:=identity_changed or (expands and not covered);
  end if;
  if good.published_at is not null and (identity_changed or (expands and not covered)) then
    raise check_violation using message='goods_kc_reassessment_required';
  end if;
  if invalidate then
    perform private.invalidate_goods_kc_review(target_good_id,'variant_context_changed');
    update public.goods set kc_disclosures='[]' where id=target_good_id;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.guard_goods_variant_kc() from public,anon,authenticated,service_role;
grant execute on function private.guard_goods_variant_kc() to postgres;
create trigger goods_variants_kc_guard before insert or delete or update of name,attributes,archived_at on public.goods_variants
  for each row execute function private.guard_goods_variant_kc();

create function public.admin_read_goods_kc(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare good public.goods; review private.goods_kc_reviews;
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  select * into good from public.goods where id=p_good_id;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select * into review from private.goods_kc_reviews where good_id=p_good_id;
  return jsonb_build_object('revision',review.revision,'status',coalesce(review.status,'unreviewed'),'models',coalesce(review.models,'[]'),
    'publishedAt',good.published_at,'archivedAt',good.archived_at,'reviewedAt',review.reviewed_at,
    'reviewerName',(select nickname from public.profiles where id=review.reviewed_by),
    'contextFingerprint',private.goods_kc_fingerprint(p_good_id),
    'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',variant.id,'code',variant.code,'name',variant.name,'active',variant.archived_at is null)
      order by variant.sort_order,variant.id),'[]') from public.goods_variants variant where variant.good_id=p_good_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',event.revision,'status',event.snapshot->>'status',
      'changedAt',event.changed_at,'actorName',actor.nickname,'reason',event.reason) order by event.revision desc),'[]')
      from (select * from private.goods_kc_review_events where good_id=p_good_id order by revision desc limit 20) event
      left join public.profiles actor on actor.id=event.actor_id));
end $$;
revoke all on function public.admin_read_goods_kc(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_goods_kc(text) to authenticated;

create function public.admin_save_goods_kc(p_good_id text,p_models jsonb,p_status text,p_expected_revision integer,
  p_expected_context_fingerprint text,p_attested boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare good public.goods; current_review private.goods_kc_reviews; changed private.goods_kc_reviews;
  models jsonb; errors text[]; next_revision integer;
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if p_status is null or p_status not in ('unreviewed','reviewed') then raise check_violation using message='invalid_goods_kc_review_status'; end if;
  models:=private.normalize_goods_kc_models(p_models);
  select * into good from public.goods where id=p_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if good.archived_at is not null then raise check_violation using message='catalog_item_archived'; end if;
  select * into current_review from private.goods_kc_reviews where good_id=p_good_id for update;
  if current_review.revision is distinct from p_expected_revision or p_expected_context_fingerprint is null
    or p_expected_context_fingerprint is distinct from private.goods_kc_fingerprint(p_good_id) then
    raise sqlstate 'PT409' using message='goods_kc_review_changed';
  end if;
  if p_status='reviewed' then
    if p_attested is distinct from true then raise check_violation using message='goods_kc_attestation_required'; end if;
    errors:=private.goods_kc_review_problems(p_good_id,models);
    if cardinality(errors)>0 then raise check_violation using message='goods_kc_review_incomplete',detail=array_to_string(errors,' '); end if;
  end if;
  if current_review.models is not distinct from models and current_review.status is not distinct from p_status then
    return jsonb_build_object('changed',false,'configuration',public.admin_read_goods_kc(p_good_id));
  end if;
  if good.published_at is not null then raise check_violation using message='goods_kc_published_edit_requires_draft'; end if;
  next_revision:=coalesce(current_review.revision,0)+1;
  insert into private.goods_kc_reviews(good_id,revision,status,models,context_snapshot,reviewed_by,reviewed_at,updated_by,updated_at)
    values(p_good_id,next_revision,p_status,models,private.goods_kc_context(p_good_id),
      case when p_status='reviewed' then auth.uid() end,case when p_status='reviewed' then clock_timestamp() end,auth.uid(),clock_timestamp())
    on conflict(good_id) do update set revision=excluded.revision,status=excluded.status,models=excluded.models,
      context_snapshot=excluded.context_snapshot,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at returning * into changed;
  insert into private.goods_kc_review_events(good_id,revision,snapshot,reason,actor_id)
    values(p_good_id,next_revision,to_jsonb(changed),case when p_status='reviewed' then 'review_completed' else 'draft_saved' end,auth.uid());
  update public.goods set kc_disclosures='[]' where id=p_good_id;
  insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'admin.good.kc_saved','goods:'||p_good_id,
    jsonb_build_object('before_status',current_review.status,'status',p_status,'revision',next_revision,'model_count',jsonb_array_length(models)));
  return jsonb_build_object('changed',true,'configuration',public.admin_read_goods_kc(p_good_id));
end $$;
revoke all on function public.admin_save_goods_kc(text,jsonb,text,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_goods_kc(text,jsonb,text,integer,text,boolean) to authenticated;

-- The existing workbook transaction may carry an explicit KC update. Omitted
-- KC data preserves the current review; an edited worksheet can only save an
-- unreviewed draft. Completing a review remains the dedicated attested action.
alter function public.admin_save_good(jsonb) set schema private;
alter function private.admin_save_good(jsonb) rename to admin_save_good_before_kc;
revoke all on function private.admin_save_good_before_kc(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.admin_save_good_before_kc(jsonb) to postgres;

create function public.admin_save_good(target_good jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare update_data jsonb; existing_id text; good public.goods; saved jsonb; before_review private.goods_kc_reviews;
  next_review private.goods_kc_reviews; model_row jsonb; code_value jsonb; ids jsonb; variant_id uuid; models jsonb:='[]';
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if not(target_good ? 'kc_update') then return private.admin_save_good_before_kc(target_good); end if;
  update_data:=target_good->'kc_update';
  if jsonb_typeof(update_data)<>'object' or not(update_data ?& array['models','expectedRevision','expectedContextFingerprint'])
    or exists(select 1 from jsonb_object_keys(update_data) key where key not in ('models','expectedRevision','expectedContextFingerprint'))
    or jsonb_typeof(update_data->'models')<>'array' or jsonb_array_length(update_data->'models')>50
    or (jsonb_typeof(update_data->'expectedRevision') not in ('null','number'))
    or (jsonb_typeof(update_data->'expectedRevision')='number' and update_data->>'expectedRevision' !~ '^[1-9][0-9]{0,9}$')
    or (jsonb_typeof(update_data->'expectedContextFingerprint') not in ('null','string')) then
    raise check_violation using message='invalid_goods_kc_import';
  end if;
  if target_good->>'publish'='true' then raise check_violation using message='goods_kc_import_review_requires_draft'; end if;
  existing_id:=coalesce(nullif(btrim(target_good->>'previous_id'),''),nullif(btrim(target_good->>'id'),''));
  select * into good from public.goods where id=existing_id for update;
  if found then
    if good.published_at is not null and target_good->>'publish' is distinct from 'false' then
      raise check_violation using message='goods_kc_published_edit_requires_draft';
    end if;
    select * into before_review from private.goods_kc_reviews where good_id=good.id for update;
    if (update_data->>'expectedRevision')::bigint is distinct from before_review.revision::bigint
      or update_data->>'expectedContextFingerprint' is distinct from private.goods_kc_fingerprint(good.id) then
      raise sqlstate 'PT409' using message='goods_kc_review_changed';
    end if;
  elsif update_data->>'expectedRevision' is not null or update_data->>'expectedContextFingerprint' is not null then
    raise sqlstate 'PT409' using message='goods_kc_review_changed';
  end if;
  saved:=private.admin_save_good_before_kc(target_good-'kc_update');
  for model_row in select elem from jsonb_array_elements(update_data->'models') elem loop
    if jsonb_typeof(model_row)<>'object' or model_row ? 'variantIds' or not(model_row ? 'variantCodes')
      or jsonb_typeof(model_row->'variantCodes')<>'array' or jsonb_array_length(model_row->'variantCodes')>200 then
      raise check_violation using message='invalid_goods_kc_import';
    end if;
    ids:='[]';
    for code_value in select elem from jsonb_array_elements(model_row->'variantCodes') elem loop
      if jsonb_typeof(code_value)<>'string' or btrim(code_value#>>'{}')='' then raise check_violation using message='invalid_goods_kc_import'; end if;
      select variant.id into variant_id from public.goods_variants variant where variant.good_id=saved->>'id' and variant.code=code_value#>>'{}';
      if not found then raise check_violation using message='goods_kc_variant_code_not_found'; end if;
      ids:=ids||jsonb_build_array(variant_id::text);
    end loop;
    models:=models||jsonb_build_array((model_row-'variantCodes')||jsonb_build_object('variantIds',ids));
  end loop;
  select * into next_review from private.goods_kc_reviews where good_id=saved->>'id';
  perform public.admin_save_goods_kc(saved->>'id',models,'unreviewed',next_review.revision,private.goods_kc_fingerprint(saved->>'id'),false);
  return saved;
end $$;
revoke all on function public.admin_save_good(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_good(jsonb) to authenticated;

alter function private.goods_import_fingerprint(text) rename to goods_import_fingerprint_before_kc;
revoke all on function private.goods_import_fingerprint_before_kc(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_import_fingerprint_before_kc(text) to postgres;
create function private.goods_import_fingerprint(target_id text) returns text
language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object('catalog',private.goods_import_fingerprint_before_kc(target_id),
    'kc_revision',(select revision from private.goods_kc_reviews where good_id=target_id))::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.goods_import_fingerprint(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_import_fingerprint(text) to postgres;

alter function public.admin_goods_import_records(text[],text[]) set schema private;
alter function private.admin_goods_import_records(text[],text[]) rename to admin_goods_import_records_before_kc;
revoke all on function private.admin_goods_import_records_before_kc(text[],text[]) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_import_records_before_kc(text[],text[]) to postgres;
create function public.admin_goods_import_records(target_codes text[] default '{}',target_ids text[] default '{}')
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return query select entry.value||jsonb_build_object('kcReview',public.admin_read_goods_kc(entry.value#>>'{good,id}'),
    'fingerprint',private.goods_import_fingerprint(entry.value#>>'{good,id}'))
    from private.admin_goods_import_records_before_kc(target_codes,target_ids) entry(value);
end $$;
revoke all on function public.admin_goods_import_records(text[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_goods_import_records(text[],text[]) to authenticated;
