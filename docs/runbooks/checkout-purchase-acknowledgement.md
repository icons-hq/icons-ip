# 주문서 결제 전 확인 동의와 사업자정보 확인 링크

원장 PAY-015(주문 내용 확인·결제 동의, 청약철회 제한 재고지)와 CUS-092·CAT-066(사업자정보 확인 링크)의 구현 기준이다.

## 동작

- 두 주문서(기본 `Checkout`, 거래 런타임 `GoodsTransactionCheckout`)가 결제 버튼(무통장은 "주문하고 입금 안내 받기") 바로 위에 필수 체크박스를 둔다. 체크 전에는 버튼이 잠긴다. 장바구니 전체·선택 주문·바로구매·카드·무통장 모두 같다.
- 서버 액션(`placeOrderAction`·`placeCartTransactionAction`)은 동의 값이 정확히 `true`가 아니면 주문을 만들기 전에 `acknowledgement_required`로 거절한다. 거래 런타임의 복구(`resumeCartTransactionAction`)는 동의를 받은 표식(`purchaseAcknowledged`)만 새 주문을 만들 수 있고(`p_allow_new`), 표식이 없으면 같은 키의 기존 주문만 돌려받는다.
- 주문이 거절되면 바뀐 내용을 다시 확인하도록 체크를 푼다. 체크는 저장하지 않으므로 결제 화면에서 "다시 시도"로 돌아와도 다시 받는다.
- 청약철회·교환이 제한된 굿즈(`goods.claim_return_allowed`·`claim_exchange_allowed`가 false, 사유는 `claim_restriction_reason`)이 주문서에 있으면 품목 줄에 "청약철회·교환 제한 — {사유}"가 보이고 동의 문구에 "청약철회가 제한되는 굿즈가 포함되어 있음을 확인"이 더해진다. 제한 굿즈 목록은 `/checkout` 페이지가 서버에서 한 번에 읽어 두 주문서에 넘긴다(읽기에 실패하면 고지만 빠지고 주문은 막지 않는다).

## 제한 고지 대조(fail-closed)와 선물·정기구매

- 제한 굿즈는 이 주문서 품목의 굿즈 id로만 한정하고 **사용자 세션**(공개 RLS `goods_public_read`)으로 읽어 화면 prop으로 내린다. 성인 인증 없는 회원에게 19금·미공개 굿즈의 id·사유가 새지 않는다. 못 읽으면 `null`(확인 불가)이고 화면은 일반 고지("제한 안내를 불러오지 못했어요")를 보인다.
- 화면은 실제로 보인 제한 굿즈 id 목록(읽기 실패면 `'unavailable'`)을 서버 액션에 함께 보낸다. 서버는 **주문 생성 전에** 같은 품목을 service client로 다시 읽어, 화면에 없던 제한 굿즈가 있으면 주문하지 않고 `claim_notice_changed`("청약철회·교환 제한 안내가 바뀌었어요. 주문서를 다시 확인해주세요")로 거절한다. 체크는 풀리고 주문서가 새로 읽힌다. 서버가 못 읽으면 `unavailable`로 거절한다. 보인 목록은 동의 기록(`screen_notice`)에 남는다.
- 선물 결제(`placeGiftAction`)도 같은 체크박스·서버 거절·대조·기록을 거친다. 이미 만든 주문의 재확인(replay)은 동의 없이 원 주문을 돌려준다.
- 정기구매 주문은 정기구매 자체 약관 동의(`p_consent`·`p_terms_id`)로 받으므로 이 기록 대상이 아니다. 어드민 주문 상세는 이 경우 "동의 기록이 없습니다"로 보인다.

## 기록

- 주문 RPC는 바꾸지 않는다. 주문 생성 직후 서버가 service_role RPC `record_order_purchase_acknowledgement`로 `private.order_purchase_acknowledgements`(주문당 1행)에 동의 시각, 고지 문구 버전(`CHECKOUT_ACKNOWLEDGEMENT_VERSION`), 그 주문 품목 중 제한 굿즈 스냅샷(DB가 주문 품목과 굿즈 행에서 직접 읽는다)을 남긴다. 같은 주문의 재호출은 첫 기록을 유지한다(멱등).
- 기록이 실패해도 이미 만든 주문과 결제 흐름은 그대로다. 서버가 한 번 다시 시도하고, 그래도 실패하면 `[checkout/acknowledgement] record failed` 오류 로그만 남긴다. 기록이 없는 주문(이 기능 이전 주문 포함)은 운영자 주문 상세의 "결제 전 확인 동의" 칸에 "동의 기록이 없습니다"로 보이며, 기록이 없다는 것이 주문·결제의 이상을 뜻하지는 않는다.
- 운영자는 주문 상세(팝업 포함)에서 `admin_order_purchase_acknowledgement`(sales.read)로 읽는다. 보존 기간은 주문(거래기록)과 같고 주문이 삭제되면 함께 지워진다. 별도 파기 작업은 없다.
- 고지 문구를 바꿔 고객이 읽는 내용이 달라지면 `lib/checkout-acknowledgement.ts`의 `CHECKOUT_ACKNOWLEDGEMENT_VERSION`을 올린다.

## 사업자정보 확인 링크

푸터 사업자 정보의 사업자등록번호 옆 "사업자정보 확인"은 `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=<숫자 10자리>`(공정거래위원회 통신판매 사업자정보 조회)로 새 창에서 연다. 번호가 숫자 10자리가 아니면 링크를 숨긴다. 이 주소 형식은 저장소에 근거가 없어 2026-11-19에 해당 주소가 "통신판매 사업자정보 조회" 화면으로 응답하는 것을 확인했다. 공정위가 주소를 바꾸면 `lib/legal/business-info.ts`의 `businessRegistrationVerifyHref` 한 곳을 고친다. 개인정보 보호책임자 성명 표기는 처리방침 개정 절차에 속해 이번 범위가 아니다.
