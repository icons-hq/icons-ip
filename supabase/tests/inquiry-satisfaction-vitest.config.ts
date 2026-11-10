import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.config';
export default mergeConfig(base, defineConfig({ test: { include: ['supabase/tests/inquiry_satisfaction_contract.live.ts'] } }));
