import 'server-only';

import { createServiceClient } from '../supabase/service';
import { createGoodsPaymentCheckout } from './goods-checkout';
import { createGoodsPaymentAttemptRepository } from './goods-checkout.server';
import { getPaymentGateway } from './runtime-gateway';

/** Composition root kept outside the deep module so tests can supply Fake. */
export function createRuntimeGoodsPaymentCheckout() {
  return createGoodsPaymentCheckout({
    provider: 'korpay',
    gateway: getPaymentGateway(),
    repository: createGoodsPaymentAttemptRepository(createServiceClient()),
  });
}
