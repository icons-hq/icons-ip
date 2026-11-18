-- 카카오 알림톡 주문 안내(구매 안내가 이메일로만 가던 문제 — 10/14 회의 1014-010의 카카오톡 수단).
--
-- 발송사는 NHN Cloud 알림톡(공식 딜러사)이고, 앱은 결제 확인·발송 시작 때 이메일과 나란히 한 번 보낸다.
-- 이 migration은 두 가지를 DB에 둔다.
--   1) 받는 사람 판정 — 주문한 회원의 인증된 휴대폰 번호(private.member_phone_numbers)만 쓴다. 앱은 번호를 고르지 않는다.
--      정지·탈퇴 봉인 계정, 인증 번호가 없는 회원, 한국 휴대폰이 아닌 번호에는 보내지 않는다(알림톡은 국내 휴대폰 기준).
--   2) 한 번만 보내기 — 결제 확정 훅은 웹훅 재전송·무통장 재확정 복구로 여러 번 불린다. (안내 종류, 주문, 배송 건)마다
--      한 행을 잠가 클레임한 호출자만 보낸다. 발송은 HTTP라 트랜잭션에 넣을 수 없어 클레임 → 발송 → 결과 기록으로 나눈다.
--      · sent: 다시 보내지 않는다.
--      · failed: 발송사가 받지 않았다고 확실히 답한 경우(4xx·결과 코드 실패). 다음 훅 호출이 다시 클레임할 수 있다(최대 5번).
--      · unknown: 응답을 잃었거나(시간 초과·5xx) 클레임한 뒤 15분 안에 결과를 남기지 못했다. 발송사가 이미 받았을 수
--        있으므로 자동으로 다시 보내지 않는다 — 같은 안내가 두 번 가는 것보다 한 번 빠지는 쪽을 택한다(이메일이 함께 간다).
-- 행에는 번호·본문을 남기지 않는다(누구에게 = 회원 id, 무엇을 = 안내 종류·주문, 결과 = 상태·발송사 요청 id).
-- 이 테이블은 주문 상태의 진실원이 아니다. 발송 실패는 결제·주문·출고에 영향을 주지 않는다.

create table private.kakao_alimtalk_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  template text not null check (template in ('order_confirmation', 'order_shipped')),
  order_id uuid not null,
  shipment_id uuid,
  recipient_user_id uuid not null,
  status text not null check (status in ('pending', 'sent', 'failed', 'unknown')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 5),
  claim_token uuid not null,
  provider_request_id text check (provider_request_id is null or provider_request_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_:-]{1,80}$'),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((template = 'order_shipped') = (shipment_id is not null))
);

create index kakao_alimtalk_deliveries_order_idx on private.kakao_alimtalk_deliveries (order_id);
create index kakao_alimtalk_deliveries_status_idx on private.kakao_alimtalk_deliveries (status, claimed_at desc);

alter table private.kakao_alimtalk_deliveries enable row level security;
revoke all on table private.kakao_alimtalk_deliveries from public, anon, authenticated, service_role;

