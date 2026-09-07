import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SeededForm } from './form-seed';
import { ColorField, Field, SelectField, TextArea } from './fields';

/*
 * 저장 실패 시 제출값 보존 (전수 수리).
 *
 * 현업 보고: 「저장 버튼 클릭 후 오류 발생 시 입력 내용이 모두 사라진다」(2026-09-07 취합 3-4 #2).
 * 여기서 잠그는 계약은 하나다 — **폼이 실패 제출값을 받으면 필드가 그 값으로 다시 그려진다.**
 */

function renderForm(values?: Record<string, string>) {
  return renderToStaticMarkup(
    <SeededForm values={values}>
      <Field defaultValue="레코드 이름" label="이름" name="name" />
      <TextArea defaultValue="레코드 설명" label="설명" name="description" />
      <ColorField defaultValue="#111111" fallback="#000000" label="색" name="color" />
      <SelectField defaultValue="fixed" label="할인" name="discountType">
        <option value="fixed">정액</option>
        <option value="percent">정률</option>
      </SelectField>
    </SeededForm>,
  );
}

describe('SeededForm', () => {
  it('시드가 없으면 레코드 값을 그대로 그린다', () => {
    const html = renderForm();

    expect(html).toContain('value="레코드 이름"');
    expect(html).toContain('>레코드 설명</textarea>');
    expect(html).toContain('value="#111111"');
  });

  it('실패 제출값이 레코드 값을 이긴다 — 운영자가 방금 친 것이 남아야 한다', () => {
    const html = renderForm({
      name: '치다 만 이름',
      description: '치다 만 설명',
      color: '#ABCDEF',
      discountType: 'percent',
    });

    expect(html).toContain('value="치다 만 이름"');
    expect(html).toContain('>치다 만 설명</textarea>');
    expect(html).toContain('value="#ABCDEF"');
    expect(html).toContain('<option value="percent" selected="">');
  });

  it('시드에 없는 필드는 레코드 값을 지킨다 — 한 칸 틀렸다고 나머지를 지우지 않는다', () => {
    const html = renderForm({ name: '치다 만 이름' });

    expect(html).toContain('value="치다 만 이름"');
    expect(html).toContain('>레코드 설명</textarea>');
  });

  it('빈 문자열도 값이다 — 지운 칸이 저장 실패로 되살아나면 안 된다', () => {
    const html = renderForm({ name: '' });

    expect(html).toContain('name="name"');
    expect(html).not.toContain('value="레코드 이름"');
  });

  it('형식이 깨진 색은 시드를 무시하고 대체색으로 떨어뜨린다 — color 입력은 검정으로 죽는다', () => {
    const html = renderForm({ color: 'not-a-color' });

    expect(html).toContain('value="#111111"');
  });

  it('폼 밖의 필드는 시드를 보지 않는다 — 옆 폼의 실패값이 새어 들면 안 된다', () => {
    const html = renderToStaticMarkup(
      <div>
        <SeededForm values={{ name: '새어 나온 값' }}>
          <Field defaultValue="안쪽" label="안쪽" name="name" />
        </SeededForm>
        <Field defaultValue="바깥" label="바깥" name="name" />
      </div>,
    );

    expect(html).toContain('value="새어 나온 값"');
    expect(html).toContain('value="바깥"');
  });
});
