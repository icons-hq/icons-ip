---
status: accepted
---

# 무료 리워드 모델로 피벗하고 유료 디지털 가챠를 폐기한다

ICONS의 수집형 카드는 **유료 디지털 가챠**([ADR-0001](./0001-paid-digital-gacha.md))가 아니라 **실물 굿즈 구매·미션·게임·래플의 무상 리워드**로 지급한다. 충전금(선불 지갑)과 유료 뽑기를 폐기하고, 카드에 닿는 유상 경로를 코드상 만들지 않는다. [online-popup/01-report](../online-popup/01-report.md)가 밝혔듯 "무상 카드 + 실물 결제" 설계는 게임산업법 확률형 아이템 표시의무와 게임물 등급분류에서 **이중 면제**되고 형법 사행성(대가성)도 성립하지 않으며, PG 입점·법무 리스크가 낮다. ADR-0001이 수용했던 규제 부담(확률 공시·게임물 등급·전자금융 선불충전)을 지지 않기 위해 이 방향으로 확정한다.

## Considered Options

- **유료 디지털 가챠 유지 (ADR-0001)** — 브랜드 정체성·수익엔 강하지만 규제 표면이 최대이고 PG 반려·게임물 등급·전자금융 부담이 크다. 폐기.
- **무료 리워드 (채택)** — 카드는 주문 확정·미션·게임·래플의 무상 부수효과로만 발급(`grant_cards`), 유상 경로 부재를 코드로 보장. 규제 이중 면제, PG 설명 단순.

## Consequences

- **ADR-0001 supersede.** `wallets`/`wallet_ledger`·유료 `pulls`·`pull_gacha`·충전금·유상 확률 공시는 폐기 대상이며 `card_grants`(무상 발급)로 전환한다([online-popup/04-dev-spec §2·§3](../online-popup/04-dev-spec.md)).
- **코드 제거는 별도 구현 과제.** 이미 공유/적용된 [P2 가챠 migration](../../supabase/migrations/20260617090003_p2_gacha.sql)은 수정하지 않고 **신규 migration으로 비활성**한다(`main` push=production write → 사용자 확인 범위, [AGENTS.md](../../AGENTS.md)). 이 ADR은 결정만 확정한다.
- **용어 정리**: 사이트 전면·약관에서 '가챠/뽑기/충전/확률형' 유상 문구 제거(PG 컨펌 조건, [03-roadmap §0.5](../online-popup/03-roadmap.md)). '카드'는 무상 수집물로만 지칭.
- **ADR-0002(게임 미니앱)는 그대로 유효.** BM 중립으로 설계돼 있어, 결과를 정하는 서버 경로가 유료 `pull_gacha`에서 무상 `grant_cards`/`draw_raffle`/`play_game`으로 바뀌어도 아키텍처는 동일하다.
- **법무 잔여**: 게임물관리위원회 '게임물 비해당' 사전 상담, 무상 진정성 입증(상품가가 카드 유무와 무관하게 고정), 실물 청약철회 — [03-roadmap §3](../online-popup/03-roadmap.md) 체크리스트.
- **운영 전 fail-closed**: 위 법무·운영 검토가 끝날 때까지 카드 리워드 전역 DB gate를 기본 OFF로 둔다. 신규 발급·개봉·게임·운영 활성화와 공개 CTA는 닫고 기존 보유 카드 바인더 조회만 유지한다. 활성화는 별도 검토 증거와 migration을 요구한다.
- **되돌리기 비용**: 지갑 장부·RNG·법무 스탠스가 얽혀 재전환 비용이 크다 — 그래서 이 ADR로 기록한다.

상세 근거는 [online-popup/01-report §1](../online-popup/01-report.md), 무료 모델 스펙은 [02-prd](../online-popup/02-prd.md)·[04-dev-spec](../online-popup/04-dev-spec.md) 참조.