-- 클레임. ok=true를 받은 호출자만 알림톡을 보낸다. 받는 번호(국내 형식 010…)는 클레임에 성공했을 때만 돌려준다.
create function public.service_claim_kakao_alimtalk_delivery(p_template text, p_order_id uuid, p_shipment_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recipient uuid;
  phone text;
  key text;
  token uuid := extensions.gen_random_uuid();
  delivery private.kakao_alimtalk_deliveries%rowtype;
begin
  if p_template is null or p_template not in ('order_confirmation', 'order_shipped') or p_order_id is null
    or (p_template = 'order_shipped') <> (p_shipment_id is not null) then
    raise invalid_parameter_value using message = 'invalid_alimtalk_delivery_request';
  end if;

  select o.user_id into recipient from public.orders o where o.id = p_order_id;
  if recipient is null then
    return jsonb_build_object('ok', false, 'reason', 'order_missing');
  end if;
  if p_shipment_id is not null
    and not exists (select 1 from public.order_shipments s where s.id = p_shipment_id and s.order_id = p_order_id) then
    return jsonb_build_object('ok', false, 'reason', 'shipment_missing');
  end if;
  if private.is_account_write_fenced(recipient)
    or not exists (select 1 from public.profiles p where p.id = recipient and p.suspended_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  select n.phone_e164 into phone from private.member_phone_numbers n where n.user_id = recipient;
  if phone is null then
    return jsonb_build_object('ok', false, 'reason', 'no_verified_phone');
  end if;
  -- 알림톡은 국내 휴대폰(010·011·016~019)으로만 보낸다. 해외 번호는 이메일 안내만 받는다.
  if phone !~ '^\+821[016789][0-9]{7,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_number');
  end if;

  key := p_template || ':' || p_order_id::text || coalesce(':' || p_shipment_id::text, '');
  insert into private.kakao_alimtalk_deliveries (dedupe_key, template, order_id, shipment_id, recipient_user_id, status, claim_token)
    values (key, p_template, p_order_id, p_shipment_id, recipient, 'pending', token)
    on conflict (dedupe_key) do nothing
    returning * into delivery;

  if delivery.id is null then
    select * into delivery from private.kakao_alimtalk_deliveries d where d.dedupe_key = key for update;
    if delivery.status = 'sent' then
      return jsonb_build_object('ok', false, 'reason', 'already_sent');
    end if;
    if delivery.status = 'pending' and delivery.claimed_at > now() - interval '15 minutes' then
      return jsonb_build_object('ok', false, 'reason', 'in_progress');
    end if;
    if delivery.status = 'pending' then
      update private.kakao_alimtalk_deliveries
        set status = 'unknown', error_code = 'claim_expired', completed_at = now()
        where id = delivery.id;
      return jsonb_build_object('ok', false, 'reason', 'outcome_unknown');
    end if;
    if delivery.status = 'unknown' then
      return jsonb_build_object('ok', false, 'reason', 'outcome_unknown');
    end if;
    if delivery.attempt_count >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'attempts_exhausted');
    end if;
    update private.kakao_alimtalk_deliveries
      set status = 'pending', attempt_count = attempt_count + 1, claim_token = token, recipient_user_id = recipient,
        provider_request_id = null, error_code = null, claimed_at = now(), completed_at = null
      where id = delivery.id
      returning * into delivery;
  end if;

  return jsonb_build_object('ok', true, 'deliveryId', delivery.id, 'claimToken', delivery.claim_token,
    'recipientNo', '0' || substr(phone, 4));
end;
$$;

-- 결과 기록. 클레임한 호출자(claim_token)만, 아직 pending인 행만 닫는다. 늦게 온 결과는 false다.
create function public.service_complete_kakao_alimtalk_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_status text,
  p_provider_request_id text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  if p_delivery_id is null or p_claim_token is null or p_status is null or p_status not in ('sent', 'failed', 'unknown')
    or (p_provider_request_id is not null and p_provider_request_id !~ '^[A-Za-z0-9_.:-]{1,100}$')
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_:-]{1,80}$')
    or ((p_status = 'sent') <> (p_error_code is null)) then
    raise invalid_parameter_value using message = 'invalid_alimtalk_delivery_result';
  end if;
  update private.kakao_alimtalk_deliveries
    set status = p_status, provider_request_id = p_provider_request_id, error_code = p_error_code, completed_at = now()
    where id = p_delivery_id and claim_token = p_claim_token and status = 'pending';
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

alter function public.service_claim_kakao_alimtalk_delivery(text, uuid, uuid) owner to postgres;
alter function public.service_complete_kakao_alimtalk_delivery(uuid, uuid, text, text, text) owner to postgres;
revoke all on function public.service_claim_kakao_alimtalk_delivery(text, uuid, uuid),
  public.service_complete_kakao_alimtalk_delivery(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_claim_kakao_alimtalk_delivery(text, uuid, uuid),
  public.service_complete_kakao_alimtalk_delivery(uuid, uuid, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
