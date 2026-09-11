import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/app/admin/operations-contact-actions', () => ({ saveOperationsContactAction: vi.fn() }));
import { OperationsSettingsScreen } from './OperationsSettingsScreen';
import type { OperationsContact, OperationsContactHistory } from '@/lib/admin/operations-contacts';
const contacts: OperationsContact[] = [
  { scope: 'operations', originId: null, originName: null, originActive: null, ownerName: '', contact: '', sourceReference: '', handoffReference: '', updatedAt: null, updatedByName: null },
  { scope: 'origin', originId: '00000000-0000-4000-8000-000000499002', originName: '연습 창고', originActive: false, ownerName: '창고 담당', contact: 'warehouse@example.test', sourceReference: '<script>alert(1)</script>', handoffReference: '', updatedAt: '2026-09-11T03:00:00Z', updatedByName: '관리자' },
];
const history: OperationsContactHistory[] = [{ id: 'history', actorName: '관리자', scope: 'origin', originName: '연습 창고', changedFields: ['contact'], createdAt: '2026-09-11T03:00:00Z' }];
it('직원은 담당자 기록과 이력을 읽고 관리 전용 링크와 저장 버튼은 보지 않는다', () => {
  const html = renderToStaticMarkup(<OperationsSettingsScreen contacts={contacts} history={history} canEdit={false}/>);
  expect(html).toContain('warehouse@example.test');
  expect(html).toContain('담당자 정보 변경 이력');
  expect(html).toContain('readOnly');
  expect(html).not.toContain('담당자 정보 저장');
  expect(html).not.toContain('href="/admin/settings/store-credits"');
});
it('관리자는 실제 입력 화면과 출고지별 저장 폼을 사용하며 참조는 텍스트로 렌더한다', () => {
  const html = renderToStaticMarkup(<OperationsSettingsScreen contacts={contacts} history={history} canEdit/>);
  expect(html).toContain('section=bank_transfer');
  expect(html).toContain('href="/admin/catalog/goods"');
  expect(html).toContain('href="/admin/settings/store-credits"');
  expect(html).toContain('출고지 비활성');
  expect(html).toContain('담당자 정보 미입력');
  expect(html).toContain('정보 입력 3/4');
  expect(html.match(/>담당자 정보 저장</g)).toHaveLength(2);
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
});
