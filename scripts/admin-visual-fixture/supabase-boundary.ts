const error = '합성 화면 검수에서는 Supabase·인증·DB에 연결하지 않습니다.';

export function getSupabaseConfig() { return { url: undefined, key: undefined, isConfigured: false }; }
export function requireSupabaseConfig(): never { throw new Error(error); }
export function createClient(): never { throw new Error(error); }
