import { describe, expect, it, vi } from 'vitest';
import { goodsAfterSalesError, goodsAfterSalesProblem } from './goods-after-sales-messages';
import { goodsBenefitsError } from './goods-benefits-messages';
import { goodsSizeChartError } from './goods-size-chart-messages';
import {
  CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM, TEMPLATE_DISCARD_INPUT_CONFIRM,
  TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE,
  findSavedTemplate, reopenClosedDialog, templateArchiveConfirm, templateCloseUnknownConfirm, templateExcerpt, templateSavedKind, templateSavedNotice,
} from './goods-template-save';

/* 사이즈·A/S·이벤트 템플릿 관리와 상품의 같은 안내 패널이 함께 쓰는 말(PR 2 낱말 표)과 최신 내용 찾기. */
describe('세 화면이 함께 쓰는 말', () => {
  it('저장됐는지 모를 때의 버튼과 문장은 낱말 표 그대로다', () => {
    expect(SAVE_CHECK_LABEL).toBe('저장됐는지 확인');
    expect(SAVE_UNKNOWN_MESSAGE).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    expect(CHANGED_BY_OTHER).toBe('다른 사람이 먼저 바꿨습니다.');
  });

  it('세 메시지 파일이 같은 일을 같은 말로 부르고, 원인마다 고칠 방법을 말한다', () => {
    const errors = [goodsSizeChartError, goodsAfterSalesError, goodsBenefitsError];
    expect(new Set(errors.map(error => error('operation_conflict'))).size).toBe(1);
    expect(new Set(errors.map(error => error('operator_capability_required'))).size).toBe(1);
    expect(goodsSizeChartError('operator_capability_required')).toBe('상품 관리 권한이 없습니다. 판매자 정보 > 매니저 관리 담당자에게 권한을 받은 뒤 다시 저장해 주세요.');
    for (const changed of [goodsSizeChartError('goods_size_template_changed'), goodsSizeChartError('goods_size_chart_changed'), goodsAfterSalesError('goods_after_sales_template_changed'),
      goodsAfterSalesError('goods_after_sales_changed'), goodsBenefitsError('goods_event_template_changed'), goodsBenefitsError('goods_benefits_changed')]) expect(changed.startsWith(CHANGED_BY_OTHER)).toBe(true);
    /* 상품의 안내는 그 화면에 있는 버튼으로 다음 할 일을 말한다. */
    expect(goodsAfterSalesError('goods_after_sales_changed')).toContain('[저장된 내용으로 다시 불러오기]');
    expect(goodsBenefitsError('goods_benefits_changed')).toContain('[저장된 내용으로 다시 불러오기]');
    expect(goodsSizeChartError('goods_size_chart_changed')).toContain('[최신 저장본 확인]');
    expect(goodsBenefitsError('invalid_goods_event_template')).toBe('이벤트 문구를 1~40자로 적어 주세요.');
    expect(goodsBenefitsError('invalid_goods_benefit_images')).toContain('사은품 설명도 적어 주세요.');
    expect(goodsBenefitsError()).toBe(goodsAfterSalesError());
  });

  it('운영자가 읽는 문구에 개발 용어와 옛 버튼 이름이 없다', () => {
    const shown = [SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM, templateCloseUnknownConfirm(true), templateCloseUnknownConfirm(false), TEMPLATE_DISCARD_INPUT_CONFIRM, templateArchiveConfirm(true), templateArchiveConfirm(false),
      ...['operation_conflict', 'goods_size_chart_changed', 'goods_size_template_changed', 'goods_size_chart_cannot_clear', 'good_not_found', 'operator_capability_required', undefined].map(code => goodsSizeChartError(code)),
      ...['operation_conflict', 'goods_after_sales_changed', 'goods_after_sales_template_changed', 'operator_capability_required', 'invalid_goods_after_sales', undefined].map(code => goodsAfterSalesError(code)),
      ...['operation_conflict', 'goods_benefits_changed', 'goods_event_template_changed', 'unverified_artwork', 'operator_capability_required', 'invalid_goods_benefit_content', undefined].map(code => goodsBenefitsError(code)),
    ].map(value => typeof value === 'string' ? value : Object.values(value).join(' ')).join('\n');
    expect(shown).not.toMatch(/요청|응답|경합|충돌|버전|같은 요청 결과 확인|다른 저장 결과|현재 권한을 확인|복구(?!\s*기록)/);
  });

  it('저장됐는지 모르는 채 닫을 때는 닫은 뒤 무엇을 할지까지 말한다', () => {
    expect(templateCloseUnknownConfirm(false).message).toBe('닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. 목록에 없으면 다시 적어야 합니다.');
    expect(templateCloseUnknownConfirm(true).message).toBe('닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. 목록에 없으면 같은 템플릿을 다시 열어 [저장됐는지 확인]을 눌러 주세요.');
  });

  /* S4: 새로 등록하던 템플릿은 목록에 없으니 '같은 템플릿을 다시 열' 줄이 없다. 등록 버튼을 다시 누르면 확인 안내가 뜬다. */
  it('새로 등록하던 템플릿은 등록 버튼을 다시 누르라고 말한다', () => {
    expect(templateCloseUnknownConfirm(true, '사이즈 템플릿 등록').message).toBe('닫으면 목록을 다시 불러옵니다. 방금 저장하려던 내용이 목록에 있는지 확인해 주세요. 목록에 없으면 [사이즈 템플릿 등록]을 다시 눌러 [저장됐는지 확인]을 눌러 주세요.');
    expect(templateCloseUnknownConfirm(false, '이벤트 템플릿 등록').message).toContain('목록에 없으면 다시 적어야 합니다.');
  });

  /* S5: '최신 내용 위에'는 합쳐진다는 뜻으로 읽힌다. 다른 사람이 저장한 내용이 통째로 바뀐다고 버튼 이름과 한 줄로 말한다. */
  it('다른 사람이 먼저 바꾼 템플릿을 내 입력으로 저장하는 버튼은 덮어쓴다고 말한다', () => {
    expect(TEMPLATE_SAVE_OVER_LATEST_LABEL).toBe('내 입력으로 덮어쓰기');
    expect(TEMPLATE_SAVE_OVER_LATEST_NOTE).toBe('[내 입력으로 덮어쓰기]를 누르면 다른 사람이 저장한 내용이 사라지고 내 입력으로 바뀝니다.');
  });

  /* G5: 보관·복원한 템플릿은 지금 보는 목록에서 사라진다. 어디서 다시 보는지까지 말한다(사진 보관함과 같은 말). */
  it('저장·보관·복원 뒤의 결과 한 줄', () => {
    expect([templateSavedKind(false, false), templateSavedKind(true, true), templateSavedKind(false, true), templateSavedKind(true, false)]).toEqual(['saved', 'saved', 'archived', 'restored']);
    expect(templateSavedNotice('saved')).toBe('템플릿을 저장했습니다.');
    expect(templateSavedNotice('archived')).toBe("보관했습니다. 보관 상태에서 '보관됨'을 고르면 다시 볼 수 있고, 그 줄의 [수정]을 열어 [복원]을 누르면 되살아납니다.");
    expect(templateSavedNotice('restored')).toBe("복원했습니다. 보관 상태 '사용 중' 목록에서 볼 수 있습니다.");
  });

  it('[보관]·[복원]은 보관 상태만 바꾼다고 말한다', () => {
    expect(templateArchiveConfirm(true)).toEqual({ title: '고친 내용은 저장하지 않고 보관할까요?', message: '[보관]은 보관 상태만 바꿉니다. 지금 고친 내용은 사라지니, 남기려면 먼저 저장해 주세요.', confirmLabel: '저장하지 않고 보관' });
    expect(templateArchiveConfirm(false).confirmLabel).toBe('저장하지 않고 복원');
  });
});

