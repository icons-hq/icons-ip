-- D-3 ⑮ — 현금영수증 · 세금계산서 RPC (설계서 v2 §1-3)

create or replace function private.mask_identity_number(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- 뒤 네 자리만 남긴다. 화면에서 「어느 번호로 발급했는지」를 알아볼 정도면 충분하다.
  select case
    when p_value is null or pg_catalog.length(p_value) < 5 then '****'
    else pg_catalog.repeat('*', pg_catalog.length(p_value) - 4) || pg_catalog.right(p_value, 4)
  end;
$$;

create or replace function public.admin_request_cash_receipt(
  p_order_id uuid,
  p_kind public.cash_receipt_kind,
  p_identity_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_order public.orders;
  v_identity text := nullif(regexp_replace(coalesce(p_identity_number, ''), '[^0-9]', '', 'g'), '');
  v_receipt uuid;
begin
  select * into v_order from public.orders as ord where ord.id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.tax_invoice_requests as invoice
    where invoice.order_id = p_order_id and invoice.status in ('requested', 'approved', 'issued')
  ) then
    -- 같은 거래에 증빙은 하나다. 둘 다 나가면 매출이 두 번 잡힌다.
    raise exception 'tax_invoice_exists' using errcode = 'P0001';
  end if;

  -- 자진발급은 국세청 지정번호로 나간다. 상대의 인적사항을 모를 때 쓰는 길이라
  -- 번호를 받지 않고, 대신 우리가 받은 적 없다는 사실이 원장에 남는다.
  if p_kind = 'self_issued' then
    v_identity := '01000001234';
  elsif v_identity is null or char_length(v_identity) < 8 then
    raise exception 'identity_required' using errcode = '22023';
  end if;

  -- 멱등키는 이 요청 하나를 가리켜야 한다. 시각으로 만들면 `now()` 가 트랜잭션 시작 시각이라
  -- 같은 트랜잭션의 두 요청이 같은 키를 갖고, 취소 뒤 재발급이 「이미 있음」으로 막힌다.
  v_receipt := gen_random_uuid();
  insert into public.cash_receipts (
    id, order_id, kind, amount, identity_masked, idempotency_key, requested_by
  )
  values (
    v_receipt, p_order_id, p_kind, v_order.total,
    private.mask_identity_number(v_identity),
    'cash-receipt-' || v_receipt::text,
    v_actor
  );

  insert into private.cash_receipt_identities (receipt_id, identity_number)
  values (v_receipt, v_identity);

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.cash_receipt.requested', 'order:' || p_order_id::text,
          jsonb_build_object('receiptId', v_receipt, 'kind', p_kind, 'amount', v_order.total));
  return v_receipt;
exception when unique_violation then
  raise exception 'cash_receipt_already_active' using errcode = '23505';
end;
$$;

create or replace function public.admin_cancel_cash_receipt(p_receipt_id uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_receipt public.cash_receipts;
begin
  select * into v_receipt from public.cash_receipts as receipt where receipt.id = p_receipt_id for update;
  if not found then
    raise exception 'cash_receipt_not_found' using errcode = 'P0002';
  end if;
  if v_receipt.status = 'canceled' then
    return 'canceled';
  end if;
  if v_receipt.status = 'failed' then
    raise exception 'cash_receipt_not_cancelable' using errcode = 'P0001';
  end if;

  update public.cash_receipts
  set status = 'canceled', canceled_at = now(), updated_at = now(),
      error_message = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_receipt_id;
  -- 취소하면 번호를 지운다. 남겨 두면 「취소됐는데 번호가 있는」 행이 되어
  -- 다음 사람이 그 번호를 유효한 증빙으로 읽는다.
  delete from private.cash_receipt_identities where receipt_id = p_receipt_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.cash_receipt.canceled', 'order:' || v_receipt.order_id::text,
          jsonb_build_object('receiptId', p_receipt_id, 'reason', p_reason));
  return 'canceled';
end;
$$;

