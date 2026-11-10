import type { AdminGiftRow } from '@/lib/admin/gifts';
export const giftConsoleId = (n: number) => `93955000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const adminGiftRow: AdminGiftRow = { id: giftConsoleId(1), state: 'awaiting_acceptance', senderName: 'TEST 보낸 사람', recipientName: null,
  goodsLabel: 'TEST 상품 / 기본 × 2', quantity: 2, createdAt: '2026-10-14T01:00:00Z', expiresAt: '2026-10-21T01:00:00Z', acceptedAt: null, orderId: null };
