'use client';

import { useCallback, useRef, useState } from 'react';
import {
  AgentMessage,
  AgentRole,
  AlgorithmProblem,
  ChatRequest,
  ChatResponse,
  CodeExecutionResult,
  LearnerState,
  AgentActivity,
} from '@/types';
import type { AppSettings } from '@/components/SettingsModal';
import { updateStreak } from '@/lib/memory/learner-state';
import {
  streamBrowserLLM,
  streamBrowserLLMMultiStep,
  decomposeWithLLM,
} from '@/lib/llm/browser-client';
import type { AgentStep } from '@/types';
import { quickValidate } from '@/lib/problem-validator';

export type { AgentActivity };

export interface SendMessageContext {
  code?: string;
  executionResult?: CodeExecutionResult;
  problem?: AlgorithmProblem;
}

export interface UseChatOptions {
  learnerState: LearnerState;
  onLearnerStateUpdate?: (updater: (prev: LearnerState) => LearnerState) => void;
  settings?: AppSettings | null;
  /** The problem currently shown in the practice workbench, if any. */
  currentProblem?: AlgorithmProblem | null;
}

export interface UseChatReturn {
  messages: AgentMessage[];
  sendMessage: (text: string, context?: SendMessageContext) => Promise<void>;
  appendMessage: (message: AgentMessage) => void;
  loadMessages: (msgs: AgentMessage[]) => void;
  isLoading: boolean;
  /** Activities for the *current* in-flight turn (live-updating). */
  liveActivities: AgentActivity[];
  /** Content being streamed in (empty string when not streaming) */
  streamingContent: string;
  /** Which agent is currently responding (for avatar/name during streaming) */
  streamingAgent: AgentRole | null;
  currentProblem: AlgorithmProblem | null;
  clearChat: () => void;
}

const WELCOME_MESSAGE: AgentMessage = {
  role: 'assistant',
  content:
    '你好！我是 **CodeMentor**，你的多智能体 AI 算法导师。\n\n我可以帮你：\n- 讲解算法与数据结构知识点\n- 生成个性化练习题并提供 **苏格拉底式** 提示\n- 评估你的代码并指出改进方向\n- 制定个性化学习路径\n\n试试输入 `/practice` 开始练习，或 `/plan` 生成学习计划。',
  agentRole: 'orchestrator',
  timestamp: 0,
};

// Keywords that indicate the user wants to practice / get a problem.
const PRACTICE_KEYWORDS = [
  '出题', '出一道', '来一道', '练习题', '给我题', '刷题',
  '做题', '算法题', '考考我', '挑战', '练一练',
  'practice', 'give me a problem', 'exercise',
];

// Keywords that indicate the user wants a study plan.
const PLAN_KEYWORDS = [
  '学习计划', '学习路径', '学习路线', '规划', '怎么学',
  '学习建议', '复习计划', '进阶路线',
  'study plan', 'learning path', 'roadmap',
];

// Keywords that indicate the user wants a hint.
const HINT_KEYWORDS = [
  '提示', '给个提示', '卡住了', '不会做', '思路',
  '怎么想', '点拨', '启发',
];

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function inferMode(text: string, context?: SendMessageContext): 'chat' | 'practice' | 'plan' | 'review' {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('/practice')) return 'practice';
  if (trimmed.startsWith('/plan')) return 'plan';
  if (trimmed.startsWith('/hint')) return 'review';
  if (context?.code) return 'review';
  if (matchesAny(trimmed, PRACTICE_KEYWORDS)) return 'practice';
  if (matchesAny(trimmed, PLAN_KEYWORDS)) return 'plan';
  if (matchesAny(trimmed, HINT_KEYWORDS)) return 'review';
  return 'chat';
}

function inferIntent(text: string): 'chat' | 'practice' | 'plan' | 'review' {
  return inferMode(text);
}

