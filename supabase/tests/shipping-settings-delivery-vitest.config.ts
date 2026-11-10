import base from '../../vitest.config';
import { defineConfig } from 'vitest/config';
export default defineConfig({ ...base, test: { ...base.test, include: ['supabase/tests/shipping_settings_delivery_contract.live.ts'] } });
