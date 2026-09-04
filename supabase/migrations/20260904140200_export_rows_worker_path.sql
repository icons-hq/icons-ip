-- D-4 ③ — 행 소스를 인증 경로와 워커 경로로 가른다 (설계서 v2 §1-7)
--
-- 워커는 service role 이라 auth.uid() 가 없다. 그래서 마스킹 여부를 워커의 권한이 아니라
-- **요청한 사람의 권한**으로 판단한다 — 파일을 만드는 손이 아니라 받는 손이 기준이다.

drop function if exists public.admin_export_rows(uuid, jsonb, jsonb, integer);

create or replace function private.export_rows(
  p_template_id uuid,
  p_filters jsonb,
  p_after jsonb,
  p_limit integer,
  p_unmasked boolean
)
returns table (row_key jsonb, row_data jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_template public.export_templates;
  v_unmasked boolean := p_unmasked;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_after_at timestamptz := nullif(p_after ->> 'at', '')::timestamptz;
  v_after_id uuid := nullif(p_after ->> 'id', '')::uuid;
  v_from timestamptz := nullif(p_filters ->> 'from', '')::timestamptz;
  v_to timestamptz := nullif(p_filters ->> 'to', '')::timestamptz;
  v_status text := nullif(p_filters ->> 'status', '');
  v_location text := nullif(p_filters ->> 'location_id', '');
  v_unshipped boolean := coalesce((p_filters ->> 'unshipped_only')::boolean, false);
begin
  select * into v_template from public.export_templates as template where template.id = p_template_id;
  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;
  -- 일반 양식은 가릴 것이 없다. 개인정보 양식은 호출자가 판단한 권한을 그대로 따른다.
  v_unmasked := v_template.security_level = 'normal' or p_unmasked;

  if v_template.target <> 'order_items' then
    raise exception 'unsupported_export_target' using errcode = '22023';
  end if;

  return query
  select
    jsonb_build_object('at', ord.created_at, 'id', item.id),
    jsonb_build_object(
      'mall_name', 'XSQUARE몰',
      'order_no', ord.id::text,
      'item_no', item.id::text,
      'ordered_at', pg_catalog.to_char(ord.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
      'order_kind', '일반',
      'order_status', ord.status::text,
      'good_id', item.good_id,
      'good_name', coalesce(item.good_name_snapshot, good.name),
      'variant_code', coalesce(variant.custom_code, item.variant_code_snapshot),
      'option_summary', coalesce(item.option_summary_snapshot, ''),
      'qty', item.qty,
      'unit_price', item.unit_price,
      'line_total', item.qty::bigint * item.unit_price::bigint,
      'paid_total', item.qty::bigint * item.unit_price::bigint,
      'location_name', coalesce(location.name, item.location_id),
      'location_id', item.location_id,
      'carrier_label', coalesce(carrier.label, ord.shipping_carrier),
      'tracking_number', coalesce(ord.tracking_number, ''),
      'ship_by', pg_catalog.to_char((ord.created_at + interval '1 day') at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
      -- 합포장 묶음: 같은 수취인·연락처·주소면 한 배송이다. 상자 규격은 창고가 정한다.
      'shipment_group', pg_catalog.left(pg_catalog.md5(
        coalesce(ord.address ->> 'recipientName', '') || '|' ||
        coalesce(ord.address ->> 'phone', '') || '|' ||
        coalesce(ord.address ->> 'address1', '') || coalesce(ord.address ->> 'address2', '')
      ), 8),
      'box_kind', case when count(*) over (partition by ord.id) > 1 then '합포장' else '단품' end,
      'delivery_note', coalesce(ord.address ->> 'deliveryNote', ''),
      'orderer_name', case when v_unmasked then coalesce(ord.address ->> 'recipientName', '')
                           else private.mask_name(ord.address ->> 'recipientName') end,
      'orderer_phone', case when v_unmasked then coalesce(ord.address ->> 'phone', '')
                            else private.mask_phone(ord.address ->> 'phone') end,
      'recipient_name', case when v_unmasked then coalesce(ord.address ->> 'recipientName', '')
                             else private.mask_name(ord.address ->> 'recipientName') end,
      'recipient_phone', case when v_unmasked then coalesce(ord.address ->> 'phone', '')
                              else private.mask_phone(ord.address ->> 'phone') end,
      'recipient_postal_code', coalesce(ord.address ->> 'postalCode', ''),
      'recipient_address', case
        when v_unmasked then pg_catalog.btrim(coalesce(ord.address ->> 'address1', '') || ' ' || coalesce(ord.address ->> 'address2', ''))
        else private.mask_address(ord.address ->> 'address1')
      end
    )
  from public.order_items as item
  join public.orders as ord on ord.id = item.order_id
  join public.goods as good on good.id = item.good_id
  left join public.good_variants as variant on variant.id = item.variant_id
  left join public.stock_locations as location on location.id = item.location_id
  left join public.shipping_carriers as carrier on carrier.code = ord.shipping_carrier
  where (v_from is null or ord.created_at >= v_from)
    and (v_to is null or ord.created_at < v_to)
    and (v_status is null or ord.status::text = v_status)
    and (v_location is null or item.location_id = v_location)
    and (not v_unshipped or ord.status in ('paid', 'confirmed'))
    and (
      v_after_at is null or v_after_id is null
      or (ord.created_at, item.id) > (v_after_at, v_after_id)
    )
  order by ord.created_at, item.id
  limit v_limit;
end;
$$;


-- 인증 경로: 화면 미리보기. 권한 판단은 여기서 한다.
create or replace function public.admin_export_rows(
  p_template_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_after jsonb default null,
  p_limit integer default 1000
)
returns table (row_key jsonb, row_data jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query select * from private.export_rows(
    p_template_id, coalesce(p_filters, '{}'::jsonb), p_after, p_limit, public.is_secure_exporter()
  );
end;
$$;

-- 워커 경로: 잡을 만든 사람의 권한을 따른다. 워커 자신에게는 권한이 없다.
create or replace function private.export_rows_for_job(
  p_job_id uuid,
  p_after jsonb default null,
  p_limit integer default 1000
)
returns table (row_key jsonb, row_data jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_job public.export_jobs;
  v_unmasked boolean;
begin
  select * into v_job from public.export_jobs as job where job.id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  select exists (
    select 1
    from public.admin_permissions as permission
    where permission.user_id = v_job.requested_by
      and permission.permission = 'secure_export'
      and permission.revoked_at is null
  ) into v_unmasked;
  return query select * from private.export_rows(v_job.template_id, v_job.filters, p_after, p_limit, v_unmasked);
end;
$$;

revoke all on function private.export_rows(uuid, jsonb, jsonb, integer, boolean) from public;
revoke all on function private.export_rows_for_job(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function private.export_rows_for_job(uuid, jsonb, integer) to service_role;


-- ---------------------------------------------------------------------------
-- 큐 안전망 — 워커가 죽어도 큐가 멈추지 않게 매분 되돌린다(선례: expire-stale-checkouts).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'requeue-stale-exports',
  '* * * * *',
  $cron$select private.requeue_stale_export_jobs();$cron$
);
