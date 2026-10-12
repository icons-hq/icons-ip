-- 남양주(서원) 출고지 사용 시작 (2026-10-12).
--
-- 서원 회신: 계약 택배사는 우체국택배(D1), 출고 취합 마감은 오전 10시(A4·C1). 우체국택배가
-- 택배사 레지스트리에 없어 남양주를 켤 수 없었다 — 활성 출고지는 기본 택배사가 필수다.
-- 남양주 배송비는 시드값 0원이라 그대로 켜면 무료배송이 된다. 고객 배송비는 이 시점의 김포 정책
-- (기본 배송비·무료 기준)을 복사해 시작하고, 이후 값은 어드민 출고지 설정이 소유한다.
--
-- 운영자가 이미 우체국 택배사를 다른 코드로 등록했거나 남양주를 직접 설정했다면(택배사 지정·
-- 배송비 변경·활성) 그 값을 덮어쓰지 않는다. 우체국 택배사가 있지만 모두 비활성이면 운영 판단으로
-- 보고 새로 만들거나 남양주를 켜지 않는다.
do $$
declare carrier_code text;
begin
  select code into carrier_code from public.shipping_carriers
    where is_active and (code = 'epost' or label like '%우체국%')
    order by code <> 'epost', sort_order, code limit 1;
  if carrier_code is null then
    if exists (select 1 from public.shipping_carriers where code = 'epost' or label like '%우체국%') then return; end if;
    insert into public.shipping_carriers (code, label, is_active, tracking_url_template, sort_order)
    values ('epost', '우체국택배', true,
      'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1={trackingNumber}', 20);
    carrier_code := 'epost';
  end if;
  update public.fulfillment_origins origin
     set default_carrier = carrier_code,
         base_fee = coalesce((select base_fee from public.fulfillment_origins where code = 'gimpo'), 3000),
         free_threshold = case when exists (select 1 from public.fulfillment_origins where code = 'gimpo')
           then (select free_threshold from public.fulfillment_origins where code = 'gimpo') else 50000 end,
         cutoff = '10:00', is_active = true,
         updated_at = greatest(clock_timestamp(), origin.updated_at + interval '1 microsecond')
   where origin.code = 'namyangju' and origin.default_carrier is null and not origin.is_active
     and origin.base_fee = 0 and origin.free_threshold is null;
end $$;
