-- Publish Hong Sil Quest with three representative Seoul popup goods.
-- The supplied product list has prices but no inventory quantities, so the
-- goods remain publicly browsable and non-sellable until stock is confirmed.

insert into public.ips (
  id,
  title,
  sub,
  vertical_key,
  glyph,
  bg,
  tagline,
  synopsis,
  featured,
  fans_count,
  goods_count,
  cards_count
) values (
  'hong-sil-quest',
  '홍실 퀘스트',
  'SOOP2RANG · 캐릭터 IP',
  'character',
  E'홍실\n퀘스트',
  'url("/generated/ip/hong-sil-quest.webp") center / cover no-repeat, linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)',
  '붉은 실을 따라 시작되는 특별한 퀘스트',
  '홍실 퀘스트의 현대·전생·스페셜 라운드를 실제 팝업 굿즈로 잇는 공식 IP 컬렉션입니다.',
  true,
  0,
  0,
  0
);

insert into public.goods (
  id,
  ip_id,
  name,
  type,
  price,
  badge,
  stock,
  stock_qty,
  bg
) values
  (
    'g13',
    'hong-sil-quest',
    '아크릴 블록',
    '아크릴 블록',
    12000,
    '신상',
    'soldout',
    0,
    'url("/generated/goods/g13.webp") center / cover no-repeat, linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)'
  ),
  (
    'g14',
    'hong-sil-quest',
    '오로라 아크릴 키링',
    '아크릴 키링',
    9000,
    '신상',
    'soldout',
    0,
    'url("/generated/goods/g14.webp") center / cover no-repeat, linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)'
  ),
  (
    'g15',
    'hong-sil-quest',
    '마그넷 인형 세트',
    '인형',
    27000,
    '신상',
    'soldout',
    0,
    'url("/generated/goods/g15.webp") center / cover no-repeat, linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)'
  );
