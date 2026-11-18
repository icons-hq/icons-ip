import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
const mocks = vi.hoisted(() => ({ reset: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'), useEffect: () => {},
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next; }]; },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/operator-mfa-actions', () => ({ resetOperatorMfaAction: mocks.reset, saveOperatorMfaPolicyAction: mocks.save }));
import { OperatorMfaPolicyPanel } from './OperatorMfaPolicyPanel';
import type { OperatorMfaPolicy } from '@/lib/admin/mfa';

type Element = ReactElement<{ children?: ReactNode; summary?: ReactNode; role?: string; onClick?: () => void }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
/** 렌더 중 상태 맞춤(setState)은 React처럼 같은 렌더를 한 번 더 돌려 반영한다. */
function render(initial: OperatorMfaPolicy) {
  let out: ReactNode = null;
  for (let pass = 0; pass < 2; pass++) { hooks.index = 0; hooks.refIndex = 0; out = OperatorMfaPolicyPanel({ initial, canReset: true, selfId: 'self' }); }
  return out as Element;
}
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); }
const summaries = (tree: Element) => all(tree).filter(element => element.props.summary !== undefined).map(element => text(element.props.summary));

const before: OperatorMfaPolicy = { required: false, revision: 2, updatedAt: '2026-11-18T00:00:00Z', updatedBy: null, unenrolledCount: 0, operators: [
  { id: 'self', nickname: '본인', maskedEmail: 's***@example.test', managerRole: 'primary', verifiedFactors: 1, unverifiedFactors: 0, verifiedAt: '2026-11-18T00:00:00Z' },
  { id: 'lost', nickname: '분실자', maskedEmail: 'l***@example.test', managerRole: 'logistics', verifiedFactors: 1, unverifiedFactors: 0, verifiedAt: '2026-11-18T00:00:00Z' },
] };
let confirm: ReturnType<typeof stubAdminConfirm>;
beforeEach(() => { hooks.state = []; hooks.refs = []; vi.clearAllMocks(); confirm = stubAdminConfirm(true); });
afterEach(() => confirm.restore());

it('초기화 뒤 서버가 새 등록 현황을 내려보내면 다시 마운트하지 않아도 화면이 따라간다', async () => {
  const tree = render(before);
  expect(summaries(tree)).toContain('운영자 2명 · 미등록 0명');
  mocks.reset.mockResolvedValue({ receipt: { profileId: 'lost', factorCount: 1, factorsDeleted: 1, sessionsRevoked: 2 } });
  const button = all(tree).find(element => typeof element.props.onClick === 'function' && text(element) === '초기화')!;
  button.props.onClick!();
  await settle();
  expect(mocks.reset).toHaveBeenCalledExactlyOnceWith('lost', expect.any(String));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  // router.refresh()가 같은 자리에 새 initial(다른 객체, 같은 revision)을 내려보낸다.
  const refreshed = structuredClone(before);
  refreshed.unenrolledCount = 1;
  refreshed.operators[1] = { ...refreshed.operators[1], verifiedFactors: 0, verifiedAt: null };
  const after = render(refreshed);
  expect(summaries(after)).toContain('운영자 2명 · 미등록 1명');
  expect(text(after)).toContain('미등록 1명');
  expect(text(all(after).find(element => element.props.role === 'status'))).toContain('분실자의 2단계 인증을 초기화했습니다');
});

it('늦게 도착한 이전 revision은 방금 켠 상태를 되돌리지 않는다', async () => {
  const tree = render(before);
  mocks.save.mockResolvedValue({ receipt: { required: true, revision: 3, updatedAt: '2026-11-18T01:00:00Z' } });
  const button = all(tree).find(element => typeof element.props.onClick === 'function' && text(element) === '2단계 인증 요구 켜기')!;
  button.props.onClick!();
  await settle();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(true, 2, expect.any(String));
  const stale = render(structuredClone(before));
  expect(text(stale)).toContain('켜짐');
  const fresh = render({ ...structuredClone(before), required: true, revision: 3, updatedAt: '2026-11-18T01:00:00Z', updatedBy: '본인' });
  expect(summaries(fresh)[0]).toContain('본인');
});
