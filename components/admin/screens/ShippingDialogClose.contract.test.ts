import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM } from '@/lib/admin/dialog-close';

/*
 * S7-3: "적은 내용을 저장하지 않고 닫을까요?" 확인창의 돌아가는 버튼은 배송 설정 화면 어디서나 [돌아가기]다.
 * 예전에는 배송 안내 템플릿이 [취소], 지역별 추가배송비가 [계속 작성]으로 달랐다. 화면은 같은 상수를 쓰고 버튼 이름을 따로 적지 않는다.
 */
const SCREENS = [
  'components/admin/screens/ShippingRegionsScreen.tsx',
  'components/admin/screens/ShippingNoticeTemplateForm.tsx',
  'components/admin/screens/ShippingSettingsTemplateForm.tsx',
  'components/admin/shipping-charge-groups/ShippingChargeGroupEditor.tsx',
] as const;

describe('배송 설정 화면의 닫기 확인창', () => {
  it('돌아가는 버튼은 [돌아가기]다', () => {
    expect(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM).toMatchObject({ title: '적은 내용을 저장하지 않고 닫을까요?', confirmLabel: '저장하지 않고 닫기', cancelLabel: '돌아가기' });
  });
  it.each(SCREENS)('%s는 같은 상수로 묻고 버튼 이름을 따로 적지 않는다', (path) => {
    const source = readFileSync(path, 'utf-8');
    expect(source).toContain('adminConfirm(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM)');
    expect(source).not.toMatch(/계속 작성|TEMPLATE_CLOSE_DIRTY_CONFIRM/);
  });
});
