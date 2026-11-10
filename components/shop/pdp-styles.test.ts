import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * 굿즈 상세 지면 CSS 계약 (LFS 패리티 2차 L1).
 * 화면 동작은 컴포넌트 테스트가 지키고, 여기서는 그 동작을 실제로 만드는 지면 수치를 지킨다.
 * 문자열 계약은 브라우저 시각 검수를 대신하지 않는다(DESIGN §11).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

interface Rule { selectors: string[]; media: string | null; decls: Record<string, string> }
function rules(path: string): Rule[] {
  const out: Rule[] = [];
  postcss.parse(read(path)).walkRules((rule) => {
    const media = rule.parent?.type === 'atrule' ? (rule.parent as AtRule).params : null;
    const decls: Record<string, string> = {};
    rule.walkDecls((decl) => { decls[decl.prop] = decl.value.trim(); });
    out.push({ selectors: rule.selectors.map((selector) => selector.trim()), media, decls });
  });
  return out;
}
const decls = (all: Rule[], selector: string, media: string | null = null) => Object.assign({}, ...all
  .filter((rule) => rule.media === media && rule.selectors.includes(selector))
  .map((rule) => rule.decls)) as Record<string, string>;

const catalog = rules('../../app/styles/wc-catalog.css');
const inquiry = rules('../../app/styles/wc-inquiry-widget.css');
const MOBILE = '(max-width: 989px)';
const DESKTOP = '(min-width: 990px)';

describe('PDP 모바일 구매 시트 (PD-01)', () => {
  it('하단 고정·상단 r8·p20/16·높이 85% 상한·내부 스크롤·딤 .6 이다', () => {
    const sheet = decls(catalog, '.wc-pdp-sheet');
    expect(sheet).toMatchObject({ position: 'fixed', bottom: '0', 'max-height': '85dvh', 'z-index': '1000',
      'border-radius': 'var(--wc-radius-sheet) var(--wc-radius-sheet) 0 0' });
    expect(sheet.padding).toMatch(/^20px 16px /);
    expect(sheet.animation).toContain('wc-pdp-sheet-in var(--wc-duration-medium)');
    expect(decls(catalog, '.wc-pdp-sheet__body')).toMatchObject({ 'overflow-y': 'auto', 'min-height': '0' });
    expect(decls(catalog, '.wc-pdp-sheet__dim')).toMatchObject({ position: 'fixed', 'z-index': '999', background: 'rgb(0 0 0 / .6)' });
  });

  it('모션 축소에서는 전환 없이 열리고, 데스크톱 폭에는 남지 않는다', () => {
    expect(decls(catalog, '.wc-pdp-sheet', '(prefers-reduced-motion: reduce)').animation).toBe('none');
    expect(decls(catalog, '.wc-pdp-sheet', DESKTOP).display).toBe('none');
    expect(decls(catalog, '.wc-pdp-sheet__dim', DESKTOP).display).toBe('none');
  });

  it('모바일 본문의 인라인 구매 패널은 숨기고 어드민 미리보기·시트를 열 수 없는 상태(is-inline)는 남긴다', () => {
    expect(decls(catalog, '.wc-pdp:not(.is-embedded) .wc-pdp__purchase:not(.is-inline)', MOBILE).display).toBe('none');
    expect(catalog.some((rule) => rule.selectors.includes('.wc-pdp.is-embedded .wc-pdp__purchase'))).toBe(false);
    /* 판매 불가·품절은 바가 시트를 열지 않는다 — 패널까지 숨기면 옵션·예약·한도·품절 합계를 볼 길이 없다. */
    expect(catalog.some((rule) => rule.decls.display === 'none' && rule.selectors.some((selector) => selector.includes('wc-pdp__purchase') && !selector.includes(':not(.is-inline)')))).toBe(false);
  });
});

describe('PDP 데스크톱 탭 레이아웃·레일 박스 (PD-03·PD-05)', () => {
  it('뷰포트 고정 미니 바 규칙은 남아 있지 않다', () => {
    expect(catalog.filter((rule) => rule.selectors.some((selector) => selector.includes('wc-buybar-mini')))).toEqual([]);
  });

  it('레일 340 은 탭바 아래부터 탭 섹션 끝까지, 박스 320 은 화면 하단 근처에 sticky 로 붙는다', () => {
    expect(decls(catalog, '.wc-pdp-rail').display).toBe('none');
    expect(decls(catalog, '.wc-pdp-rail', DESKTOP)).toMatchObject({ position: 'absolute', top: '55px', bottom: '0', width: '340px', display: 'block' });
    expect(decls(catalog, '.wc-pdp-railbox', DESKTOP)).toMatchObject({ position: 'sticky', top: 'calc(100dvh - 154px)', width: '320px',
      padding: '24px 20px 18px 19px', background: 'var(--wc-surface-grey)' });
    /* dvh 를 모르는 브라우저용 100vh 를 먼저 둔다(동적 툴바에서 박스 아래가 잘리지 않게 dvh 가 이긴다). */
    expect(read('../../app/styles/wc-catalog.css')).toMatch(/top: calc\(100vh - 154px\);\s*top: calc\(100dvh - 154px\);/);
    expect(decls(catalog, '.wc-pdp-railbox__cart')).toMatchObject({ width: '50px', height: '50px' });
    expect(decls(catalog, '.wc-pdp-railbox__amount')).toMatchObject({ 'font-size': '23px', 'font-weight': '700' });
  });

  it('탭바는 전폭 sticky 이고 오프셋은 전역 크롬 높이 변수를 따른다', () => {
    expect(decls(catalog, '.wc-pdp-tabs .wc-tabs__list')).toMatchObject({ position: 'sticky', top: 'var(--wc-sticky-chrome-h, 81px)',
      'padding-inline': 'var(--wc-pdp-inset)' });
    expect(decls(catalog, '.wc-pdp-tabs .wc-tabs__list', DESKTOP).top).toBe('var(--wc-sticky-chrome-h, 68px)');
    /* 크롬 높이 변수가 헤더 펼침·접힘(.3s)으로 바뀌면 붙어 있는 탭바가 같은 박자로 따라간다(모션 축소는 파운데이션이 0으로). */
    expect(decls(catalog, '.wc-pdp-tabs .wc-tabs__list').transition).toBe('top var(--wc-duration-medium)');
    expect(decls(catalog, '.wc-pdp-tabs')['--wc-pdp-inset']).toBe('max(var(--wc-gutter), calc((100% - 1180px) / 2))');
    /* 패널 칼럼 = 콘텐츠 축 − 레일 340. */
    expect(decls(catalog, '.wc-pdp-tabs .wc-tabs__panel', DESKTOP).width).toBe('calc(100% - 2 * var(--wc-pdp-inset) - 340px)');
  });
});

