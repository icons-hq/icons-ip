import base from '../../vitest.config';
import { defineConfig } from 'vitest/config';

export default defineConfig({ ...base, test: { ...base.test, include: ['supabase/tests/goods_sales_precheckout_contract.live.ts'] } });
