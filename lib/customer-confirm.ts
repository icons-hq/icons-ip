/*
 * 고객 화면 확인창의 공용 통로(2026-11-16, 원장 재작업 알려진 후속 4).
 *
 * 브라우저 기본 confirm()은 동기라 화면 언어·접근성·시험이 모두 막히고, 모바일 인앱 브라우저에서는 막히거나 문구가 잘린다.
 * 고객 표면은 셸에 한 번 마운트한 `CustomerConfirmHost`(White Catalog 가운데 작은 모달)를 쓰고, 호출부는 `customerConfirm()`의
 * 약속을 기다린다. 어드민의 `adminConfirm`(lib/admin/confirm.ts)과 같은 계약이다:
 *  - 호스트가 없으면(마운트 전·시험) 확인되지 않은 것(false)으로 돌려준다 — 확인 없이 요청이 실행되는 일은 없다.
 *  - 같은 확인이 떠 있는 동안의 거듭 호출(이중 탭)은 기다리지 않고 false다 — 먼저 받은 호출만 이어서 실행한다.
 *  - 취소·닫기·Esc·바깥 누르기는 모두 false다.
 */

export interface CustomerConfirmRequest {
  /** 확인창 제목. 무엇을 할지 묻는 한 문장(예: '이 선물을 거절할까요?'). */
  title: string;
  /** 결과·되돌릴 수 있는지 같은 보충 설명. 없으면 제목만 보인다. */
  message?: string;
  /** 확인 버튼. 동작 이름(예: '선물 거절'). */
  confirmLabel: string;
  /** 취소 버튼. 기본은 '돌아가기'. */
  cancelLabel?: string;
}

export type CustomerConfirmHandler = (request: CustomerConfirmRequest) => Promise<boolean>;

let handler: CustomerConfirmHandler | null = null;

/** 호스트(또는 시험)가 확인창을 넘겨받는다. 돌려준 함수로 해제한다. */
export function setCustomerConfirmHandler(next: CustomerConfirmHandler | null): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

const inflight = new Set<string>();

/** 확인창을 띄우고 고객의 선택을 기다린다. 확인이면 true, 그 밖(취소·닫기·호스트 없음·거듭 호출)은 false. */
export function customerConfirm(request: CustomerConfirmRequest): Promise<boolean> {
  if (!handler) return Promise.resolve(false);
  const key = `${request.title}\u0000${request.message ?? ''}\u0000${request.confirmLabel}`;
  if (inflight.has(key)) return Promise.resolve(false);
  inflight.add(key);
  return handler(request).finally(() => { inflight.delete(key); });
}
