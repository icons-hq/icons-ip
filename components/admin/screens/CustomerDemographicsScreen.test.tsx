import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/* next/link는 라우트 핸들러를 화면처럼 이동해 내려받기가 끝나도 본문이 잠긴 채 남았다. 형제 내보내기처럼 일반 a 태그다. */
it('엑셀 다운로드는 Next Link가 아니라 일반 링크다', () => {
  const source = readFileSync(join(process.cwd(), 'components/admin/screens/CustomerDemographicsScreen.tsx'), 'utf8');
  expect(source).toMatch(/<a className=\{buttonVariants\(\{ variant: 'outline', size: 'sm' \}\)\} data-slot="button" href=\{demographicHref\(filters, '\/api\/admin\/customer-demographics-workbook'\)\}>/);
  expect(source).not.toContain('next/link');
});
