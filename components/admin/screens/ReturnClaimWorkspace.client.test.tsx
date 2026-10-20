import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ headings: { current: {} } }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useRef: () => hooks.headings }));
import { ReturnClaimWorkspace, type ReturnClaimProgress } from './ReturnClaimWorkspace';

type Element = ReactElement<{ children?: ReactNode; id?: string; type?: string; onClick?: () => void; ref?: (node: unknown) => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node)
  ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node)
  ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : ''; }
const base: ReturnClaimProgress = { stage: 'on_hold', heldFrom: 'collected', collectionPolicy: 'origin',
  collectionComplete: true, collectedAt: '2026-10-15T00:00:00Z', collectionCount: 1, collectedCount: 1,
  refundLedgerOpen: true, refundFiled: false, refundCompleted: false };
function render(progress = base) { return ReturnClaimWorkspace({ progress, review: null, collection: null, hold: null, refund: null, exception: null }); }
beforeEach(() => { hooks.headings.current = {}; });

it('마운트와 서버 상태 갱신은 활성 입력의 포커스를 바꾸지 않고 명시적인 보기 클릭만 제목으로 이동한다', () => {
  const nodes = all(render());
  const holdHeading = { focus: vi.fn(), scrollIntoView: vi.fn() };
  const refundHeading = { focus: vi.fn(), scrollIntoView: vi.fn() };
  nodes.find(node => node.props.id === 'return-hold')!.props.ref!(holdHeading);
  nodes.find(node => node.props.id === 'return-refund')!.props.ref!(refundHeading);
  const refreshed = all(render({ ...base, stage: 'collected' }));
  expect(holdHeading.focus).not.toHaveBeenCalled(); expect(refundHeading.focus).not.toHaveBeenCalled();
  const next = refreshed.find(node => node.type === 'button' && text(node) === '다음 작업 보기')!;
  expect(next.props.type).toBe('button');
  next.props.onClick!();
  expect(refundHeading.focus).toHaveBeenCalledOnce();
  expect(refundHeading.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  expect(holdHeading.focus).not.toHaveBeenCalled();
});

it('단계 보기 버튼은 제출 없이 해당 제목을 직접 선택한다', () => {
  const nodes = all(render()); const heading = { focus: vi.fn(), scrollIntoView: vi.fn() };
  nodes.find(node => node.props.id === 'return-collection')!.props.ref!(heading);
  const button = nodes.find(node => node.type === 'button' && text(node).endsWith('. 회수 확인'))!;
  expect(button.props.type).toBe('button'); button.props.onClick!(); expect(heading.focus).toHaveBeenCalledOnce();
});
