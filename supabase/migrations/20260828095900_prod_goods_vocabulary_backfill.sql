-- 운영 goods 어휘 백필 — 바로 뒤 20260828100000_goods_commerce_core 의
-- goods_type_check·goods_badge_check 가 적용되기 위한 선행 정리다.
--
-- White Catalog 전환(main 94df3ab)의 첫 프로덕션 배포에서 두 CHECK 가 운영
-- 실데이터에 걸려 push 가 멈췄다(23514). CHECK 는 S4 에서 정한 어휘 계약이고,
-- 운영 행 20건이 그 이전 자유 입력 어휘를 들고 있었다: type 7행('봉제인형'·
-- '아크릴 스탠드'·'아크릴 블록'·'아크릴 키링'·'한정 세트'·'카드'), badge 13행
-- ('신상'·'예약'·'한정').
--
-- 매핑은 2026-09-01 운영 승인 사항이다:
--   type  봉제인형→인형 · 아크릴 스탠드/블록→아크릴 · 아크릴 키링→키링 ·
--         한정 세트→세트 · 카드(실물 랜덤 포토카드 1건)→문구(추후 어드민에서
--         재분류 가능 — 허용 목록 안 이동은 굿즈 폼이 지원한다)
--   badge 신상→NEW · 한정→EXCLUSIVE · 예약→제거(대응 어휘 없음 — S4 뱃지
--         계약은 NEW/EXCLUSIVE 뿐이고 SALE 은 할인가에서 파생된다)
--
-- id 가 아니라 값 기반 UPDATE 다 — 시드·프리뷰처럼 구 어휘가 없는 DB 에서는
-- 0행으로 조용히 지나가고, 구 어휘가 남은 어떤 환경에서든 같은 규칙으로
-- 정리된다. 이 파일이 CHECK 마이그레이션보다 빠른 타임스탬프를 갖는 것이
-- 계약의 전부다: 미적용 환경에서는 항상 백필 → CHECK 순서로 돈다.

update public.goods set type = '인형' where type = '봉제인형';
update public.goods set type = '아크릴' where type in ('아크릴 스탠드', '아크릴 블록');
update public.goods set type = '키링' where type = '아크릴 키링';
update public.goods set type = '세트' where type = '한정 세트';
update public.goods set type = '문구' where type = '카드';

update public.goods set badge = 'NEW' where badge = '신상';
update public.goods set badge = 'EXCLUSIVE' where badge = '한정';
update public.goods set badge = null where badge = '예약';
