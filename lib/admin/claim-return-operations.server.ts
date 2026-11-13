import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { CLAIM_RETURN_OPERATIONS_OFF, parseClaimReturnOperations, type ClaimReturnOperations } from './claim-return-pickup';

/**
 * 반품·교환 목록 위 운영 요약(자동 수거 실패 건수·반품입고 회신 업로드). 스위치가 꺼져 있거나 읽지 못하면 꺼진 것으로 읽는다 —
 * 목록 화면은 지금과 같다(읽기 실패 때 없는 기능을 보이지 않는다).
 */
export async function loadClaimReturnOperations(): Promise<ClaimReturnOperations> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_claim_return_operations');
  if (error) return CLAIM_RETURN_OPERATIONS_OFF;
  return parseClaimReturnOperations(data) ?? CLAIM_RETURN_OPERATIONS_OFF;
}
