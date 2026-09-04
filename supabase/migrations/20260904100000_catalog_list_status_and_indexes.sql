-- 규모 슬라이스 ① — 목록 상태 파생 컬럼 + 인덱스 (통합 어드민 설계서 v2 §1-4, 리서치 보고서 D §7-1)
--
-- 어드민 굿즈 목록의 상태 탭(판매중·부족·품절·보관)은 지금까지 앱이 전량을 받아 메모리에서
-- 판정했다(`lib/admin/catalog-list.ts` adminGoodStatus). 1만 건 규모에서는 서버가 잘라야 하므로
-- 같은 규칙을 저장 생성 컬럼으로 옮긴다 — 규칙은 1:1 이고 우선순위는 보관 › 품절(운영 soldout
-- 또는 수량 0) › 부족 › 판매중 이다. 앱 쪽 판정 함수는 참조 구현으로 남긴다(패리티 테스트).
--
-- 롤백: drop index …; alter table public.goods drop column list_status;

alter table public.goods
  add column list_status text generated always as (
    case
      when archived_at is not null then 'archived'
      when stock = 'soldout' or coalesce(stock_qty, 0) <= 0 then 'soldout'
      when stock = 'low' then 'low'
      else 'selling'
    end
  ) stored;

comment on column public.goods.list_status is
  '어드민 목록 상태(파생). 보관 › 품절(soldout 또는 수량 0) › 부족 › 판매중. 앱 adminGoodStatus 와 1:1.';

-- 탭 + 기본 정렬(id)
create index goods_list_status_id_idx on public.goods (list_status, id);
-- IP 고정 필터 + 기본 정렬. (ip_id) 단일 인덱스는 이 복합 인덱스가 대체한다.
create index goods_ip_id_id_idx on public.goods (ip_id, id);
drop index if exists public.goods_ip_idx;
-- 코드 접두 검색(LIKE 'g10%'). 부분 일치는 기존 goods_name_trgm(GIN)이 맡는다.
create index goods_id_pattern_idx on public.goods (id text_pattern_ops);
-- 스토어프론트 키셋(최신순) — 공개 페이징 RPC(⑤)가 쓴다.
create index goods_created_id_idx on public.goods (created_at desc, id desc) where archived_at is null;

create index ips_id_pattern_idx on public.ips (id text_pattern_ops);
create index ips_vertical_key_id_idx on public.ips (vertical_key, id);
-- 선택기 기본 순서(팬 많은 순) — 보관 IP 는 선택기에 안 나오므로 부분 인덱스.
create index ips_active_fans_idx on public.ips (fans_count desc, id) where archived_at is null;

analyze public.goods;
analyze public.ips;
