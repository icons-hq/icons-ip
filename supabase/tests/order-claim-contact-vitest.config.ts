import base from '../../vitest.config';
import { defineConfig } from 'vitest/config';
export default defineConfig({ ...base, test: { ...base.test, include: ['supabase/tests/order_claim_contact_http.live.ts'] } });
