import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGoodsPaymentConfirmHandler } from '@/app/api/payments/goods/confirm/route';
import { FakePaymentGateway } from '@/lib/payments/fake-payment-gateway';
import {
  PAYMENT_OUTCOMES,
  type ConfirmOutcome,
  type PaymentOutcome,
  type PreparedCheckout,
} from '@/lib/payments/gateway';
import { createGoodsPaymentAttemptRepository } from '@/lib/payments/goods-checkout.server';
import { createGoodsPaymentCheckout } from '@/lib/payments/goods-checkout';

const runLocalIntegration = process.env.RUN_LOCAL_GOODS_PAYMENT_INTEGRATION === 'true';

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local integration environment: ${name}`);
  return value;
}

describe.skipIf(!runLocalIntegration)('goods payment confirm route local integration', () => {
  it('Fake 5 outcomes가 route→RPC repository→DB finalizer를 관통한다', async () => {
    const supabase = createClient(
      requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
      requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const repository = createGoodsPaymentAttemptRepository(supabase);
    const suffix = requiredEnvironment('GOODS_PAYMENT_INTEGRATION_SUFFIX');
    const email = `goods-route-${suffix}@example.test`;
    const password = `Local-${suffix}-Pass9!`;
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nickname: `goods_route_${suffix}` },
    });
    expect(createUserError).toBeNull();
    expect(createdUser.user).not.toBeNull();
    const testUserId = createdUser.user!.id;

    const { data: identityResult, error: identityError } = await supabase.rpc(
      'service_update_profile_identity',
      {
        p_user_id: testUserId,
        p_nickname: `goods_route_${suffix}`,
        p_avatar_path: null,
        p_replace_avatar: false,
      },
    );
    expect(identityError).toBeNull();
    expect(identityResult).toEqual([
      expect.objectContaining({ applied: true, error_code: null }),
    ]);

    const userSupabase = createClient(
      requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
      requiredEnvironment('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: signInError } = await userSupabase.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();

    const { error: profileError } = await userSupabase.from('profiles').update({
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: new Date().toISOString(),
    }).eq('id', testUserId);
    expect(profileError).toBeNull();

    const { data: availableGoods, error: availableGoodsError } = await userSupabase
      .from('goods')
      .select('id,price,stock_qty')
      .is('archived_at', null)
      .neq('stock', 'soldout')
      .gt('price', 0)
      .gte('stock_qty', PAYMENT_OUTCOMES.length)
      .order('id')
      .limit(1)
      .single();
    expect(availableGoodsError).toBeNull();
    expect(availableGoods).not.toBeNull();

    const { data: publicGood, error: publicGoodError } = await userSupabase
      .from('goods')
      .select('id,price,ip_id,name,type')
      .eq('id', availableGoods!.id)
      .single();
    expect(publicGoodError).toBeNull();

    const checkoutAddress = {
      recipientName: '로컬 결제 통합',
      phone: '01012345678',
      postalCode: '01234',
      address1: '서울시 로컬구 통합로 205',
    };

    const createOrder = async () => {
      const { error: cartError } = await userSupabase.from('cart_items').upsert({
        user_id: testUserId,
        good_id: publicGood!.id,
        qty: 1,
      }, { onConflict: 'user_id,good_id' });
      expect(cartError).toBeNull();

      const { data: orderId, error: orderError } = await supabase.rpc('place_order', {
        p_user_id: testUserId,
        p_address: checkoutAddress,
        p_checkout_key: randomUUID(),
      });
      expect(orderError).toBeNull();
      expect(typeof orderId).toBe('string');
      return orderId as string;
    };

    const outcomeOrders = new Map<PaymentOutcome, string>();
    for (const paymentOutcome of PAYMENT_OUTCOMES) {
      const orderId = await createOrder();
      outcomeOrders.set(paymentOutcome, orderId);

      const { data: order, error: orderReadError } = await userSupabase
        .from('orders')
        .select('total')
        .eq('id', orderId)
        .single();
      expect(orderReadError).toBeNull();
      expect(order!.total).toBeGreaterThan(0);

      const attempt = await repository.prepareOrderAttempt({
        userId: testUserId,
        orderId,
        provider: 'korpay',
      });
      expect(attempt.amount).toBe(order!.total);
      const callbackNonce = `fake-callback-${paymentOutcome}-${suffix}`;
      const prepared: PreparedCheckout = {
        attemptId: attempt.id,
        provider: attempt.provider,
        action: { kind: 'redirect', url: 'https://fake.invalid/checkout' },
        callbackNonce,
        expiresAt: attempt.expiresAt,
      };
      const providerOutcome: ConfirmOutcome = {
        attemptId: attempt.id,
        provider: attempt.provider,
        outcome: paymentOutcome,
        ...(paymentOutcome === 'approved'
          ? { evidence: { providerTransactionId: `fake-approved-${suffix}` } }
          : {}),
      };
      const gateway = new FakePaymentGateway({
        prepare: [prepared],
        confirm: [providerOutcome],
      });
      const checkout = createGoodsPaymentCheckout({
        provider: 'korpay',
        gateway,
        repository,
      });

      await expect(checkout.prepare({ userId: testUserId, orderId })).resolves.toEqual(prepared);

      const handler = createGoodsPaymentConfirmHandler({
        // The durable attempt already exists; a rollout pause must drain this
        // known in-flight callback without opening any new checkout.
        confirmationAvailable: () => true,
        createCheckout: () => checkout,
      });
      const response = await handler(new Request(
        'http://127.0.0.1/api/payments/goods/confirm',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerOrderId: attempt.providerOrderId,
            callbackNonce,
            providerPayload: { fake: true, outcome: paymentOutcome },
          }),
        },
      ));

      expect(response.status).toBe(
        paymentOutcome === 'unknown' || paymentOutcome === 'needs_review' ? 202 : 200,
      );
      await expect(response.json()).resolves.toEqual({
        attemptId: attempt.id,
        outcome: paymentOutcome,
      });
    }

    const orderIds = [...outcomeOrders.values()];
    const { data: attempts, error: attemptsError } = await supabase
      .from('payment_attempts')
      .select('ref_id,state,payment_id')
      .in('ref_id', orderIds);
    expect(attemptsError).toBeNull();
    expect(attempts).toHaveLength(PAYMENT_OUTCOMES.length);

    for (const paymentOutcome of PAYMENT_OUTCOMES) {
      const attempt = attempts!.find((candidate) => (
        candidate.ref_id === outcomeOrders.get(paymentOutcome)
      ));
      expect(attempt?.state).toBe(paymentOutcome);
      expect(attempt?.payment_id === null).toBe(paymentOutcome !== 'approved');
    }

    const { data: orders, error: ordersError } = await userSupabase
      .from('orders')
      .select('id,status')
      .in('id', orderIds);
    expect(ordersError).toBeNull();
    for (const paymentOutcome of PAYMENT_OUTCOMES) {
      expect(orders!.find((order) => order.id === outcomeOrders.get(paymentOutcome))?.status)
        .toBe(paymentOutcome === 'approved' ? 'paid' : 'pending');
    }

    const { count: paymentCount, error: paymentCountError } = await userSupabase
      .from('payment_summaries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', testUserId);
    expect(paymentCountError).toBeNull();
    expect(paymentCount).toBe(1);
  });
});
