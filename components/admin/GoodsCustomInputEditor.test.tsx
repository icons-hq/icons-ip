import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GOODS_CUSTOM_INPUT_VALUE_LIMIT } from '@/lib/goods-custom-inputs';
import { GoodsCustomInputEditor } from './GoodsCustomInputEditor';

const FIELD_ID = '11111111-1111-4111-8111-111111111111';
const enabled = JSON.stringify({ enabled: true, fields: [{ id: FIELD_ID, name: '각인 문구', active: true }, { id: '22222222-2222-4222-8222-222222222222', name: '메모', active: false }] });
const render = (value?: string, error?: string) => renderToStaticMarkup(<GoodsCustomInputEditor value={value} revision="3" error={error} onChange={() => {}} />);
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('직접입력형', () => {
  /* 2026-11-25: '옵션명 개수'는 사실 고객이 적는 칸의 개수다. 이름을 사실대로 하고, 개념 설명은 "?" 한 곳에 둔다. */
  it('고객이 적는 칸을 입력칸이라 부르고 사용 상태를 Y/N이 아니라 말로 고른다', () => {
    const html = render(enabled);
    expect(html).toContain('>입력칸 수</label>');
    expect(html).toContain('입력칸 이름');
    expect(html).toContain('placeholder="예: 각인 문구"');
    expect(html).toContain('>입력칸 추가</button>');
    expect(html).toContain('aria-label="입력칸 1 삭제"');
    expect(html).toMatch(/<option value="true" selected="">사용<\/option><option value="false">사용 중지<\/option>/);
    expect(html).toMatch(/<option value="true">사용<\/option><option value="false" selected="">사용 중지<\/option>/);
    for (const old of ['옵션명 개수', '사용여부', '직접입력형 옵션 추가', '>Y<', '>N<']) expect(html, old).not.toContain(old);
  });

  it('설명 문단 대신 제목 옆 "?"에 개념을 두고, 켠 뒤에만 한 단락 안내를 보인다', () => {
    const off = render();
    expect(off).toContain('data-admin-help');
    expect(off).toContain('aria-label="직접입력형 도움말"');
    expect(off.match(/<p /g)).toBeNull();
    expect(text(off)).not.toContain('각인 문구처럼 고객이');
    const on = render(enabled);
    expect(on.match(/<p /g)).toHaveLength(1);
    expect(text(on)).toContain(`칸마다 최대 ${GOODS_CUSTOM_INPUT_VALUE_LIMIT}자입니다.`);
    expect(text(on)).toContain('연락처·이메일 같은 개인정보는 주문서에서 받으니 여기서 묻지 않습니다.');
  });

  it('제출 값(JSON·리비전·사용 여부)은 그대로다', () => {
    const html = render(enabled);
    expect(html).toMatch(/<input type="hidden" name="customInputs" value="[^"]*&quot;enabled&quot;:true[^"]*"\/>/);
    expect(html).toContain('<input type="hidden" name="customInputsExpectedRevision" value="3"/>');
    expect(html.match(/name="customInputsUsage"/g)).toHaveLength(2);
    expect(html).toMatch(/<input type="radio" name="customInputsUsage" checked=""\/> 설정함/);
    expect(render(undefined, '직접입력형 설정을 확인해주세요.')).toContain('role="alert">직접입력형 설정을 확인해주세요.');
  });
});
