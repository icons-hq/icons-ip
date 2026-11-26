import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/components/admin/EncryptedWorkbookDownloadButton', () => ({ EncryptedWorkbookDownloadButton: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a> }));
import { AdminSubscriptionsScreen } from './AdminSubscriptionsScreen';
import { adminSubscriptionRow } from '../../../test/fixtures/goods-subscriptions';
import { normalizeAdminSubscriptionFilters, type AdminSubscriptionRow } from '@/lib/admin/subscriptions';
import { SUBSCRIPTION_CYCLE_LABELS } from '@/lib/subscriptions/model';
const render = (rows: AdminSubscriptionRow[] = [adminSubscriptionRow], filters: Record<string, unknown> = {}) => renderToStaticMarkup(<AdminSubscriptionsScreen data={{
  rows, total: rows.length, page: 1, pageSize: 50, asOf: adminSubscriptionRow.updatedAt, filters: normalizeAdminSubscriptionFilters(filters) }} />);
/* N-01: 정기구매에는 운영자가 쓰는 번호가 없다(고객 화면에도 번호가 없다). 내부 번호 끝 8자는 번호가 아니라 화면에서 뺀다. 구매자 이름이 상세로 가는 링크다. */
it('구매자 이름이 상세로 가는 링크이고 번호 열과 번호 조각은 없다', () => {
  const html = render(), visible = html.replace(/<[^>]*>/g, ' '), heads = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(match => match[1].replace(/<[^>]*>/g, '').trim()).filter(Boolean);
  expect(heads.slice(0, 3)).toEqual(['구매자', '상태', '상품']);
  expect(html).not.toContain('정기구매 번호'); expect(html).not.toContain('신청번호');
  expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/sales/subscriptions/${adminSubscriptionRow.id}"[^>]*>합성 구매자</a>`));
  expect(visible).not.toMatch(/\b[0-9A-Fa-f]{8}\b/); expect(html).not.toMatch(/title="[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(html).toContain('정기배송 중');
});
it('이름이 비어 있는 구매자는 회원으로 적어 링크 글자가 빈칸이 되지 않는다', () => {
  const html = render([{ ...adminSubscriptionRow, buyerName: ' ' }]);
  expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/sales/subscriptions/${adminSubscriptionRow.id}"[^>]*>회원</a>`));
});
/* N-02: 메뉴설명은 한 문단이고, 가는 곳은 화면에 적힌 이름 그대로 말한다. 검색 안내는 화면에 보이는 값만 말한다. */
it('메뉴설명은 한 문단이고 결제 확인이 필요한 회차가 가는 곳을 버튼 이름으로 말한다', () => {
  const html = render(), guide = html.slice(html.indexOf('data-sales-guide'), html.indexOf('</details>', html.indexOf('data-sales-guide')));
  expect(guide.match(/<p>/g)).toHaveLength(1);
  expect(guide).toContain('[현재 회차 결제 결과 조회]'); expect(guide).not.toContain('불명확');
  expect(guide).toContain(SUBSCRIPTION_CYCLE_LABELS.unknown); expect(guide).toContain(SUBSCRIPTION_CYCLE_LABELS.needs_review);
  expect(guide).toContain('정산 완료액과 다릅니다');
  expect(html).toMatch(/id="sales-subscriptions-query-hint">구매자 · 상품</);
});
it('변경 내용 확인이 필요한 신청에는 상세로 가는 링크와 건수를 남긴다', () => {
  const html = render([{ ...adminSubscriptionRow, state: 'needs_confirmation' }]);
  expect(html).toContain('>상세에서 확인<'); expect(html).toContain('변경 내용 확인 필요');
});