-- 워커가 부른다. 발급 결과(성공·실패)를 원장에 적는 유일한 문이다.
create or replace function public.record_cash_receipt_result(
  p_receipt_id uuid,
  p_status public.cash_receipt_status,
  p_receipt_key text default null,
  p_receipt_number text default null,
  p_receipt_url text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.cash_receipts
  set status = p_status,
      receipt_key = coalesce(p_receipt_key, receipt_key),
      receipt_number = coalesce(p_receipt_number, receipt_number),
      receipt_url = coalesce(p_receipt_url, receipt_url),
      issued_at = case when p_status = 'issued' then coalesce(issued_at, now()) else issued_at end,
      error_code = p_error_code,
      error_message = pg_catalog.left(p_error_message, 300),
      updated_at = now()
  where id = p_receipt_id;
  -- 발급이 끝나면 원문 번호는 더 필요 없다. 우리가 가진 이유가 사라진 순간 지운다.
  if p_status in ('issued', 'failed') then
    delete from private.cash_receipt_identities where receipt_id = p_receipt_id;
  end if;
end;
$$;

create or replace function public.claim_cash_receipt_job()
returns setof public.cash_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select receipt.id into v_id
  from public.cash_receipts as receipt
  where receipt.status = 'queued'
  order by receipt.requested_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;
  return query
  update public.cash_receipts set status = 'requested', updated_at = now()
  where id = v_id
  returning *;
end;
$$;

create or replace function public.consume_cash_receipt_identity(p_receipt_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value text;
begin
  select identity_number into v_value from private.cash_receipt_identities where receipt_id = p_receipt_id;
  return v_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- 세금계산서
-- ---------------------------------------------------------------------------
create or replace function public.admin_record_tax_invoice_request(
  p_order_id uuid,
  p_business_number text,
  p_business_name text,
  p_representative_name text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_number text := regexp_replace(coalesce(p_business_number, ''), '[^0-9]', '', 'g');
  v_request uuid;
begin
  if char_length(v_number) <> 10 then
    raise exception 'business_number_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders as ord where ord.id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.cash_receipts as receipt
    where receipt.order_id = p_order_id and receipt.status in ('queued', 'requested', 'issued')
  ) then
    raise exception 'cash_receipt_exists' using errcode = 'P0001';
  end if;

  insert into public.tax_invoice_requests (
    order_id, business_number, business_name, representative_name, email, requested_by
  )
  values (
    p_order_id, v_number, btrim(p_business_name),
    nullif(btrim(coalesce(p_representative_name, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    v_actor
  )
  returning id into v_request;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.tax_invoice.requested', 'order:' || p_order_id::text,
          jsonb_build_object('requestId', v_request, 'businessNumber', v_number));
  return v_request;
exception when unique_violation then
  raise exception 'tax_invoice_already_active' using errcode = '23505';
end;
$$;

create or replace function public.admin_decide_tax_invoice(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_request public.tax_invoice_requests;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into v_request from public.tax_invoice_requests as request
  where request.id = p_request_id for update;
  if not found then
    raise exception 'tax_invoice_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'requested' then
    raise exception 'tax_invoice_not_decidable' using errcode = 'P0001';
  end if;

  update public.tax_invoice_requests
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_by = v_actor, decided_at = now(),
      note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.tax_invoice.' || p_decision, 'order:' || v_request.order_id::text,
          jsonb_build_object('requestId', p_request_id, 'note', p_note));
  return case when p_decision = 'approve' then 'approved' else 'rejected' end;
end;
$$;

create or replace function public.admin_record_tax_invoice_issued(
  p_request_id uuid,
  p_approval_number text,
  p_issued_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_request public.tax_invoice_requests;
  v_number text := nullif(btrim(coalesce(p_approval_number, '')), '');
begin
  if v_number is null or char_length(v_number) > 60 then
    raise exception 'approval_number_invalid' using errcode = '22023';
  end if;
  select * into v_request from public.tax_invoice_requests as request
  where request.id = p_request_id for update;
  if not found then
    raise exception 'tax_invoice_not_found' using errcode = 'P0002';
  end if;
  -- 발행은 스마트빌에서 사람이 한다. 우리는 그 결과를 받아 적을 뿐이라
  -- 승인 전 건에 승인번호가 붙는 일은 없어야 한다.
  if v_request.status <> 'approved' then
    raise exception 'tax_invoice_not_approved' using errcode = 'P0001';
  end if;

  update public.tax_invoice_requests
  set status = 'issued', approval_number = v_number,
      issued_at = coalesce(p_issued_at, now()), updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.tax_invoice.issued', 'order:' || v_request.order_id::text,
          jsonb_build_object('requestId', p_request_id, 'approvalNumber', v_number));
  return 'issued';
exception when unique_violation then
  raise exception 'approval_number_taken' using errcode = '23505';
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_request_cash_receipt(uuid, public.cash_receipt_kind, text)',
    'public.admin_cancel_cash_receipt(uuid, text)',
    'public.admin_record_tax_invoice_request(uuid, text, text, text, text)',
    'public.admin_decide_tax_invoice(uuid, text, text)',
    'public.admin_record_tax_invoice_issued(uuid, text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;

  foreach v_signature in array array[
    'public.record_cash_receipt_result(uuid, public.cash_receipt_status, text, text, text, text, text)',
    'public.claim_cash_receipt_job()',
    'public.consume_cash_receipt_identity(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;
