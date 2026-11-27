import { CATEGORY_HELP } from './category';
import { CLAIM_DETAIL_HELP } from './claim-detail';
import { CLAIM_QUEUE_HELP } from './claim-queue';
import { ERP_ITEMS_HELP } from './erp-items';
import { GOOD_EDITOR_HELP } from './good-editor';
import { GOOD_EDITOR_B7_HELP } from './good-editor-b7';
import { GOOD_FIELDS_A_HELP } from './good-fields-a';
import { GOOD_FIELDS_B_HELP } from './good-fields-b';
import { GOOD_OPTIONS_HELP } from './good-options';
import { GOOD_PICKERS_B_HELP } from './good-pickers-b';
import { GOOD_SALE_TIMING_HELP } from './good-sale-timing';
import { GOODS_LIST_HELP } from './goods-list';
import { ORDER_DETAIL_HELP } from './order-detail';
import { PG_SETTLEMENTS_HELP } from './pg-settlements';
import { SALES_AUTO_ORDER_CONFIRM_HELP } from './sales-auto-order-confirm';
import { SALES_DISPATCH_HELP } from './sales-dispatch';
import { SALES_ORDERS_HELP } from './sales-orders';
import { SHIPPING_REGIONS_HELP } from './shipping-regions';
import { STOCK_RECONCILE_HELP } from './stock-reconcile';
import type { AdminHelpBook } from './types';

/**
 * 어드민 "?" 도움말 묶음 전체. 화면을 하나 정리할 때마다 `lib/admin/help/<화면>.ts`를 만들고 여기에 등록한다 —
 * 등록해야 문구 검사(help-contract.test.ts)가 본다.
 */
export const ADMIN_HELP_BOOKS: Readonly<Record<string, AdminHelpBook>> = {
  category: CATEGORY_HELP,
  'claim-detail': CLAIM_DETAIL_HELP,
  'claim-queue': CLAIM_QUEUE_HELP,
  'erp-items': ERP_ITEMS_HELP,
  'good-editor': GOOD_EDITOR_HELP,
  'good-editor-b7': GOOD_EDITOR_B7_HELP,
  'good-fields-a': GOOD_FIELDS_A_HELP,
  'good-fields-b': GOOD_FIELDS_B_HELP,
  'good-options': GOOD_OPTIONS_HELP,
  'good-pickers-b': GOOD_PICKERS_B_HELP,
  'good-sale-timing': GOOD_SALE_TIMING_HELP,
  'goods-list': GOODS_LIST_HELP,
  'order-detail': ORDER_DETAIL_HELP,
  'pg-settlements': PG_SETTLEMENTS_HELP,
  'sales-auto-order-confirm': SALES_AUTO_ORDER_CONFIRM_HELP,
  'sales-dispatch': SALES_DISPATCH_HELP,
  'sales-orders': SALES_ORDERS_HELP,
  'shipping-regions': SHIPPING_REGIONS_HELP,
  'stock-reconcile': STOCK_RECONCILE_HELP,
};
