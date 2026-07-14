-- Restore the immutable public catalog baseline after the old mock cleanup.
-- Every catalog insert is additive: existing operator-managed rows and stock win.

insert into public.verticals (key, label, color) values
  ('character', '캐릭터 IP', '#FFD84D'),
  ('game', '게임', '#38F0C0'),
  ('anime', '애니메이션', '#A981FF')
on conflict do nothing;

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
) values
  (
    'rilakkuma',
    '리락쿠마',
    'San-X · 캐릭터 IP',
    'character',
    E'리락\n쿠마',
    'url("/generated/ip/rilakkuma.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
    '느긋한 하루를 수집하는 시간',
    '리락쿠마의 포근한 방을 ICONS 굿즈, 카드, 팝업으로 재구성한 라이선스 mock 컬렉션입니다.',
    true,
    124500,
    2,
    2
  ),
  (
    'maplestory',
    '메이플스토리',
    'NEXON · 게임',
    'game',
    'MAPLE',
    'url("/generated/ip/maplestory.png") center / cover no-repeat, linear-gradient(150deg, #0d5e66, #38F0C0 55%, #FFD84D)',
    '몬스터즈가 굿즈로 튀어나오는 순간',
    '주황버섯, 슬라임, 핑크빈을 중심으로 한 메이플스토리 몬스터 굿즈와 카드 라인업입니다.',
    true,
    198000,
    3,
    3
  ),
  (
    'nongdamgom',
    '담곰이',
    '캐릭터 IP',
    'character',
    '담곰이',
    'url("/generated/ip/nongdamgom.png") center / cover no-repeat, linear-gradient(150deg, #70485a, #F7A8C7 55%, #FFF3D6)',
    '말랑한 농담처럼 가벼운 굿즈',
    '담곰이와 오리친구의 단순하고 귀여운 결을 데스크 굿즈, 쿠션, 카드로 풀어낸 컬렉션입니다.',
    true,
    52300,
    2,
    2
  ),
  (
    'kakao-friends',
    '카카오프렌즈',
    'Kakao · 캐릭터 IP',
    'character',
    'KAKAO',
    'url("/generated/ip/kakao-friends.png") center / cover no-repeat, linear-gradient(150deg, #66421d, #FFD84D 55%, #FF9AAF)',
    '친구들과 떠나는 피크닉 컬렉션',
    '라이언, 춘식이, 어피치 등 카카오프렌즈 감성의 피크닉 굿즈와 미니 피규어 mock 라인입니다.',
    true,
    214000,
    3,
    3
  ),
  (
    'attack-on-titan',
    '진격의 거인',
    '리바이 에디션 · 애니메이션',
    'anime',
    'LEVI',
    'url("/generated/ip/attack-on-titan.png") center / cover no-repeat, linear-gradient(150deg, #2b251f, #6B705C 55%, #A981FF)',
    '리바이 에디션으로 완성하는 전시형 컬렉션',
    '진격의 거인 리바이의 차분한 전투 전야 무드를 피규어, 아크릴, 카드로 구성한 mock 컬렉션입니다.',
    true,
    176400,
    2,
    2
  )
on conflict do nothing;

