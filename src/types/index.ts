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

// --- Agent Activity / Transparency Types ---

export type AgentActivityType =
  | 'agent_start'      // Agent 开始工作
  | 'agent_end'        // Agent 完成工作
  | 'skill_load'       // 加载教学技能/方法论
  | 'knowledge_read'   // 读取知识库内容
  | 'tool_call'        // 调用工具
  | 'tool_result'      // 工具返回结果
  | 'thinking'         // 思考/推理过程
  | 'validate'         // 验证/校验步骤
  | 'stream_chunk'     // 流式输出片段（内部使用，不展示给用户）
  | 'error';           // 错误/降级

export interface AgentActivity {
  /** Unique id for React keys */
  id: string;
  /** Which agent produced this activity */
  agent: AgentRole;
  /** Type of activity */
  type: AgentActivityType;
  /** Short human-readable label, e.g. "加载苏格拉底教学法" */
  label: string;
  /** Optional detailed info (tool args, result summary, etc.) */
  detail?: string;
  /** Whether this step succeeded (for tool/validate steps) */
  status?: 'running' | 'success' | 'warning' | 'error';
  /** Duration in ms (for completed steps) */
  durationMs?: number;
  /** When this activity started */
  timestamp: number;
}

export interface ChatResponse {
  content: string;
  /** @deprecated Use activities instead; kept for backward compatibility */
  agentTrail: { agent: AgentRole; action: string; timestamp: number }[];
  /** Detailed activity log for transparency */
  activities?: AgentActivity[];
  learnerStateUpdates?: Partial<LearnerState>;
  intent?: UserIntent;
  problem?: AlgorithmProblem;
  assessment?: CodeAssessment;
}

/** Callback shape for streaming updates during LLM generation. */
export interface StreamCallbacks {
  /** Called when a new activity step starts (skill load, tool call, etc.) */
  onActivity?: (activity: AgentActivity) => void;
  /** Called when new content tokens arrive (for streaming text display) */
  onToken?: (delta: string) => void;
  /** Called when a problem has been parsed from the stream (practice mode) */
  onProblem?: (problem: AlgorithmProblem) => void;
}

// --- UI Types ---

export type ViewMode = 'chat' | 'practice' | 'dashboard' | 'manage';

export interface UITab {
  id: ViewMode;
  label: string;
  icon: string;
}

// --- Problem History Types ---

export type ProblemStatus = 'solved' | 'attempted' | 'unsolved';

export interface SavedProblem {
  id: string;
  problem: AlgorithmProblem;
  userCode: string;
  lastResult: CodeExecutionResult | null;
  status: ProblemStatus;
  savedAt: number;
  sessionTitle?: string;
  attempts: number;
}
