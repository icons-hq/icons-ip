import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminListExportButton, adminListExportResponseError } from './AdminListExportButton';

describe('목록 엑셀 다운로드 버튼', () => {
  it('적용된 조건의 다운로드 주소와 건수·상한·개인정보 안내를 보여 준다', () => {
    const html = renderToStaticMarkup(
      <AdminListExportButton href={'/api/admin/list-export?screen=orders&status=paid'} total={1234} />,
    );
    expect(html).toContain('목록 엑셀 다운로드');
    expect(html).toContain('type="button"');
    expect(html).toContain('data-export-href="/api/admin/list-export?screen=orders&amp;status=paid"');
    expect(html).toContain('현재 검색 조건의 전체 1,234건을 받습니다(최대 10,000건).');
    expect(html).toContain('내려받은 기록이 남습니다');
    expect(html).not.toContain('disabled=""');
  });

  it('상한을 넘는 조건은 버튼을 끄고 조건을 좁히라고 안내한다', () => {
    const html = renderToStaticMarkup(<AdminListExportButton href="/api/admin/list-export?screen=orders" total={10_001} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('조건을 좁혀 다시 내려받아 주세요(최대 10,000건).');
  });

  it('오류 응답 본문을 그대로 보여 주고 로그인·권한 화면은 별도 안내로 바꾼다', async () => {
    await expect(adminListExportResponseError(Response.json(
      { error: '한 번에 내려받을 수 있는 양을 넘었습니다. 조건을 좁혀 다시 내려받아 주세요(최대 10,000건).' },
      { status: 400 },
    ))).resolves.toBe('한 번에 내려받을 수 있는 양을 넘었습니다. 조건을 좁혀 다시 내려받아 주세요(최대 10,000건).');
    await expect(adminListExportResponseError(new Response('<html>not found</html>', { status: 404 })))
      .resolves.toBe('로그인이 만료되었거나 권한이 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요.');
    await expect(adminListExportResponseError(new Response('oops', { status: 502 })))
      .resolves.toBe('파일을 만들지 못했습니다. 잠시 후 다시 내려받아 주세요.');
    await expect(adminListExportResponseError(Response.json({ error: '  ' }, { status: 500 })))
      .resolves.toBe('파일을 만들지 못했습니다. 잠시 후 다시 내려받아 주세요.');
  });
});
