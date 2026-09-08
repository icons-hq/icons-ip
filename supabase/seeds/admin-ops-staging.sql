-- Synthetic, insert-only fixtures. This file is never part of db.seed or production migrations.
-- The staging job verifies the persistent preview child and explicitly enables this session.
do $$ begin
  if current_setting('app.staging_seed_enabled', true) is distinct from 'admin-ops-v1' then
    raise exception 'staging seed requires a verified isolated staging session';
  end if;
end $$;

insert into public.verticals(key, label, color)
values ('demo-ops', '운영 연습', '#111111') on conflict do nothing;
insert into public.ips(id, title, vertical_key, published_at)
values ('demo-maple-placeholder', '[데모] 메이플 자리표시', 'demo-ops', now()) on conflict do nothing;
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty)
select 'demo-goods-' || lpad(n::text, 3, '0'), 'demo-maple-placeholder',
  '[데모] 자리표시 상품 ' || lpad(n::text, 2, '0'), '문구', 10000 + n * 100, 'ok', 500
from generate_series(1, 20) as n on conflict do nothing;

-- This synthetic customer has no password or provider identity and cannot sign in.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at)
values ('de000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'demo-customer@staging.icons.test', now(), '{"staging_fixture":"admin-ops-v1"}', '{}', now(), now())
on conflict do nothing;

insert into public.orders(id, user_id, status, total, address, created_at, updated_at, shipping_fee,
  shipped_at, delivered_at, confirmed_at, done_at)
select ('de100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'de000000-0000-4000-8000-000000000001',
  (array['paid','confirmed','shipping','delivered','done','canceled'])[1 + ((n - 1) % 6)]::public.order_status,
  10000 + (1 + ((n - 1) % 20)) * 100 + 3000,
  '{"recipientName":"데모 수령인","phone":"01000000000","postalCode":"00000","address1":"가상 주소 - 배송 금지","address2":"운영 연습 데이터","deliveryRequest":"실제 출고 금지"}'::jsonb,
  now() - interval '7 days' - n * interval '1 minute', now() - interval '1 day', 3000,
  case when ((n - 1) % 6) in (2,3,4) then now() - interval '3 days' end,
  case when ((n - 1) % 6) in (3,4) then now() - interval '2 days' end,
  case when ((n - 1) % 6) in (1,2,3,4) then now() - interval '4 days' end,
  case when ((n - 1) % 6) = 4 then now() - interval '1 day' end
from generate_series(1, 120) as n on conflict do nothing;

insert into public.order_items(id, order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot)
select ('de200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('de100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'demo-goods-' || lpad((1 + ((n - 1) % 20))::text, 3, '0'), 1,
  10000 + (1 + ((n - 1) % 20)) * 100,
  '[데모] 자리표시 상품 ' || lpad((1 + ((n - 1) % 20))::text, 2, '0'), '문구', 'demo-maple-placeholder'
from generate_series(1, 120) as n on conflict do nothing;

insert into public.inquiries(id, user_id, category, title, order_id, waiting_since, created_at, last_message_at)
select ('de300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'de000000-0000-4000-8000-000000000001', 'order', '[데모] 출고 일정 문의 ' || n,
  ('de100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  now() - n * interval '6 hours', now() - n * interval '6 hours', now() - n * interval '6 hours'
from generate_series(1, 10) as n on conflict do nothing;
insert into public.inquiry_messages(id, inquiry_id, author, author_id, body, created_at)
select ('de400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('de300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'user', 'de000000-0000-4000-8000-000000000001',
  '운영 연습용 문의입니다. 배정, 내부 메모, 답변 등록을 연습하세요. 실제 배송이나 연락은 하지 않습니다.',
  now() - n * interval '6 hours'
from generate_series(1, 10) as n on conflict do nothing;
