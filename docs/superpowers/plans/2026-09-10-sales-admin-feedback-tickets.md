# 영업팀 어드민 피드백 티켓 분할안

상태: 36개 게시·전수 검증 완료 · 2026-09-10 · 부모 [#460](https://github.com/icons-hq/icons-ip/issues/460).

36개 기능 티켓으로 스펙의 사용자 스토리 79개를 모두 추적한다. 원문 36행과 1:1 대응하는 분할은 아니다. 새로운 DB/API/UI를 가로로 나누지 않고, 각 티켓이 필요한 층 전체를 지나 사용자가 확인할 수 있는 결과를 낸다.

## 착수 가능 범위

- 즉시 착수 가능 8개: [#461](https://github.com/icons-hq/icons-ip/issues/461), [#463](https://github.com/icons-hq/icons-ip/issues/463), [#464](https://github.com/icons-hq/icons-ip/issues/464), [#465](https://github.com/icons-hq/icons-ip/issues/465), [#466](https://github.com/icons-hq/icons-ip/issues/466), [#468](https://github.com/icons-hq/icons-ip/issues/468), [#469](https://github.com/icons-hq/icons-ip/issues/469), [#470](https://github.com/icons-hq/icons-ip/issues/470).
- 정책 확인이 필요한 기능 티켓 27개: 해당 기능 티켓에 미결 조건을 직접 적는다. 정책 결정만을 위한 이슈를 중복 생성하지 않는다.
- 통합 검증 T36은 구현 결과에 의존한다. 정책에 무관한 기능을 부모 스펙 전체의 Blocked 상태 때문에 묶지 않는다.
- 저장소 triage 기준에 따라 미결 정책이 있는 티켓은 ready-for-human, 나머지는 ready-for-agent로 게시했다. 정책이 해결되면 해당 티켓을 ready-for-agent로 전환하고 실제 선행 구현 상태에 따라 Project Dependency를 갱신한다.

## 게시된 티켓

1. **[#461 쿠폰 저장 실패 후 입력 복구](https://github.com/icons-hq/icons-ip/issues/461)** — **Blocked by:** 없음. **제공 결과:** 쿠폰 저장이 실패해도 입력이 남고, 잘못된 값만 고쳐 다시 저장한다.
2. **[#462 관리자 계정·로그아웃과 비밀번호 확인](https://github.com/icons-hq/icons-ip/issues/462)** — **Blocked by:** 없음. 정책 전제: P13: 로그아웃 목적지와 비밀번호 확인 표현. **제공 결과:** 사용 계정을 확인해 로그아웃하고, 합의한 관리자 복귀 동선과 비밀번호 대소문자 확인으로 다시 로그인한다.
3. **[#463 상품 입력 순서와 가격 명칭 정리](https://github.com/icons-hq/icons-ip/issues/463)** — **Blocked by:** 없음. **제공 결과:** 기본 상품·이미지→가격→옵션·재고→배송→저장 순서로 작성하고 기준 판매가·옵션 판매가·소비자가를 구별한다.
4. **[#464 IP·상품 이미지 규격과 실제 크롭 안내](https://github.com/icons-hq/icons-ip/issues/464)** — **Blocked by:** 없음. **제공 결과:** 권장 픽셀과 잘림 영역을 보며 이미지를 올리고 실제 목록·상세 크롭을 확인한다.
5. **[#465 쿠폰 검색·필터·페이지 조회](https://github.com/icons-hq/icons-ip/issues/465)** — **Blocked by:** 없음. **제공 결과:** 쿠폰 이름·코드와 상태로 검색하고 페이지를 넘겨 상세와 사용 현황을 확인한다.
6. **[#466 수취인·주문·운송장별 주문 검색](https://github.com/icons-hq/icons-ip/issues/466)** — **Blocked by:** 없음. **제공 결과:** 고객이 알려준 수취인명·주문번호·운송장번호를 검색 대상별로 선택해 정확한 주문을 찾는다.
7. **[#467 목록 문맥을 유지하는 주문 상세 열기](https://github.com/icons-hq/icons-ip/issues/467)** — **Blocked by:** 없음. 정책 전제: P13: 탭 또는 팝업의 상세 열기 방식. **제공 결과:** 발송·거래확정 등 목록에서 주문 상세를 열고 필터·페이지·선택 상태로 돌아온다.
8. **[#468 옵션 안전재고 기준과 부족 경보](https://github.com/icons-hq/icons-ip/issues/468)** — **Blocked by:** 없음. **제공 결과:** 옵션의 안전재고 기준을 저장하고, 할당 재고가 기준 이하로 내려가면 운영 화면에서 확인한다.
9. **[#469 옵션 사용 중지와 복원](https://github.com/icons-hq/icons-ip/issues/469)** — **Blocked by:** 없음. **제공 결과:** 옵션을 명시적으로 사용 중지하거나 복원하고, 공개 선택과 신규 구매가 그 상태를 따른다.
10. **[#470 영문 상품명과 국내 배송대행지 안내](https://github.com/icons-hq/icons-ip/issues/470)** — **Blocked by:** 없음. **제공 결과:** 영문 상품명을 관리하고 해외 수령 고객도 원화로 국내 배송대행지 주소에 주문한다.
11. **[#471 상품 등록의 결제수단·연령 설정 연결](https://github.com/icons-hq/icons-ip/issues/471)** — **Blocked by:** 없음. 정책 전제: G15: 지원 결제수단별 허용 조합. **제공 결과:** 상품 등록·수정에서 지원 결제수단과 19금 유형을 확인·설정하고 주문 가능 여부를 서버가 강제한다.
12. **[#472 ERP 코드·ERP 품명·바코드 저장과 조회](https://github.com/icons-hq/icons-ip/issues/472)** — **Blocked by:** 없음. 정책 전제: P03: 외부 식별자의 중복·변경·이관 규칙. **제공 결과:** 자체 상품/옵션 코드와 별도로 ERP 코드·ERP 품명·바코드를 저장하고 검색·엑셀·주문 기록에서 대조한다.
13. **[#473 IP 식별자 수정과 미사용 초안 정리](https://github.com/icons-hq/icons-ip/issues/473)** — **Blocked by:** 없음. 정책 전제: P03: IP ID/URL 변경과 삭제 허용 범위. **제공 결과:** 합의된 범위에서 IP의 표시 식별자를 고치거나 미사용 테스트 초안을 정리하고 참조 기록은 보존한다.
14. **[#474 고객용 계층 카테고리와 ERP 분류 연결](https://github.com/icons-hq/icons-ip/issues/474)** — **Blocked by:** 없음. 정책 전제: P04: 깊이·소속 수·이동/삭제·매핑 규칙. **제공 결과:** 운영자가 계층 분류를 만들고 상품에 적용하면 고객 분류·검색과 ERP 매핑에 반영된다.
15. **[#475 매입단가 입력·이력·운영 조회](https://github.com/icons-hq/icons-ip/issues/475)** — **Blocked by:** 없음. 정책 전제: P05: 세금 구분·옵션별 단가·조회 권한. **제공 결과:** 공급처에서 사오는 매입단가를 정확한 세금 구분으로 관리하고 허용된 운영 화면과 엑셀에서 조회한다.
16. **[#476 기간 할인과 옵션 할인율 표시](https://github.com/icons-hq/icons-ip/issues/476)** — **Blocked by:** 없음. 정책 전제: P05: 할인기간 경계·옵션 가격·표시 규칙. **제공 결과:** 상품 할인 기간을 설정하면 공개 가격·할인율과 실제 선택 옵션의 주문 단가가 같은 규칙을 따른다.
17. **[#477 KC 정보 입력·공개·게시 검증](https://github.com/icons-hq/icons-ip/issues/477)** — **Blocked by:** 없음. 정책 전제: P12: 상품군별 KC 유형과 필요한 증거. **제공 결과:** 상품에 적용되는 KC 정보를 등록하고 고객 고시와 공개 전 검증에 반영한다.
18. **[#478 상세 HTML 편집·미리보기·공개](https://github.com/icons-hq/icons-ip/issues/478)** — **Blocked by:** 없음. 정책 전제: P02: 지원 HTML/CSS 범위. **제공 결과:** 지원 범위의 상세 HTML을 입력해 저장 전과 공개 후 같은 상품 설명으로 확인한다.
19. **[#479 상품 전체를 별도 초안으로 복사](https://github.com/icons-hq/icons-ip/issues/479)** — **Blocked by:** 없음. 정책 전제: P03: 복제본 식별자·외부 코드와 재고 초기값. **제공 결과:** 상품의 구성·이미지·옵션·고시를 새 상품 초안으로 복사하고 원본과 구분해 이어 작성한다.
20. **[#480 상품 검색 키워드 편집과 검색 반영](https://github.com/icons-hq/icons-ip/issues/480)** — **Blocked by:** 없음. 정책 전제: P12: 키워드가 반영될 검색 범위. **제공 결과:** 운영자가 저장한 검색 키워드로 고객이 공개 상품을 찾는다.
21. **[#481 상품 진열 순서 편집과 공개 반영](https://github.com/icons-hq/icons-ip/issues/481)** — **Blocked by:** 없음. 정책 전제: P12: 진열 순서의 적용 문맥. **제공 결과:** 운영자가 정한 상품 진열 순서가 합의된 공개 목록에 일관되게 반영된다.
22. **[#482 추가구성상품 선택부터 주문까지](https://github.com/icons-hq/icons-ip/issues/482)** — **Blocked by:** 없음. 정책 전제: P12: 추가구성 관계·선택·수량·가격 조건. **제공 결과:** 상품 상세에서 추가구성상품을 선택하면 별도 품목 가격·재고·주문 기록으로 함께 구매한다.
23. **[#483 주문당 최소·최대 구매 수량](https://github.com/icons-hq/icons-ip/issues/483)** — **Blocked by:** 없음. 정책 전제: P06: 상품·옵션 합산과 주문당 수량 규칙. **제공 결과:** 상품별 최소·최대 수량을 설정하면 카트와 서버 주문이 같은 상품 합산 규칙으로 검사한다.
24. **[#484 회원별 누적 구매 한도와 회복](https://github.com/icons-hq/icons-ip/issues/484)** — **Blocked by:** [#483](https://github.com/icons-hq/icons-ip/issues/483). 정책 전제: P06: 집계 기간·유효 구매·취소/환불 회복. **제공 결과:** 회원의 유효 구매량을 누적해 한도를 강제하고 실패·취소·환불에 따른 잔여량을 일관되게 복구한다.
25. **[#485 단일 예약상품 선결제 주문과 예정일](https://github.com/icons-hq/icons-ip/issues/485)** — **Blocked by:** 없음. 정책 전제: P07: 예약기간·승인 물량·재고·발송 약속. **제공 결과:** 예약기간과 승인 물량을 갖춘 상품을 주문 시 결제하고 약속한 발송 예정일이 주문에 남는다.
26. **[#486 예약·일반 상품 혼합 배송과 일정 변경](https://github.com/icons-hq/icons-ip/issues/486)** — **Blocked by:** [#485](https://github.com/icons-hq/icons-ip/issues/485). 정책 전제: P07: 혼합 주문·묶음·예정일 변경 처리. **제공 결과:** 예약상품과 일반 상품을 함께 주문해도 발송 시점·배송비가 명확하고 약속 변경 이력이 남는다.
27. **[#487 상품·첫구매·재구매 쿠폰과 회원 혜택](https://github.com/icons-hq/icons-ip/issues/487)** — **Blocked by:** 없음. 정책 전제: P09: 발급 대상·할인 대상·구매 판정·중복 혜택. **제공 결과:** 운영자가 고객·상품별 쿠폰 조건을 설정하면 대상자와 혼합 장바구니의 할인액을 서버가 판정한다.
28. **[#488 적립금 적립·조정·잔액과 이력](https://github.com/icons-hq/icons-ip/issues/488)** — **Blocked by:** 없음. 정책 전제: P08: 적립 계기·금액·상한·만료·운영 권한. **제공 결과:** 확정된 계기로 주문 할인용 적립금이 적립되고 고객과 권한 있는 운영자가 잔액·이력을 확인한다.
29. **[#489 적립금 주문 사용과 실패·환불 복원](https://github.com/icons-hq/icons-ip/issues/489)** — **Blocked by:** [#488](https://github.com/icons-hq/icons-ip/issues/488). 정책 전제: P08: 사용 한도·쿠폰 중복·실패/환불 복원. **제공 결과:** 고객이 적립금을 주문 할인에 사용하고 결제 실패·취소·환불 시 정해진 잔액이 정확히 복원된다.
30. **[#490 배송정보 템플릿과 주소·CS 안내](https://github.com/icons-hq/icons-ip/issues/490)** — **Blocked by:** 없음. 정책 전제: P10: 템플릿 소유 범위·적용·주소·CS 규칙. **제공 결과:** 배송정보 세트를 상품에 적용하면 출고·교환/반품 주소와 고객센터 안내가 공개 화면에 반영된다.
31. **[#491 교환·반품 조건과 확인 비용 기록](https://github.com/icons-hq/icons-ip/issues/491)** — **Blocked by:** 없음. 정책 전제: P10: 제한 사유·귀책별 안내비·확인 금액 정의. **제공 결과:** 상품의 교환·반품 조건과 비용을 안내하고 CS가 확인한 금액을 클레임에 기록한다.
32. **[#492 퀵·방문수령 방식과 완료 증거](https://github.com/icons-hq/icons-ip/issues/492)** — **Blocked by:** 없음. 정책 전제: P10: 방식별 배송정보·수령 완료 증거. **제공 결과:** 택배 외 퀵·방문수령을 선택하고 방식에 맞는 정보와 증거로 발송·수령을 완료한다.
33. **[#493 제주·도서산간 배송비 계산과 안내](https://github.com/icons-hq/icons-ip/issues/493)** — **Blocked by:** 없음. 정책 전제: P10: 대상 지역·요금·묶음 적용 기준; #177 H6: 실제 물류사의 배송 가능 여부·추가 요금 회신. **제공 결과:** 국내 주소에 실제 추가요금이 적용되면 결제 전 안내하고 주문 당시 배송비로 보존한다.
34. **[#494 지연 주문 고객 일괄 안내와 재시도](https://github.com/icons-hq/icons-ip/issues/494)** — **Blocked by:** 없음. 정책 전제: P01: 채널·수신 단위·문구·예정일·발송 권한. **제공 결과:** 지연 주문을 선택해 고객용 문구를 확인하고 확정된 채널로 안내하며 일부 실패를 재시도한다.
35. **[#495 거래확정 영업·정산 검토 엑셀](https://github.com/icons-hq/icons-ip/issues/495)** — **Blocked by:** [#472](https://github.com/icons-hq/icons-ip/issues/472). 정책 전제: P11: 행 단위·ERP 품명·금액·배송비·시각 정의. **제공 결과:** 거래확정 내역을 요청한 8개 정보와 정확한 합계가 있는 영업 검토 엑셀로 받는다.
36. **[#496 신규 영업 흐름 통합 검증과 운영 안내](https://github.com/icons-hq/icons-ip/issues/496)** — **Blocked by:** [#461](https://github.com/icons-hq/icons-ip/issues/461), [#462](https://github.com/icons-hq/icons-ip/issues/462), [#463](https://github.com/icons-hq/icons-ip/issues/463), [#464](https://github.com/icons-hq/icons-ip/issues/464), [#465](https://github.com/icons-hq/icons-ip/issues/465), [#466](https://github.com/icons-hq/icons-ip/issues/466), [#467](https://github.com/icons-hq/icons-ip/issues/467), [#468](https://github.com/icons-hq/icons-ip/issues/468), [#469](https://github.com/icons-hq/icons-ip/issues/469), [#470](https://github.com/icons-hq/icons-ip/issues/470), [#471](https://github.com/icons-hq/icons-ip/issues/471), [#473](https://github.com/icons-hq/icons-ip/issues/473), [#474](https://github.com/icons-hq/icons-ip/issues/474), [#475](https://github.com/icons-hq/icons-ip/issues/475), [#476](https://github.com/icons-hq/icons-ip/issues/476), [#477](https://github.com/icons-hq/icons-ip/issues/477), [#478](https://github.com/icons-hq/icons-ip/issues/478), [#479](https://github.com/icons-hq/icons-ip/issues/479), [#480](https://github.com/icons-hq/icons-ip/issues/480), [#481](https://github.com/icons-hq/icons-ip/issues/481), [#482](https://github.com/icons-hq/icons-ip/issues/482), [#484](https://github.com/icons-hq/icons-ip/issues/484), [#486](https://github.com/icons-hq/icons-ip/issues/486), [#487](https://github.com/icons-hq/icons-ip/issues/487), [#489](https://github.com/icons-hq/icons-ip/issues/489), [#490](https://github.com/icons-hq/icons-ip/issues/490), [#491](https://github.com/icons-hq/icons-ip/issues/491), [#492](https://github.com/icons-hq/icons-ip/issues/492), [#493](https://github.com/icons-hq/icons-ip/issues/493), [#494](https://github.com/icons-hq/icons-ip/issues/494), [#495](https://github.com/icons-hq/icons-ip/issues/495). **제공 결과:** 새 상품 필드·예약·혜택·배송·영업 엑셀을 함께 사용하는 흐름을 검증하고 운영팀이 재현할 수 있는 안내를 남긴다.

## 코드 선행 관계의 이유

| 관계 | 실제로 선행하는 계약 |
|---|---|
| T23 → T24 | 주문당 수량에서 정의·검증한 상품 합산 수량을 회원 누적 한도에서도 동일하게 사용 |
| T25 → T26 | 단일 예약상품의 선결제·기간·물량·발송 약속이 있어야 일반 상품과의 혼합/일정 변경을 검증 가능 |
| T28 → T29 | 적립·정정·만료와 잔액 조회 원장이 있어야 결제 사용/복원의 대상과 잔액을 검증 가능 |
| T12 → T35 | 영업 엑셀에 필요한 ERP 품명·식별 기록과 과거 미기록 처리 계약을 먼저 확보 |
| 각 기능 → T36 | 새 기능을 함께 사용하는 운영 흐름의 통합 증거가 필요. 위 간접 선행 관계는 중복 연결하지 않음 |

같은 파일을 고칠 가능성은 작업 조율 사항이며 기능 의존성으로 간주하지 않는다. 카테고리·검색·진열·쿠폰·적립금 등을 불필요하게 직렬화하지 않는다. 독립적인 선행 리팩터링 티켓은 제안하지 않는다. 기존 편집/주문/엑셀 경계를 각 기능 안에서 필요한 만큼 정리한다. 카테고리는 기존 유형과 병행 확장해 기존 소비자를 한꺼번에 깨뜨리지 않는다.

## 게시·추적 방식

- 사용자가 “분할안을 승인하고 이대로 게시”를 선택했다. 의존 순서대로 36개 이슈를 게시했으며, 티켓별 초안과 게시 본문을 각각 보관한다.
- 새 티켓 사이의 실제 코드 의존성은 요청한 GitHub native blocking 관계와 본문의 Blocked by에 같은 참조로 연결한다. Project #8에는 Admin Ops / First Sale / Todo 및 실제 시작 가능 상태를 기록한다.
- 기존 저장소의 Project 중심 운영과 이번 스킬의 native 관계 요구를 함께 맞추기 위해, 새 티켓의 native 관계·본문·Project 요약을 하나의 분할 명세에서 생성하고 검증한다. 기존 이슈들의 관계를 이전하지 않는다.
- 정책 조건은 이슈 전체 종료와 다른 사실 조건이다. 이를 부모 #460에 대한 native 차단 관계로 만들면 부모 완료를 기다리는 순환이 생기므로 본문에 구체적으로 적는다.
- T33은 기존 #177의 H6 회신이 필요하다. #177의 다른 H1~H7 전체 종료는 필요하지 않으므로, #177 전체를 native blocker로 연결하지 않는다.
- #460은 본문·상태·라벨·native parent/sub-issue 관계를 변경하지 않는다. 티켓의 Parent 본문에서만 참조한다.
- 기존 28개 완료 기능과 8개 운영팀 인수, #451·#453은 재발행하지 않는다. 새 필드에 필요한 회귀는 각 기능의 수용 기준에 포함한다.
- 각 티켓 완료 때 현재 blocker·정책 확인 결과와 Project 상태의 동기화를 확인한다. 현재 저장소 워크플로에서 Dependency 자동 동기화 근거를 찾지 못했으므로 자동 반영을 전제하지 않는다.

## 검증

- 79개 사용자 스토리 누락 없이 매핑.
- 36개 원문 행을 대응 티켓과 기존 기능 회귀로 추적.
- 선행 구현은 앞 번호만 참조하며 순환 없음. T36의 간접 중복 선행 관계 제거.
- 티켓 본문에는 특정 구현 파일 경로나 코드 조각을 넣지 않음.
- 각 티켓에 독립 시연 결과·수용 기준·정책 조건·선행 구현을 구분.
- 이슈 36개 본문·라벨·Project 4개 필드와 native 차단 관계를 API에서 다시 읽어 전수 일치 확인.
- 라벨은 ready-for-agent 9개 / ready-for-human 27개이며, 모두 ops-feedback 포함. Project는 Todo / First Sale / Admin Ops, Unblocked 8개 / Blocked 28개.
- native 차단 관계 35개가 본문 및 승인된 분할안과 일치.
- 부모 #460의 본문 해시·OPEN 상태·라벨이 게시 전후 동일하며 부모에 native 차단 관계를 추가하지 않음.

## 승인 기록

사용자는 “분할안을 승인하고 이대로 게시 (권장)”로 승인했다. 승인된 크기와 선행 관계를 유지해 게시했다. 이 승인을 미정 제품 정책의 내용까지 승인한 것으로 해석하지 않는다.
