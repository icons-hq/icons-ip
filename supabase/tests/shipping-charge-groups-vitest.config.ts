import base from '../../vitest.config';
import { defineConfig } from 'vitest/config';

export default defineConfig({ ...base, test: { ...base.test, include: ['supabase/tests/shipping_charge_groups_contract.live.ts'] } });
