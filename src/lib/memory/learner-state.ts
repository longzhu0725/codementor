import { LearnerState, MasteryEntry, ErrorRecord, SessionCheckpoint } from '@/types';

// ============================================================
// Learner State Management
// Inspired by Claude Code's memory system (CLAUDE.md + auto memory)
// and IntelliCode's centralized versioned learner state
// ============================================================

export function createDefaultLearnerState(userId: string = 'default'): LearnerState {
  return {
    userId,
    mastery: {},
    errorRecords: [],
    learningPlan: null,
    behaviorProfile: {
      avgSolveTime: 0,
      hintUsageRate: 0,
      preferredTopics: [],
      strugglingTopics: [],
      activeHours: [new Date().getHours()],
      totalProblemsAttempted: 0,
      totalProblemsSolved: 0,
      streak: 0,
      lastActiveDate: new Date().toISOString().split('T')[0],
    },
    checkpoints: [],
    preferences: {
      language: 'zh-CN',
      hintLevel: 2,
      targetGroup: 'self_learner',
    },
  };
}

// SM-2 Spaced Repetition Algorithm
export function updateMasteryWithSM2(
  entry: MasteryEntry,
  quality: number // 0-5
): MasteryEntry {
  let { interval, easeFactor } = entry;

  if (quality < 3) {
    interval = 1;
  } else {
    if (interval === 0) {
      interval = 1;
    } else if (interval === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  easeFactor = Math.max(1.3, easeFactor);

  const now = Date.now();
  const nextReview = now + interval * 24 * 60 * 60 * 1000;

  // BKT-inspired mastery update
  const slip = 0.1;
  const guess = 0.25;
  const forgetRate = 0.05;
  const prior = entry.mastery * (1 - forgetRate);

  let posterior: number;
  if (quality >= 3) {
    // Correct answer
    const likelihood = prior * (1 - slip) + (1 - prior) * guess;
    posterior = (prior * (1 - slip)) / likelihood;
  } else {
    // Incorrect answer
    const likelihood = prior * slip + (1 - prior) * (1 - guess);
    posterior = (prior * slip) / likelihood;
  }

  return {
    ...entry,
    mastery: Math.min(1.0, Math.max(0.0, posterior)),
    attempts: entry.attempts + 1,
    successes: entry.attempts + (quality >= 3 ? 1 : 0),
    lastAttempt: now,
    nextReview,
    interval,
    easeFactor,
  };
}

export function getMasteryEntry(
  state: LearnerState,
  topicId: string
): MasteryEntry {
  if (!state.mastery[topicId]) {
    state.mastery[topicId] = {
      topicId,
      mastery: 0.5, // Beta prior
      attempts: 0,
      successes: 0,
      lastAttempt: 0,
      nextReview: 0,
      interval: 0,
      easeFactor: 2.5,
      misconceptions: [],
    };
  }
  return state.mastery[topicId];
}

export function recordAttempt(
  state: LearnerState,
  topicId: string,
  quality: number,
  misconceptions: string[] = []
): LearnerState {
  const entry = getMasteryEntry(state, topicId);
  const updated = updateMasteryWithSM2(entry, quality);

  if (misconceptions.length > 0) {
    updated.misconceptions = [...new Set([...entry.misconceptions, ...misconceptions])];
  }

  return {
    ...state,
    mastery: { ...state.mastery, [topicId]: updated },
    behaviorProfile: {
      ...state.behaviorProfile,
      totalProblemsAttempted: state.behaviorProfile.totalProblemsAttempted + 1,
      totalProblemsSolved:
        state.behaviorProfile.totalProblemsSolved + (quality >= 3 ? 1 : 0),
    },
  };
}

export function recordError(
  state: LearnerState,
  error: Omit<ErrorRecord, 'timestamp' | 'resolved'>
): LearnerState {
  const errorRecord: ErrorRecord = {
    ...error,
    timestamp: Date.now(),
    resolved: false,
  };

  return {
    ...state,
    errorRecords: [...state.errorRecords, errorRecord],
  };
}

export function addCheckpoint(
  state: LearnerState,
  checkpoint: Omit<SessionCheckpoint, 'timestamp'>
): LearnerState {
  const fullCheckpoint: SessionCheckpoint = {
    ...checkpoint,
    timestamp: Date.now(),
  };

  // Keep only recent 5 checkpoints (ATLAS-style)
  const checkpoints = [...state.checkpoints, fullCheckpoint].slice(-5);

  return {
    ...state,
    checkpoints,
  };
}

export function getDueReviews(state: LearnerState): string[] {
  const now = Date.now();
  return Object.values(state.mastery)
    .filter((entry) => entry.nextReview > 0 && entry.nextReview <= now)
    .map((entry) => entry.topicId);
}

export function getStrugglingTopics(state: LearnerState): string[] {
  return Object.values(state.mastery)
    .filter((entry) => entry.mastery < 0.4 && entry.attempts > 0)
    .sort((a, b) => a.mastery - b.mastery)
    .map((entry) => entry.topicId);
}

export function getCheckpointSummary(state: LearnerState): string {
  if (state.checkpoints.length === 0) {
    return '新学习者，暂无历史记录。';
  }

  const recent = state.checkpoints.slice(-3);
  const summaries = recent.map((cp) => `[${cp.intent}] ${cp.summary}`);

  const totalTopics = Object.keys(state.mastery).length;
  const avgMastery =
    totalTopics > 0
      ? Object.values(state.mastery).reduce((sum, m) => sum + m.mastery, 0) / totalTopics
      : 0;

  return `学习者画像：已练习 ${totalTopics} 个知识点，平均掌握度 ${avgMastery.toFixed(2)}。
已做 ${state.behaviorProfile.totalProblemsAttempted} 题，正确 ${state.behaviorProfile.totalProblemsSolved} 题。
近期交互：\n${summaries.join('\n')}`;
}

export function updateStreak(state: LearnerState): LearnerState {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let streak = state.behaviorProfile.streak;
  if (state.behaviorProfile.lastActiveDate === today) {
    // Already updated today
  } else if (state.behaviorProfile.lastActiveDate === yesterday) {
    streak += 1;
  } else {
    streak = 1;
  }

  return {
    ...state,
    behaviorProfile: {
      ...state.behaviorProfile,
      streak,
      lastActiveDate: today,
    },
  };
}