function modeToAgent(mode: string): AgentRole {
  switch (mode) {
    case 'practice': return 'problem_setter';
    case 'plan': return 'path_planner';
    case 'review': return 'examiner';
    default: return 'lecturer';
  }
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { learnerState, onLearnerStateUpdate, settings } = options;

  const [messages, setMessages] = useState<AgentMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [liveActivities, setLiveActivities] = useState<AgentActivity[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingAgent, setStreamingAgent] = useState<AgentRole | null>(null);
  const [currentProblem, setCurrentProblem] = useState<AlgorithmProblem | null>(
    options.currentProblem ?? null
  );

  // Keep the latest state accessible inside async callbacks.
  const learnerStateRef = useRef(learnerState);
  learnerStateRef.current = learnerState;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const currentProblemRef = useRef(currentProblem);
  currentProblemRef.current = currentProblem;

  const sendMessage = useCallback(
    async (text: string, context?: SendMessageContext) => {
      const content = text.trim();
      if (!content || isLoading) return;

      // Update streak on every user message (daily check-in)
      if (onLearnerStateUpdate) {
        onLearnerStateUpdate((prev) => updateStreak(prev));
      }

      const mode = inferMode(content, context);
      const intent = inferIntent(content);

      const userMessage: AgentMessage = {
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      const nextMessages = [...messagesRef.current, userMessage];
      setMessages(nextMessages);
      setIsLoading(true);
      setLiveActivities([]);
      setStreamingContent('');
      // Start as orchestrator — the correct sub-agent will be set after
      // decomposeWithLLM completes (for browser calls) or after mode resolution.
      setStreamingAgent('orchestrator');

      const requestBody: ChatRequest = {
        messages: nextMessages,
        learnerState: learnerStateRef.current,
        provider: settings?.provider,
        apiKey: settings?.apiKey,
        mode,
        context: {
          currentProblem: context?.problem ?? currentProblemRef.current ?? undefined,
          codeSubmission: context?.code,
          executionResult: context?.executionResult,
        },
      };

      // Buffer for activities collected during this turn
      const turnActivities: AgentActivity[] = [];

      try {
        const hasApiKey = !!settings?.apiKey;
        const useBrowserCall =
          hasApiKey &&
          (settings!.provider === 'volcengine' ||
            settings!.provider === 'openai' ||
            settings!.provider === 'custom');

        if (useBrowserCall) {
          // ============================================================
          // Orchestrator diplomacy: let the orchestrator LLM decompose the
          // request into an execution plan (single-step or multi-step).
          // ============================================================
          const llmSettings = {
            provider: settings!.provider,
            apiKey: settings!.apiKey,
            model: settings!.model,
            baseURL: settings!.baseURL,
          };

          const chatContext = {
            currentProblem: context?.problem ?? currentProblemRef.current ?? undefined,
            codeSubmission: context?.code,
            executionResult: context?.executionResult
              ? {
                  passed: context.executionResult.testResults?.passed ?? 0,
                  failed:
                    (context.executionResult.testResults?.total ?? 0) -
                    (context.executionResult.testResults?.passed ?? 0),
                  details:
                    context.executionResult.error ||
                    context.executionResult.output ||
                    undefined,
                }
              : undefined,
          };

          // Shared callbacks for both single-step and multi-step
          // For multi-step: we track per-step content and create separate messages
          // when each step completes via onStepComplete.
          let stepStreamedText = '';
          const llmCallbacks = {
            onActivity: (act: AgentActivity) => {
              const idx = turnActivities.findIndex((a) => a.id === act.id);
              if (idx >= 0) turnActivities[idx] = act;
              else turnActivities.push(act);
              setLiveActivities([...turnActivities]);
              if (act.type === 'agent_start' && act.agent !== 'orchestrator') {
                setStreamingAgent(act.agent);
              }
            },
            onToken: (delta: string) => {
              stepStreamedText += delta;
              setStreamingContent(stepStreamedText);
            },
            onProblem: (p: AlgorithmProblem) => {
              if (quickValidate(p)) {
                setCurrentProblem(p);
              }
            },
            onStepComplete: (step: {
              agent: AgentRole;
              content: string;
              activities: AgentActivity[];
              problem?: AlgorithmProblem;
            }) => {
              // Create a separate assistant message for this agent's output
              const stepContent = step.content || stepStreamedText || '';
              if (step.problem && quickValidate(step.problem)) {
                setCurrentProblem(step.problem);
              }
              const stepMessage: AgentMessage = {
                role: 'assistant',
                content: stepContent,
                agentRole: step.agent,
                timestamp: Date.now(),
                activities: step.activities,
              };
              setMessages((prev) => [...prev, stepMessage]);
              // Remove this step's activities from turnActivities
              // (they're now attached to the step message), keep orchestrator
              // transition activities for the live thinking chain
              const stepIds = new Set(step.activities.map((a) => a.id));
              for (let i = turnActivities.length - 1; i >= 0; i--) {
                if (stepIds.has(turnActivities[i].id)) {
                  turnActivities.splice(i, 1);
                }
              }
              setLiveActivities([...turnActivities]);
              // Reset streaming text for next step
              stepStreamedText = '';
              setStreamingContent('');
            },
          };

          // Show orchestrator analyzing intent while decomposeWithLLM runs
          const orchAnalyzeAct: AgentActivity = {
            id: `orch-analyze-${Date.now()}`,
            agent: 'orchestrator',
            type: 'agent_start',
            label: '总控分析用户意图…',
            status: 'running',
            timestamp: Date.now(),
            paradigm: 'ReAct',
          };
          turnActivities.push(orchAnalyzeAct);
          setLiveActivities([...turnActivities]);

          // Ask the orchestrator to decompose the request.
          // This may return a single-step plan, a multi-step plan, or a
          // clarification request. On failure we fall back to rule-based mode.
          const orchestratorPlan = await decomposeWithLLM(
            nextMessages,
            llmSettings,
            learnerStateRef.current,
            chatContext
          );

          let multiSteps: AgentStep[] | null = null;

          // Mark orchestrator analysis as complete
          orchAnalyzeAct.status = 'success';
          orchAnalyzeAct.label = orchestratorPlan
            ? `总控完成意图分析：${orchestratorPlan.plan.length} 步计划`
            : '总控完成意图分析（回退到规则路由）';
          orchAnalyzeAct.durationMs = 0;
          setLiveActivities([...turnActivities]);

          if (orchestratorPlan?.requiresClarification) {
            // Orchestrator asks for clarification; no sub-agents run.
            const clarificationMessage: AgentMessage = {
              role: 'assistant',
              content:
                orchestratorPlan.clarificationQuestion ||
                '你的请求我不是很确定，能再说详细一点吗？',
              agentRole: 'orchestrator',
              timestamp: Date.now(),
              activities: [],
            };
            setMessages((prev) => [...prev, clarificationMessage]);
            setIsLoading(false);
            setStreamingAgent(null);
            setStreamingContent('');
            return;
          }

          if (orchestratorPlan && orchestratorPlan.plan.length > 1) {
            multiSteps = orchestratorPlan.plan;
            setStreamingAgent(multiSteps[0].agent);
          }

          // Route to multi-step orchestration or single-agent call
          const isMultiStep = multiSteps && multiSteps.length > 1;
          const data = isMultiStep
            ? await streamBrowserLLMMultiStep(
                nextMessages,
                llmSettings,
                multiSteps!,
                learnerStateRef.current,
                llmCallbacks,
                chatContext
              )
            : await streamBrowserLLM(
                nextMessages,
                llmSettings,
                mode,
                learnerStateRef.current,
                llmCallbacks,
                chatContext
              );

          // For multi-step: each step already created its own message via onStepComplete.
          // Only create a final message for single-step calls.
          if (!isMultiStep) {
            const finalContent = data.content || stepStreamedText || '（导师暂未返回内容）';
            const finalActivities = turnActivities.length > 0
              ? turnActivities
              : (data.activities || []);

            const assistantMessage: AgentMessage = {
              role: 'assistant',
              content: finalContent,
              agentRole: modeToAgent(mode),
              timestamp: Date.now(),
              activities: finalActivities,
            };
            setMessages((prev) => [...prev, assistantMessage]);
          }

          setStreamingContent('');
          setStreamingAgent(null);
          setLiveActivities([]);

          if (data.problem) {
            if (quickValidate(data.problem)) {
              setCurrentProblem(data.problem);
            } else {
              const { getRandomProblem } = await import('@/lib/knowledge/problems');
              const localProblem = getRandomProblem();
              setCurrentProblem(localProblem);
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') {
                  copy[copy.length - 1] = {
                    ...last,
                    content:
                      last.content +
                      '\n\n> ⚠️ AI 生成的题目未通过质量验证，已从本地题库为你选取一道替代题目。',
                  };
                }
                return copy;
              });
            }
          }

          if (data.learnerStateUpdates && onLearnerStateUpdate) {
            onLearnerStateUpdate((prev) => ({ ...prev, ...data.learnerStateUpdates! }));
          }

          if (onLearnerStateUpdate) {
            onLearnerStateUpdate((prev) => ({
              ...prev,
              checkpoints: [
                ...prev.checkpoints,
                {
                  timestamp: Date.now(),
                  summary: content.slice(0, 80),
                  topicsCovered: data.problem ? [data.problem.topicId] : [],
                  intent,
                },
              ].slice(-5),
            }));
          }
        } else {
          // Non-browser path: server API — set agent based on mode
          setStreamingAgent(modeToAgent(mode));
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`服务返回 ${res.status}${detail ? `：${detail}` : ''}`);
          }

          const data = (await res.json()) as ChatResponse;

          const assistantMessage: AgentMessage = {
            role: 'assistant',
            content: data.content || '（导师暂未返回内容）',
            agentRole: data.agentTrail?.[data.agentTrail.length - 1]?.agent,
            timestamp: Date.now(),
            activities: data.activities,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setLiveActivities([]);

          if (data.problem) {
            if (quickValidate(data.problem)) {
              setCurrentProblem(data.problem);
            } else {
              const { getRandomProblem } = await import('@/lib/knowledge/problems');
              const localProblem = getRandomProblem();
              setCurrentProblem(localProblem);
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') {
                  copy[copy.length - 1] = {
                    ...last,
                    content:
                      last.content +
                      '\n\n> ⚠️ AI 生成的题目未通过质量验证，已从本地题库为你选取一道替代题目。',
                  };
                }
                return copy;
              });
            }
          }

          if (data.learnerStateUpdates && onLearnerStateUpdate) {
            onLearnerStateUpdate((prev) => ({ ...prev, ...data.learnerStateUpdates! }));
          }

          if (onLearnerStateUpdate) {
            onLearnerStateUpdate((prev) => ({
              ...prev,
              checkpoints: [
                ...prev.checkpoints,
                {
                  timestamp: Date.now(),
                  summary: content.slice(0, 80),
                  topicsCovered: data.problem ? [data.problem.topicId] : [],
                  intent,
                },
              ].slice(-5),
            }));
          }

          setStreamingContent('');
          setStreamingAgent(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误';
        const errorMessage: AgentMessage = {
          role: 'assistant',
          content: `抱歉，连接导师服务时出现问题：\n\n\`${message}\`\n\n请检查网络连接或前往「设置」确认 API Key 配置后重试。`,
          agentRole: 'orchestrator',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        setStreamingContent('');
        setStreamingAgent(null);
        setLiveActivities([]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, settings, onLearnerStateUpdate]
  );

  const clearChat = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    setLiveActivities([]);
    setStreamingContent('');
    setStreamingAgent(null);
    setIsLoading(false);
  }, []);

  const appendMessage = useCallback((message: AgentMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const loadMessages = useCallback((msgs: AgentMessage[]) => {
    setMessages(msgs.length > 0 ? msgs : [WELCOME_MESSAGE]);
    setLiveActivities([]);
    setStreamingContent('');
    setStreamingAgent(null);
    setIsLoading(false);
  }, []);

  return {
    messages,
    sendMessage,
    appendMessage,
    loadMessages,
    isLoading,
    liveActivities,
    streamingContent,
    streamingAgent,
    currentProblem,
    clearChat,
  };
}
