import { describe, expect, it } from 'vitest';
import { REPLY_TEMPLATE_REPLACE_CONFIRM, REPLY_TEMPLATE_REPLACE_HINT, applyInquiryReplyTemplate, parseInquiryReplyTemplate, parseInquiryTemplateMutation, parseInquiryTemplateReceipt } from './inquiry-reply-templates';
const id = '10000000-0000-4000-8000-000000000001', operationId = '20000000-0000-4000-8000-000000000001';
const input = { operationId, templateId: id, revision: 0, action: 'save', values: { category: 'shipping', title: '배송 문구', body: '안내 내용' } };
const row = { id, category: 'other', title: '기존 문구', body: '기존 본문', revision: 1, archived_at: null, updated_at: '2026-10-13T00:00:00Z' };
describe('고객문의 템플릿 계약', () => {
  it('기존 제목40/본문2000 경계와 줄바꿈을 유지한다', () => {
    expect(parseInquiryTemplateMutation({ ...input, values: { category: 'shipping', title: '가'.repeat(40), body: '나'.repeat(2000) } })).not.toBeNull();
    expect(parseInquiryTemplateMutation({ ...input, values: { ...input.values, title: '가'.repeat(41) } })).toBeNull();
    expect(parseInquiryTemplateMutation({ ...input, values: { ...input.values, body: '나'.repeat(2001) } })).toBeNull();
    expect(parseInquiryTemplateMutation({ ...input, values: { ...input.values, body: '첫 줄\n두번째 줄' } })?.values).toMatchObject({ body: '첫 줄\n두번째 줄' });
  });
  it.each([
    { ...input, surface: 'review' }, { ...input, values: { ...input.values, category: 'unknown' } },
    { ...input, values: { ...input.values, title: '  ' } }, { ...input, values: { ...input.values, title: '줄\n바꿈' } },
    { ...input, revision: -1 }, { ...input, action: 'delete' }, { ...input, operationId: 'invalid' },
    { ...input, action: 'restore', values: {} }, { ...input, action: 'archive', revision: 1, values: { body: '본문' } },
  ])('지원하지 않는 입력을 거부한다', value => { expect(parseInquiryTemplateMutation(value)).toBeNull(); });
  it('삭제/복구는 식별자·현재 버전만 받는다', () => {
    expect(parseInquiryTemplateMutation({ ...input, action: 'archive', revision: 1, values: {} })?.action).toBe('archive');
    expect(parseInquiryTemplateMutation({ ...input, action: 'restore', revision: 2, values: {} })?.action).toBe('restore');
  });
  it('식별자와 저장 버전이 맞는 응답만 읽는다', () => {
    expect(parseInquiryReplyTemplate(row)).toMatchObject({ id, revision: 1, archivedAt: null });
    expect(parseInquiryReplyTemplate({ ...row, updated_at: 'invalid' })).toBeNull();
    expect(parseInquiryTemplateReceipt({ operationId, templateId: id, action: 'save', template: row })).not.toBeNull();
    expect(parseInquiryTemplateReceipt({ operationId, templateId: operationId, action: 'save', template: row })).toBeNull();
  });
  /* R3(MD-0011): 템플릿은 덧붙임이 아니라 대체다. 작성 중인 내용이 있으면 화면이 확인을 거친다(replaces). */
  it('작성 중인 내용을 템플릿으로 바꾸고, 바꿀 내용이 있을 때만 확인이 필요하다고 알린다', () => {
    expect(applyInquiryReplyTemplate('고객별 작성 내용', '배송 안내')).toEqual({ ok: true, body: '배송 안내', replaces: true });
    expect(applyInquiryReplyTemplate('  \n', '배송 안내')).toEqual({ ok: true, body: '배송 안내', replaces: false });
    expect(applyInquiryReplyTemplate('배송 안내', '배송 안내')).toEqual({ ok: true, body: '배송 안내', replaces: false });
    expect(applyInquiryReplyTemplate('가'.repeat(1999), '새 문구')).toEqual({ ok: true, body: '새 문구', replaces: true });
    expect(applyInquiryReplyTemplate('', '😀'.repeat(1001))).toMatchObject({ ok: false, error: expect.stringContaining('2,000자') });
    expect(REPLY_TEMPLATE_REPLACE_CONFIRM).toBe('작성 중인 내용을 템플릿으로 바꿀까요?');
    expect(REPLY_TEMPLATE_REPLACE_HINT).toBe('템플릿을 고르면 작성 중인 내용을 템플릿으로 바꿉니다.');
  });
});
