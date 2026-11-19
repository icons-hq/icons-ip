import { transactionExactKeys, transactionInstant, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';

/** 운영자 주문 상세의 '결제 전 확인 동의'(PAY-015). 주문을 만들 때 고객이 체크한 사실의 서버 기록이다. */
export interface AdminOrderAcknowledgementGood { goodId: string; name: string; returnAllowed: boolean | null; exchangeAllowed: boolean | null; reason: string | null }
export interface AdminOrderAcknowledgement {
  orderId: string;
  acknowledgedAt: string;
  noticeVersion: string;
  /** 동의 시점에 청약철회·교환이 제한돼 있던 굿즈. */
  restrictedGoods: AdminOrderAcknowledgementGood[];
}

export function parseAdminOrderAcknowledgement(value: unknown): AdminOrderAcknowledgement | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['orderId', 'acknowledgedAt', 'noticeVersion', 'restrictedGoods'])
    || !isUuid(value.orderId) || !transactionInstant(value.acknowledgedAt)
    || typeof value.noticeVersion !== 'string' || !value.noticeVersion || value.noticeVersion.length > 40
    || !Array.isArray(value.restrictedGoods) || value.restrictedGoods.length > 200) return null;
  for (const good of value.restrictedGoods) {
    if (!transactionRecord(good) || !transactionExactKeys(good, ['goodId', 'name', 'returnAllowed', 'exchangeAllowed', 'reason'])
      || typeof good.goodId !== 'string' || !good.goodId || typeof good.name !== 'string'
      || (good.returnAllowed !== null && typeof good.returnAllowed !== 'boolean')
      || (good.exchangeAllowed !== null && typeof good.exchangeAllowed !== 'boolean')
      || (good.reason !== null && typeof good.reason !== 'string')) return null;
  }
  return value as unknown as AdminOrderAcknowledgement;
}