insert into public.goods (id, ip_id, name, type, price, badge, stock, stock_qty, bg) values
  ('g1', 'rilakkuma', '리락쿠마 낮잠 쿠션', '쿠션', 42000, '한정', 'low', 7, 'url("/generated/goods/g1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)'),
  ('g2', 'rilakkuma', '코리락쿠마 미니 키링', '키링', 15000, '신상', 'ok', 120, 'url("/generated/goods/g2.png") center / cover no-repeat, linear-gradient(150deg, #7d4a2a, #F3B6C8 55%, #FFF3D6)'),
  ('g3', 'maplestory', '주황버섯 봉제인형', '봉제인형', 28000, '신상', 'ok', 90, 'url("/generated/goods/g3.png") center / cover no-repeat, linear-gradient(150deg, #98440f, #FF8C32 55%, #FFD84D)'),
  ('g4', 'maplestory', '메이플 몬스터 키링 4종', '키링', 18000, '한정', 'low', 12, 'url("/generated/goods/g4.png") center / cover no-repeat, linear-gradient(150deg, #0d5e66, #38F0C0 55%, #8B5CFF)'),
  ('g5', 'maplestory', '핑크빈 아크릴 디오라마', '아크릴 스탠드', 33000, '예약', 'ok', 80, 'url("/generated/goods/g5.png") center / cover no-repeat, linear-gradient(150deg, #6b2a5b, #F7A8C7 55%, #A981FF)'),
  ('g6', 'nongdamgom', '담곰이 오리친구 데스크 매트', '문구', 22000, '신상', 'ok', 110, 'url("/generated/goods/g6.png") center / cover no-repeat, linear-gradient(150deg, #70485a, #F7A8C7 55%, #FFF3D6)'),
  ('g7', 'nongdamgom', '담곰이 말랑 쿠션', '쿠션', 36000, null, 'ok', 60, 'url("/generated/goods/g7.png") center / cover no-repeat, linear-gradient(150deg, #51343f, #F7A8C7 55%, #FFD84D)'),
  ('g8', 'kakao-friends', '춘식이 수면 파우치', '파우치', 24000, '신상', 'ok', 100, 'url("/generated/goods/g8.png") center / cover no-repeat, linear-gradient(150deg, #66421d, #FFD84D 55%, #FFF3D6)'),
  ('g9', 'kakao-friends', '라이언&어피치 피크닉 세트', '한정 세트', 59000, '한정', 'low', 8, 'url("/generated/goods/g9.png") center / cover no-repeat, linear-gradient(150deg, #724a1f, #FFD84D 55%, #FF9AAF)'),
  ('g10', 'kakao-friends', '카카오프렌즈 미니 피규어팩', '피규어', 32000, null, 'ok', 140, 'url("/generated/goods/g10.png") center / cover no-repeat, linear-gradient(150deg, #3d5b7d, #FFD84D 55%, #FF9AAF)'),
  ('g11', 'attack-on-titan', '리바이 아크릴 스탠드', '아크릴 스탠드', 26000, '예약', 'ok', 70, 'url("/generated/goods/g11.png") center / cover no-repeat, linear-gradient(150deg, #2b251f, #6B705C 55%, #A981FF)'),
  ('g12', 'attack-on-titan', '조사병단 리바이 피규어', '피규어', 89000, '한정', 'soldout', 0, 'url("/generated/goods/g12.png") center / cover no-repeat, linear-gradient(150deg, #201c18, #4C5A3F 55%, #A981FF)')
on conflict do nothing;

insert into public.cards (id, ip_id, name, no, rarity, bg) values
  ('c1', 'rilakkuma', '리락쿠마 · 낮잠 시간', '001/080', 'HOLO', 'url("/generated/cards/c1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)'),
  ('c2', 'rilakkuma', '코리락쿠마 · 딸기 우유', '014/080', 'SR', 'url("/generated/cards/c2.png") center / cover no-repeat, linear-gradient(150deg, #7d4a2a, #F3B6C8 55%, #FFF3D6)'),
  ('c3', 'maplestory', '주황버섯 · 점프!', '003/120', 'SSR', 'url("/generated/cards/c3.png") center / cover no-repeat, linear-gradient(150deg, #98440f, #FF8C32 55%, #FFD84D)'),
  ('c4', 'maplestory', '슬라임 · 말랑 에너지', '018/120', 'R', 'url("/generated/cards/c4.png") center / cover no-repeat, linear-gradient(150deg, #0d5e66, #38F0C0 55%, #2DE2FF)'),
  ('c5', 'maplestory', '핑크빈 · 스테이지', '041/120', 'HOLO', 'url("/generated/cards/c5.png") center / cover no-repeat, linear-gradient(150deg, #6b2a5b, #F7A8C7 55%, #A981FF)'),
  ('c6', 'nongdamgom', '담곰이 · 오리친구', '009/060', 'SSR', 'url("/generated/cards/c6.png") center / cover no-repeat, linear-gradient(150deg, #70485a, #F7A8C7 55%, #FFF3D6)'),
  ('c7', 'nongdamgom', '담곰이 · 산책', '027/060', 'R', 'url("/generated/cards/c7.png") center / cover no-repeat, linear-gradient(150deg, #51343f, #F7A8C7 55%, #FFD84D)'),
  ('c8', 'kakao-friends', '라이언 · 피크닉', '012/100', 'SSR', 'url("/generated/cards/c8.png") center / cover no-repeat, linear-gradient(150deg, #66421d, #FFD84D 55%, #FFF3D6)'),
  ('c9', 'kakao-friends', '춘식이 · 낮잠', '033/100', 'HOLO', 'url("/generated/cards/c9.png") center / cover no-repeat, linear-gradient(150deg, #724a1f, #FFD84D 55%, #FF9AAF)'),
  ('c10', 'kakao-friends', '어피치 · 스윗팝', '054/100', 'SR', 'url("/generated/cards/c10.png") center / cover no-repeat, linear-gradient(150deg, #7d344d, #FF9AAF 55%, #FFD84D)'),
  ('c11', 'attack-on-titan', '리바이 · 결전 전야', '001/070', 'HOLO', 'url("/generated/cards/c11.png") center / cover no-repeat, linear-gradient(150deg, #2b251f, #6B705C 55%, #A981FF)'),
  ('c12', 'attack-on-titan', '리바이 · 조사병단', '017/070', 'SSR', 'url("/generated/cards/c12.png") center / cover no-repeat, linear-gradient(150deg, #201c18, #4C5A3F 55%, #A981FF)')
