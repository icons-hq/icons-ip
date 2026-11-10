import { INQUIRY_DRAFT_PREFIX } from './inquiry-drafts';
import { CS_EDITOR_DRAFT_PREFIX } from './cs-editor-drafts';

export const INQUIRY_DRAFT_SIGN_OUT_EVENT = 'icons:inquiry-drafts:signed-out';
const CHANNEL = 'icons:inquiry-drafts:session';
const SIGNAL_KEY = 'icons:inquiry-drafts:sign-out';

export function clearInquiryDraftStorage(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(INQUIRY_DRAFT_PREFIX) || key?.startsWith(CS_EDITOR_DRAFT_PREFIX)) storage.removeItem(key);
  }
}

export function clearInquiryDraftsInThisTab() {
  if (typeof window === 'undefined') return;
  try { clearInquiryDraftStorage(window.sessionStorage); } catch { /* Storage can be blocked. */ }
  window.dispatchEvent(new Event(INQUIRY_DRAFT_SIGN_OUT_EVENT));
}

/** Runs before server-action logout, which does not emit the browser SDK's auth event. */
export function clearInquiryDraftsForSignOut() {
  clearInquiryDraftsInThisTab();
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage('signed-out');
    channel.close();
  } catch { /* The storage event below is the fallback. */ }
  try { window.localStorage.setItem(SIGNAL_KEY, crypto.randomUUID()); window.localStorage.removeItem(SIGNAL_KEY); }
  catch { /* No text, user identifier or token is included in either signal. */ }
}

/** Mount once at the app auth boundary so tabs outside the inquiry page also purge their store. */
export function observeInquiryDraftSignOut() {
  const receive = (event: MessageEvent) => { if (event.data === 'signed-out') clearInquiryDraftsInThisTab(); };
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(CHANNEL); channel.addEventListener('message', receive); } catch { /* Fallback below. */ }
  const storage = (event: StorageEvent) => { if (event.key === SIGNAL_KEY && event.newValue) clearInquiryDraftsInThisTab(); };
  window.addEventListener('storage', storage);
  return () => { channel?.close(); window.removeEventListener('storage', storage); };
}
