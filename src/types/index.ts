// ============================================================
// CodeMentor Type Definitions
// ============================================================

// --- Agent Types ---

export type AgentRole =
  | 'orchestrator'
  | 'lecturer'
  | 'problem_setter'
  | 'examiner'
  | 'path_planner';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  agentRole?: AgentRole;
  toolCallId?: string;
  toolName?: string;
  timestamp?: number;
}

export interface SubAgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: 'high' | 'medium' | 'low';
}

export interface AgentLoopOptions {
  maxTurns: number;
  maxBudgetUsd: number;
  effort: 'low' | 'medium' | 'high';
}

// --- Intent Types ---

export type UserIntent = 'chat' | 'practice' | 'plan' | 'review' | 'unknown';

export interface IntentRecognitionResult {
  intent: UserIntent;
  topic?: string;
  confidence: number;
  reasoning: string;
}

// --- Knowledge Types ---

export interface KnowledgeTopic {
  id: string;
  name: string;
  category: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  prerequisites: string[];
  description: string;
  keyPoints: string[];
  commonMistakes: string[];
  learningOrder: number;
}

export interface AlgorithmProblem {
  id: string;
  title: string;
  topicId: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  description: string;
  examples: { input: string; output: string; explanation?: string }[];
  constraints?: string[];
  starterCode: string;
  testCases: { input: string; expectedOutput: string; isHidden?: boolean }[];
  hints: string[];
  solution: string;
  timeComplexity: string;
  spaceComplexity: string;
  tags: string[];
}

// --- Learner State Types ---

export interface MasteryEntry {
  topicId: string;
  mastery: number; // 0.0 - 1.0
  attempts: number;
  successes: number;
  lastAttempt: number; // timestamp
  nextReview: number; // timestamp (SM-2 scheduling)
  interval: number; // days
  easeFactor: number; // SM-2 ease factor
  misconceptions: string[];
}

export interface ErrorRecord {
  problemId: string;
  topicId: string;
  errorType: 'runtime' | 'logic' | 'timeout' | 'syntax' | 'complexity';
  description: string;
  timestamp: number;
  resolved: boolean;
}

export interface LearningPlan {
  goal: string;
  targetGroup: 'competition' | 'student' | 'interview' | 'self_learner';
  duration: string;
  milestones: { title: string; topics: string[]; estimatedTime: string; completed: boolean }[];
  createdAt: number;
  currentMilestone: number;
}

export interface SessionCheckpoint {
  timestamp: number;
  summary: string;
  topicsCovered: string[];
  intent: UserIntent;
}

export interface LearnerState {
  userId: string;
  mastery: Record<string, MasteryEntry>;
  errorRecords: ErrorRecord[];
  learningPlan: LearningPlan | null;
  behaviorProfile: {
    avgSolveTime: number;
    hintUsageRate: number;
    preferredTopics: string[];
    strugglingTopics: string[];
    activeHours: number[];
    totalProblemsAttempted: number;
    totalProblemsSolved: number;
    streak: number;
    lastActiveDate: string;
  };
  checkpoints: SessionCheckpoint[];
  preferences: {
    language: string;
    hintLevel: 1 | 2 | 3 | 4 | 5;
    targetGroup: 'competition' | 'student' | 'interview' | 'self_learner';
  };
}

// --- Skill Types ---

export interface Skill {
  name: string;
  description: string;
  content: string;
  references?: string[];
  triggerKeywords?: string[];
  triggerCommands?: string[];
}

// --- Execution Types ---

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  stderr?: string;
  executionTime?: number;
  testResults?: {
    passed: number;
    total: number;
    failures: { input: string; expected: string; actual: string; error?: string }[];
  };
}

export interface CodeAssessment {
  executionResult: CodeExecutionResult;
  complexity: { time: string; space: string };
  readability: number; // 1-5
  edgeCaseCoverage: number; // 1-5
  suggestions: string[];
  score: number; // 0-100
}

// --- API Types ---

export interface ChatRequest {
  messages: AgentMessage[];
  learnerState: LearnerState;
  apiKey?: string;
  model?: string;
  provider?: 'openai' | 'anthropic' | 'volcengine' | 'custom';
  mode?: 'chat' | 'practice' | 'plan' | 'review';
  context?: {
    currentProblem?: AlgorithmProblem;
    codeSubmission?: string;
    executionResult?: CodeExecutionResult;
  };
}

export interface ChatResponse {
  content: string;
  agentTrail: { agent: AgentRole; action: string; timestamp: number }[];
  learnerStateUpdates?: Partial<LearnerState>;
  intent?: UserIntent;
  problem?: AlgorithmProblem;
  assessment?: CodeAssessment;
}

// --- UI Types ---

export type ViewMode = 'chat' | 'practice' | 'dashboard' | 'manage';

export interface UITab {
  id: ViewMode;
  label: string;
  icon: string;
}
