import { isUuid } from '@/lib/uuid';
import { findGoodsImagePosition, type GoodsImageSlots } from './goods-image-grid';

export interface GoodsPhotoEditTicket { owner: symbol; epoch: number; actorId: string; recordId: string; tileKey: string; sourcePath: string }
export interface GoodsPhotoEditGuardSnapshot { ready: boolean; blocked: boolean; busy: boolean }
/** Session identity only prevents stale local work; server actions authorize every upload. */
export function createGoodsPhotoEditGuard(actorId: string, recordId: string) {
  const owner = Symbol('goods-photo-edit');
  const initial: GoodsPhotoEditGuardSnapshot = { ready: false, blocked: false, busy: false };
  const listeners = new Set<() => void>();
  let snapshot = initial, mounted = false, epoch = 0, session: string | null = null;
  const update = (change: Partial<GoodsPhotoEditGuardSnapshot>) => { snapshot = { ...snapshot, ...change }; listeners.forEach(listener => listener()); };
  const available = () => mounted && snapshot.ready && !snapshot.blocked && !snapshot.busy;
  const current = (ticket: GoodsPhotoEditTicket) => mounted && snapshot.ready && !snapshot.blocked
    && ticket.owner === owner && ticket.epoch === epoch && ticket.actorId === actorId && ticket.recordId === recordId;
  return {
    getSnapshot: () => snapshot, getServerSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { mounted = true; epoch++; session = null; update({ ...initial, busy: snapshot.busy }); },
    dispose() { mounted = false; epoch++; },
    setBusy(busy: boolean) { if (snapshot.busy !== busy) update({ busy }); },
    authenticate(currentActorId: string | null, currentSessionId: string | null) {
      if (!mounted || snapshot.blocked) return;
      if (!isUuid(actorId) || actorId !== currentActorId || !currentSessionId || session !== null && session !== currentSessionId) {
        epoch++; update({ ready: true, blocked: true }); return;
      }
      session = currentSessionId;
      if (!snapshot.ready) update({ ready: true });
    },
    capture(tileKey: string, sourcePath: string): GoodsPhotoEditTicket | null {
      return available() ? { owner, epoch, actorId, recordId, tileKey, sourcePath } : null;
    },
    isCurrent: current,
    canApply: (ticket: GoodsPhotoEditTicket) => available() && current(ticket),
  };
}
export function goodsPhotoEditTarget(slots: GoodsImageSlots, ticket: GoodsPhotoEditTicket) {
  const position = findGoodsImagePosition(slots, ticket.tileKey), tile = slots[position];
  return tile && tile.path === ticket.sourcePath && (tile.status === 'saved' || tile.status === 'uploaded') ? position : -1;
}
