import base from '../../vitest.config';
import { defineConfig } from 'vitest/config';
export default defineConfig({ ...base, test: { ...base.test, include: ['supabase/tests/review_helpful_contract.live.ts'] } });
