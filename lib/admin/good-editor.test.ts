import { expect, it } from 'vitest';
import { goodEditorValues } from './good-editor';
it('keeps explicit empty or copied notice and uploaded paths on failure above new business defaults', () => {
  const defaults = { asManager: '회사', asContact: '02-1111' };
  expect(goodEditorValues(null, {}, 'ip1', defaults)).toMatchObject({ ipId: 'ip1', noticeAsManager: '회사', noticeAsContact: '02-1111' });
  expect(goodEditorValues(null, { values: { previousId: '', noticeAsManager: '', noticeAsContact: '프리셋 연락처', galleryPath0: 'uploaded.webp' } }, 'ip1', defaults)).toMatchObject({ noticeAsManager: '', noticeAsContact: '프리셋 연락처', galleryPath0: 'uploaded.webp' });
});