on conflict do nothing;

insert into public.events (id, ip_id, title, mode, status, starts_at, ends_at, location, accent, bg) values
  ('e1', 'rilakkuma', '리락쿠마 포근한 방 팝업스토어', '오프라인', '진행중', '2026-07-01 00:00:00+09', '2026-07-21 23:59:00+09', '성수 ICONS 스튜디오', '#FFD84D', 'url("/generated/events/e1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)'),
  ('e2', 'maplestory', '메이플스토리 몬스터즈 온라인 팝업', '온라인', '예매중', '2026-07-12 20:00:00+09', null, 'ICONS Live', '#38F0C0', 'url("/generated/events/e2.png") center / cover no-repeat, linear-gradient(150deg, #0d5e66, #38F0C0 55%, #FFD84D)'),
  ('e3', 'nongdamgom', '담곰이 드로잉 굿즈 팝업', '오프라인', '예정', '2026-07-19 00:00:00+09', '2026-08-02 23:59:00+09', '홍대 ICONS 팝업', '#F7A8C7', 'url("/generated/events/e3.png") center / cover no-repeat, linear-gradient(150deg, #70485a, #F7A8C7 55%, #FFF3D6)'),
  ('e4', 'kakao-friends', '카카오프렌즈 피크닉 팝업', '오프라인', '예매중', '2026-07-26 00:00:00+09', '2026-08-11 23:59:00+09', '여의도 ICONS 팝업', '#FFD84D', 'url("/generated/events/e4.png") center / cover no-repeat, linear-gradient(150deg, #66421d, #FFD84D 55%, #FF9AAF)'),
  ('e5', 'attack-on-titan', '진격의 거인 리바이 에디션 온라인 팝업', '온라인', '예정', '2026-08-08 21:00:00+09', null, 'ICONS Live', '#A981FF', 'url("/generated/events/e5.png") center / cover no-repeat, linear-gradient(150deg, #2b251f, #6B705C 55%, #A981FF)')
on conflict do nothing;

insert into public.card_pools (id, ip_id, name) values
  ('a0000000-0000-4000-8000-000000000001', 'maplestory', '메이플 몬스터즈 무상 리워드 풀')
on conflict do nothing;

insert into public.pool_odds (pool_id, rarity, probability) values
  ('a0000000-0000-4000-8000-000000000001', 'R', 0.70000),
  ('a0000000-0000-4000-8000-000000000001', 'SSR', 0.20000),
  ('a0000000-0000-4000-8000-000000000001', 'HOLO', 0.10000)
on conflict do nothing;

update public.cards
set pool_id = 'a0000000-0000-4000-8000-000000000001'
where id = any (array['c3', 'c4', 'c5'])
  and ip_id = 'maplestory'
  and pool_id is null;

insert into public.games (id, type, title, event_id, config, reward_pool_id, per_user_daily_limit) values
  (
    'marble-maple',
    'marble_roulette',
    '메이플 마블 룰렛',
    'e2',
    '{"marbleCount":10,"variant":{"kind":"card","rarityLineup":["R","R","R","R","R","R","R","SSR","SSR","HOLO"]}}',
    'a0000000-0000-4000-8000-000000000001',
    1
  ),
  (
    'goods-marble',
    'marble_roulette',
    '굿즈 마블 룰렛',
    null,
    '{"marbleCount":10,"variant":{"kind":"goods","goodsIds":["g1","g2","g3","g5","g6","g7","g8","g9","g11","g12"]}}',
    null,
    1
  )
on conflict do nothing;