describe('PDP 정보 칼럼 (PD-04·PD-12)', () => {
  it('모바일 갤러리만 컨테이너 거터를 넘어 화면 폭이 된다(도트 기준 상자는 건드리지 않는다)', () => {
    expect(decls(catalog, '.wc-pdp:not(.is-embedded) .wc-pdp-gallery', MOBILE)['margin-inline']).toBe('calc(-1 * var(--wc-gutter))');
  });

  it('합계 위 1px 잉크 선과 장바구니 122 고정 + 구매하기 나머지(27:73 실측)', () => {
    expect(decls(catalog, '.wc-buy-panel__total')['border-top']).toBe('1px solid var(--wc-ink)');
    expect(decls(catalog, '.wc-buy-panel__cart').flex).toBe('0 0 122px');
    expect(decls(catalog, '.wc-buy-panel__buy')).toMatchObject({ flex: '1 1 0', 'min-width': '0' });
  });
});

describe('PDP 상태 줄 색 (QA l2-qa-2)', () => {
  /* 구매 패널 상태 줄·재입고 버튼 아래 줄은 같은 클래스다 — 담기 성공만 성공색이고, 실패·거절은 is-error 로 state.danger 다. */
  /* 담는 동안 aria-disabled 로 잠근 담기·구매 버튼(포커스 유지)은 비활성 버튼과 같은 모습이다(L2 QA l2-qa-4). */
  it('카트 반영 중 aria-disabled CTA 는 비활성 버튼과 같은 색으로 그린다', () => {
    const disabledLook = { 'border-color': 'var(--wc-ink-disabled)', background: 'var(--wc-ink-disabled)', color: '#FFFFFF' };
    expect(decls(catalog, ".wc-buy-panel__ctas .wc-btn[aria-disabled='true']")).toMatchObject({ ...disabledLook, cursor: 'progress' });
    expect(decls(catalog, ".wc-pdp-railbox__cart[aria-disabled='true']")).toMatchObject(disabledLook);
    expect(decls(catalog, ".wc-pdp-railbox__buy[aria-disabled='true']")).toMatchObject(disabledLook);
  });

  it('담기 성공은 state.success, 실패·거절(is-error)은 서체는 그대로 두고 색만 state.danger 다', () => {
    expect(decls(catalog, '.wc-buy-panel__status')).toMatchObject({ color: 'var(--wc-success)', 'font-size': '13px', 'font-weight': '400' });
    expect(decls(catalog, '.wc-buy-panel__status.is-error')).toEqual({ color: 'var(--wc-danger)' });
  });
});

describe('문의 런처 겹침 (CH-16)', () => {
  it('990px 미만 전 구간에서 하단 고정 바 위에 선다(701–989px 오프셋 누락 해소)', () => {
    expect(decls(inquiry, '.wc-root .wc-inquiry-widget__launcher', '(max-width: 989px)').bottom).toBe('calc(80px + env(safe-area-inset-bottom))');
    expect(decls(inquiry, '.wc-root .wc-inquiry-widget__launcher', '(max-width: 700px)')).toEqual({});
  });

  it('PDP 데스크톱에서 레일 박스와 가로로 겹치는 폭에서만 박스 위로 올라가고, 박스가 밀려 올라가는 동안은 감춘다', () => {
    const OVERLAP = '(min-width: 990px) and (max-width: 1459px)';
    expect(decls(inquiry, "#root:has(.wc-pdp[data-rail-box='docked']) .wc-inquiry-widget__launcher", OVERLAP).bottom).toBe('178px');
    expect(decls(inquiry, "#root:has(.wc-pdp[data-rail-box='leaving']) .wc-inquiry-widget__launcher", OVERLAP).visibility).toBe('hidden');
    /* 넓은 화면에서는 박스(오른쪽 끝 (100vw+1180)/2)와 런처가 겹치지 않는다 — 문의 진입을 감추지 않는다. */
    expect(inquiry.filter((rule) => rule.selectors.some((selector) => selector.includes('data-rail-box')) && rule.media !== OVERLAP)).toEqual([]);
  });
});
