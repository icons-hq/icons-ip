import 'server-only';
import { ADDRESS_BOOK_LIMIT, orderAddressBook, parseAddressBookRow, type AddressBookEntry } from './address-book';
import { createClient } from './supabase/server';

interface AddressBookReader {
  from(table: 'address_book_entries'): {
    select(columns: string): {
      eq(column: 'user_id', value: string): {
        order(column: string, options: { ascending: boolean }): {
          order(column: string, options: { ascending: boolean }): {
            limit(count: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
          };
        };
      };
    };
  };
}

/**
 * 내 주소록(본인 RLS 읽기). 기본 배송지 먼저, 나머지는 등록 순.
 * 읽지 못하면 null — 화면은 "주소록이 비었다"고 단정하지 않는다.
 * user_id 조건은 RLS 와 같은 범위를 한 번 더 적는 방어선이다.
 */
export async function loadMyAddressBook(userId: string, supplied?: AddressBookReader): Promise<AddressBookEntry[] | null> {
  try {
    const client = supplied ?? ((await createClient()) as unknown as AddressBookReader);
    const { data, error } = await client
      .from('address_book_entries')
      .select('id,label,recipient_name,phone,postal_code,address1,address2,is_default,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(ADDRESS_BOOK_LIMIT);
    if (error || !Array.isArray(data)) return null;
    const entries = data.map(parseAddressBookRow);
    if (entries.some((entry) => entry === null)) return null;
    return orderAddressBook(entries as AddressBookEntry[]);
  } catch {
    return null;
  }
}
