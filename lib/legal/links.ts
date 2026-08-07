import { hrefFor } from '@/lib/routes';

/* 법정 고지의 슬러그·표기·경로만 담는다.
 * 푸터와 온보딩은 클라이언트 컴포넌트라 documents.ts의 본문 전체를 번들에 넣으면 안 된다.
 * 경로 진실원은 lib/routes.ts이고 여기서는 그것을 슬러그로 감싸기만 한다. */

export type LegalDocumentSlug = 'terms' | 'privacy' | 'shipping';

export const LEGAL_DOCUMENT_SLUGS: LegalDocumentSlug[] = ['terms', 'privacy', 'shipping'];

export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentSlug, string> = {
  terms: '이용약관',
  privacy: '개인정보처리방침',
  shipping: '배송·반품 정책',
};

export function legalDocumentHref(slug: LegalDocumentSlug): string {
  return hrefFor(slug);
}
