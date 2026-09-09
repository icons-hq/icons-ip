import 'server-only';
import { createServiceClient,getServiceRoleConfig } from '@/lib/supabase/service';
import type { BankTransferAccount } from './bank-transfer';

/** #426: one server-only projection reads the admin-managed display account.
 * An empty setting or a failed read closes new bank-transfer checkout. Legacy env
 * values are deliberately ignored so clearing the setting cannot resurrect them. */
export async function getBankTransferAccount():Promise<BankTransferAccount|null> {
  if (!getServiceRoleConfig().isConfigured) return null;
  try {
    const {data,error}=await createServiceClient().rpc('get_bank_transfer_settings');
    if (error || !data || typeof data!=='object') return null;
    const bank=typeof data.bank==='string'?data.bank.trim():'';
    const accountNumber=typeof data.accountNumber==='string'?data.accountNumber.trim():'';
    const holder=typeof data.holder==='string'?data.holder.trim():'';
    return bank&&accountNumber&&holder?{bank,accountNumber,holder}:null;
  } catch { return null; }
}
/** The bank-transfer method has no PG provider gate. */
export async function bankTransferCheckoutEnabled():Promise<boolean> {
  return (await getBankTransferAccount())!==null;
}