describe('A/S 안내를 저장하기 전에 어느 칸이 왜 안 되는지', () => {
  const values = { phone: '02-123', guide: 'A/S 안내', sellerSpecialNotes: '' };
  it('문제가 없으면 null', () => { expect(goodsAfterSalesProblem(values)).toBeNull(); });
  it('비어 있는 칸과 넘친 글자 수를 칸 이름으로 말한다', () => {
    expect(goodsAfterSalesProblem({ ...values, phone: ' ' })).toBe('A/S 전화번호를 적어 주세요.');
    expect(goodsAfterSalesProblem({ ...values, guide: '\n' })).toBe('A/S 안내를 적어 주세요.');
    expect(goodsAfterSalesProblem({ ...values, phone: '0'.repeat(23) })).toBe('A/S 전화번호가 3자 넘었습니다. 20자까지 적을 수 있습니다.');
    expect(goodsAfterSalesProblem({ ...values, guide: '가'.repeat(1301) })).toBe('A/S 안내가 1자 넘었습니다. 1,300자까지 적을 수 있습니다.');
    expect(goodsAfterSalesProblem({ ...values, sellerSpecialNotes: '가'.repeat(1310) })).toBe('판매자 특이사항이 10자 넘었습니다. 1,300자까지 적을 수 있습니다.');
    expect(goodsAfterSalesProblem({ ...values, phone: '02\u0007123' })).toContain('저장할 수 없는 글자');
  });
});

