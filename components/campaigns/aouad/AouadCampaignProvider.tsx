'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  loadAouadCampaignState,
  saveAouadCampaignState,
  withAouadZoneComplete,
  type AouadCampaignState,
  initialAouadCampaignState,
} from '@/lib/campaigns/aouad/state';
import {
  loadLastBellCompletion,
  type LastBellCompletionRecord,
} from '@/lib/prototypes/last-bell/completion';
import { getOptionalStorage } from '@/lib/campaigns/aouad/browser-storage';
import type {
  AouadAvatarId,
  AouadIfEndingId,
  AouadRallyZoneId,
  AouadStorePreviewId,
} from '@/lib/campaigns/aouad/content';

type StudentDetails = { name: string | null; avatar: AouadAvatarId | null };

type AouadCampaignContextValue = {
  state: AouadCampaignState;
  lastBellCompletion: LastBellCompletionRecord | null;
  hydrated: boolean;
  markOpeningSeen: (details: StudentDetails) => void;
  updateStudent: (details: StudentDetails) => void;
  completeZone: (zone: AouadRallyZoneId) => void;
  collectClassroomRecord: (recordId: string) => void;
  selectTheaterEnding: (endingId: AouadIfEndingId) => void;
  toggleWishlist: (itemId: AouadStorePreviewId) => void;
  addRooftopEmber: () => void;
  markLastBellCompletionSeen: () => void;
};

const AouadCampaignContext = createContext<AouadCampaignContextValue | null>(null);

export function AouadCampaignProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AouadCampaignState>(initialAouadCampaignState);
  const [lastBellCompletion, setLastBellCompletion] = useState<LastBellCompletionRecord | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storage = getOptionalStorage();
      const completion = storage ? loadLastBellCompletion(storage) : null;
      setLastBellCompletion(completion);
      setState((previous) => ({
        ...(storage ? loadAouadCampaignState(storage) : initialAouadCampaignState),
        lastBellCompletionSeen: completion !== null || previous.lastBellCompletionSeen,
      }));
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const update = useCallback((transform: (previous: AouadCampaignState) => AouadCampaignState) => {
    setState((previous) => {
      const next = transform(previous);
      // Storage is best-effort. The current session remains usable if it fails.
      const storage = getOptionalStorage();
      if (storage) saveAouadCampaignState(storage, next);
      return next;
    });
  }, []);

  const markOpeningSeen = useCallback((details: StudentDetails) => {
    update((previous) => ({ ...previous, openingSeen: true, student: details }));
  }, [update]);

  const updateStudent = useCallback((details: StudentDetails) => {
    update((previous) => ({ ...previous, student: details }));
  }, [update]);

  const completeZone = useCallback((zone: AouadRallyZoneId) => {
    update((previous) => withAouadZoneComplete(previous, zone));
  }, [update]);

  const collectClassroomRecord = useCallback((recordId: string) => {
    update((previous) => {
      const classroomRecords = previous.classroomRecords.includes(recordId)
        ? previous.classroomRecords
        : [...previous.classroomRecords, recordId];
      const next = { ...previous, classroomRecords };
      return classroomRecords.length >= 3 ? withAouadZoneComplete(next, 'classroom') : next;
    });
  }, [update]);

  const selectTheaterEnding = useCallback((endingId: AouadIfEndingId) => {
    update((previous) => {
      const theaterEndings = previous.theaterEndings.includes(endingId)
        ? previous.theaterEndings
        : [...previous.theaterEndings, endingId];
      return withAouadZoneComplete({ ...previous, theaterEndings }, 'theater');
    });
  }, [update]);

  const toggleWishlist = useCallback((itemId: AouadStorePreviewId) => {
    update((previous) => ({
      ...previous,
      wishlist: previous.wishlist.includes(itemId)
        ? previous.wishlist.filter((id) => id !== itemId)
        : [...previous.wishlist, itemId],
    }));
  }, [update]);

  const addRooftopEmber = useCallback(() => {
    update((previous) => withAouadZoneComplete({
      ...previous,
      rooftopEmbers: Math.min(99, previous.rooftopEmbers + 1),
    }, 'rooftop'));
  }, [update]);

  const markLastBellCompletionSeen = useCallback(() => {
    update((previous) => previous.lastBellCompletionSeen
      ? previous
      : { ...previous, lastBellCompletionSeen: true });
  }, [update]);

  const value = useMemo<AouadCampaignContextValue>(() => ({
    state,
    lastBellCompletion,
    hydrated,
    markOpeningSeen,
    updateStudent,
    completeZone,
    collectClassroomRecord,
    selectTheaterEnding,
    toggleWishlist,
    addRooftopEmber,
    markLastBellCompletionSeen,
  }), [state, lastBellCompletion, hydrated, markOpeningSeen, updateStudent, completeZone, collectClassroomRecord, selectTheaterEnding, toggleWishlist, addRooftopEmber, markLastBellCompletionSeen]);

  return <AouadCampaignContext.Provider value={value}>{children}</AouadCampaignContext.Provider>;
}

export function useAouadCampaign(): AouadCampaignContextValue {
  const value = useContext(AouadCampaignContext);
  if (!value) throw new Error('useAouadCampaign must be used within AouadCampaignProvider');
  return value;
}
