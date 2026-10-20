import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ admin: vi.fn(), customer: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/claim-contact/client', () => ({ fetchAdminClaimContactHistory: reads.admin, fetchMyClaimContactHistory: reads.customer }));
vi.mock('@/lib/supabase/client', () => ({ createClient: reads.auth }));
import { ClaimContactHistory } from './ClaimContactHistory';
import { ClaimContactSession } from './ClaimContactSession';

it('server rendering never resolves session children or loads contact PII', () => {
  const child = vi.fn(() => <p>must never serialize private contact</p>);
  const html = renderToStaticMarkup(<ClaimContactSession actorId="10000000-0000-4000-8000-000000000001">{child}</ClaimContactSession>);
  expect(html).toContain('로그인 상태를 확인'); expect(html).not.toContain('private contact'); expect(child).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(<ClaimContactHistory actorId="10000000-0000-4000-8000-000000000001" orderId="10000000-0000-4000-8000-000000000002" claimId="10000000-0000-4000-8000-000000000003" />)).toContain('로그인 상태를 확인');
  expect(reads.admin).not.toHaveBeenCalled(); expect(reads.customer).not.toHaveBeenCalled(); expect(reads.auth).not.toHaveBeenCalled();
});
