import 'server-only';
import { createClient } from './supabase/server';
import { parseMyInquirySatisfaction, type InquirySatisfactionLoad } from './inquiry-satisfaction';

/** A failed optional panel never removes a readable conversation or becomes an unrated vote. */
export async function loadMyInquirySatisfaction(inquiryId: string): Promise<InquirySatisfactionLoad> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_my_inquiry_satisfaction', { p_inquiry_id: inquiryId });
    const parsed = !error && parseMyInquirySatisfaction(data);
    return parsed && parsed.inquiryId === inquiryId ? { ok: true, value: parsed } : { ok: false };
  } catch { return { ok: false }; }
}
