-- D-4c ① — 업로드 종류에 「굿즈 일괄 등록/수정」을 더한다 (설계서 v2 §1-7)
--
-- enum 에 값을 더한 트랜잭션 안에서는 그 값을 쓸 수 없다. 그래서 이 파일은 값 추가만 하고,
-- 값을 쓰는 함수는 다음 마이그레이션에 둔다(파일마다 트랜잭션이 따로 커밋된다).

alter type public.import_kind add value if not exists 'goods_upsert';
