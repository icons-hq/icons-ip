import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/claim-contact/client', () => ({ fetchClaimContactContext: vi.fn(), changeClaimContact: vi.fn(), readOrSealClaimContactOperation: vi.fn(), recordClaimReshipmentV2: vi.fn() }));
vi.mock('@/lib/admin/claim-evidence.client', () => ({ uploadClaimEvidence: vi.fn() }));
import { ClaimContactOperationPanel, type ClaimContactReshipTarget } from './ClaimContactOperations';
import type { ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';

/* 주소를 불러오기 전의 첫 화면(실제 React로 그린다). 한 칸에 섞여 있던 두 가지 일을 제목으로 나눈다:
 * '재출고 등록'(출고지마다 버튼 하나)과 주소 고치기(회수지 / 교환품 받을 곳). 이름은 '재출고' 하나로 부른다(화면 규칙 4). */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { capture: () => null, canApply: () => false, authenticate: () => undefined } as unknown as ClaimContactScope;
function render(props: { reshipTargets?: ClaimContactReshipTarget[]; stockDecisionPendingOrigins?: string[]; claimType?: 'return' | 'exchange' } = {}) {
  return renderToStaticMarkup(<ClaimContactOperationPanel carriers={[]} claimId={id(4)} identity={{ actorId: id(1), sessionId: id(2) }} orderId={id(3)}
    reshipItems={[]} reshipTargets={props.reshipTargets ?? []} scope={scope} stockDecisionPendingOrigins={props.stockDecisionPendingOrigins} claimType={props.claimType} />);
}
const target = (n: number, originName: string, collected = true): ClaimContactReshipTarget => ({ shipmentId: id(30 + n), originName, collected, waivable: !collected, orderItemIds: [] });

describe('재출고 등록과 주소 고치기의 첫 화면', () => {
  it('재출고할 출고지가 있으면 재출고 등록을 먼저, 주소 고치기를 그 아래에 제목을 나눠 보인다', () => {
    const html = render({ reshipTargets: [target(1, '김포'), target(2, '남양주', false)] });
    expect(html).toContain('aria-label="재출고 등록과 주소 고치기"');
    expect(html).toMatch(/<h3[^>]*>재출고 등록<\/h3>/u);
    expect(html).toMatch(/<h3[^>]*>회수지·교환품 받을 곳<\/h3>/u);
    expect(html.indexOf('>재출고 등록</h3>')).toBeLessThan(html.indexOf('>회수지·교환품 받을 곳</h3>'));
    expect(html).toMatch(/<button[^>]*data-claim-reship-target="[^"]+"[^>]*>김포 재출고 등록<\/button>/u);
    expect(html).toContain('남양주 재출고 등록 (회수 없이)</button>');
    expect(html).toContain('출고지마다 따로 재출고합니다.');
    expect(html).toContain('>회수지 보기·고치기</button>');
    expect(html).toContain('>교환품 받을 곳 보기·고치기</button>');
    expect(html).toContain('회수를 시작하기 전, 교환품을 보내기 전까지만 고칠 수 있습니다.');
    expect(html).not.toContain('재배송');
    expect(html).not.toContain('type="checkbox"');
  });

  it('재출고할 출고지가 없으면 재출고 등록 제목을 그리지 않는다. 재고 처리를 기다리는 출고지는 이유를 보인다', () => {
    expect(render()).not.toMatch(/<h3[^>]*>재출고 등록<\/h3>/u);
    const waiting = render({ stockDecisionPendingOrigins: ['김포'] });
    expect(waiting).toMatch(/<h3[^>]*>재출고 등록<\/h3>/u);
    expect(waiting).toContain('김포: 처리 칸의 회수품 재고 처리를 저장하면 재출고를 등록할 수 있습니다.');
    expect(waiting).not.toContain('data-claim-reship-target');
  });

  it('반품에는 교환품 받을 곳이 없다', () => {
    const html = render({ claimType: 'return' });
    expect(html).toContain('aria-label="회수지 고치기"');
    expect(html).toMatch(/<h3[^>]*>회수지<\/h3>/u);
    expect(html).toContain('>회수지 보기·고치기</button>');
    expect(html).not.toContain('교환품');
    expect(html).toContain('회수를 시작하기 전까지만 고칠 수 있습니다.');
  });
});
