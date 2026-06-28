'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorRecord, LearnerState, SessionCheckpoint } from '@/types';
import {
  addCheckpoint as addCheckpointToState,
  createDefaultLearnerState,
  recordAttempt as recordAttemptToState,
  recordError as recordErrorToState,
} from '@/lib/memory/learner-state';

const STORAGE_KEY = 'codementor:learner-state:v1';

/** Either a partial patch or a functional updater. */
export type LearnerStateUpdater =
  | Partial<LearnerState>
  | ((prev: LearnerState) => LearnerState);

function loadFromStorage(): LearnerState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LearnerState;
    // Basic shape guard; fall back to defaults if it looks corrupted.
    if (!parsed || typeof parsed !== 'object' || !parsed.behaviorProfile) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(state: LearnerState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage might be full or unavailable; ignore silently.
  }
}

export interface UseLearnerStateReturn {
  state: LearnerState;
  updateState: (updater: LearnerStateUpdater) => void;
  recordAttempt: (
    topicId: string,
    quality: number,
    misconceptions?: string[]
  ) => void;
  recordError: (error: Omit<ErrorRecord, 'timestamp' | 'resolved'>) => void;
  addCheckpoint: (checkpoint: Omit<SessionCheckpoint, 'timestamp'>) => void;
  resetState: () => void;
}

/**
 * Manages the learner state, persisting it to localStorage and exposing
 * high-level mutation helpers backed by the pure functions in
 * `@/lib/memory/learner-state`.
 */
export function useLearnerState(
  userId: string = 'default'
): UseLearnerStateReturn {
  // Start from defaults to avoid SSR/CSR hydration mismatch, then hydrate
  // from localStorage in an effect.
  const [state, setState] = useState<LearnerState>(() =>
    createDefaultLearnerState(userId)
  );
  const hydrated = useRef(false);

  // Hydrate once on mount.
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      setState({ ...stored, userId: stored.userId || userId });
    } else {
      setState((prev) => ({ ...prev, userId }));
    }
    hydrated.current = true;
  }, [userId]);

  // Persist on every change (after hydration).
  useEffect(() => {
    if (!hydrated.current) return;
    saveToStorage(state);
  }, [state]);

  const updateState = useCallback((updater: LearnerStateUpdater) => {
    setState((prev) => {
      if (typeof updater === 'function') {
        return updater(prev);
      }
      return { ...prev, ...updater };
    });
  }, []);

  const recordAttempt = useCallback(
    (topicId: string, quality: number, misconceptions: string[] = []) => {
      setState((prev) => recordAttemptToState(prev, topicId, quality, misconceptions));
    },
    []
  );

  const recordError = useCallback(
    (error: Omit<ErrorRecord, 'timestamp' | 'resolved'>) => {
      setState((prev) => recordErrorToState(prev, error));
    },
    []
  );

  const addCheckpoint = useCallback(
    (checkpoint: Omit<SessionCheckpoint, 'timestamp'>) => {
      setState((prev) => addCheckpointToState(prev, checkpoint));
    },
    []
  );

  const resetState = useCallback(() => {
    const fresh = createDefaultLearnerState(userId);
    setState(fresh);
    saveToStorage(fresh);
  }, [userId]);

  return {
    state,
    updateState,
    recordAttempt,
    recordError,
    addCheckpoint,
    resetState,
  };
}