describe('템플릿 한 건의 지금 저장된 내용 찾기', () => {
  const row = (id: string) => ({ id });
  const page = (rows: { id: string }[], total = rows.length) => ({ ok: true as const, value: { rows, total } });
  it('사용 중 목록을 20개씩 넘겨 보고, 없으면 보관됨 목록까지 본다', async () => {
    const list = vi.fn(async (archived: boolean, at: number) => archived ? page([row('target')]) : at === 1 ? page([row('a')], 21) : page([row('b')], 21));
    expect(await findSavedTemplate('target', list)).toEqual({ id: 'target' });
    expect(list.mock.calls).toEqual([[false, 1], [false, 2], [true, 1]]);
  });
  it('찾으면 바로 멈춘다', async () => {
    const list = vi.fn(async () => page([row('target')], 99));
    expect(await findSavedTemplate('target', list)).toEqual({ id: 'target' }); expect(list).toHaveBeenCalledOnce();
  });
  it('끝까지 없으면 null, 조회하지 못했으면 failed', async () => {
    expect(await findSavedTemplate('missing', async () => page([]))).toBeNull();
    expect(await findSavedTemplate('x', async () => ({ ok: false as const }))).toBe('failed');
    expect(await findSavedTemplate('x', async () => { throw new Error('network'); })).toBe('failed');
  });
});

describe('그 밖의 도우미', () => {
  it('발췌는 첫 줄만, 30자를 넘으면 줄임표로 자른다', () => {
    expect(templateExcerpt('  첫 줄  \n둘째 줄')).toBe('첫 줄');
    expect(templateExcerpt('가'.repeat(31))).toBe(`${'가'.repeat(30)}…`);
    expect(templateExcerpt('')).toBe('');
  });
  it('확인창에서 취소했는데 브라우저가 창을 이미 닫았으면 다시 연다', () => {
    const showModal = vi.fn();
    const closed = { isConnected: true, open: false, showModal }, opened = { isConnected: true, open: true, showModal };
    reopenClosedDialog({ closest: () => closed } as unknown as Element); expect(showModal).toHaveBeenCalledOnce();
    reopenClosedDialog({ closest: () => opened } as unknown as Element); reopenClosedDialog(null); reopenClosedDialog({ closest: () => null } as unknown as Element);
    expect(showModal).toHaveBeenCalledOnce();
  });
});
