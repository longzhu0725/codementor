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
} from '@/types';
import type { AppSettings } from '@/components/SettingsModal';
import { callVolcengineBrowser } from '@/lib/llm/browser-client';

export interface AgentTrailItem {
  agent: AgentRole;
  action: string;
  timestamp: number;
}

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
  isLoading: boolean;
  agentTrail: AgentTrailItem[];
  currentProblem: AlgorithmProblem | null;
  clearChat: () => void;
}

const WELCOME_MESSAGE: AgentMessage = {
  role: 'assistant',
  content:
    '你好！我是 **CodeMentor**，你的多智能体 AI 算法导师。\n\n我可以帮你：\n- 讲解算法与数据结构知识点\n- 生成个性化练习题并提供 **苏格拉底式** 提示\n- 评估你的代码并指出改进方向\n- 制定个性化学习路径\n\n试试输入 `/practice` 开始练习，或 `/plan` 生成学习计划。',
  agentRole: 'orchestrator',
  // Use a fixed timestamp to avoid React hydration mismatch between server and client.
  timestamp: 0,
};

function inferMode(text: string, context?: SendMessageContext): 'chat' | 'practice' | 'plan' | 'review' {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('/practice')) return 'practice';
  if (trimmed.startsWith('/plan')) return 'plan';
  if (context?.code) return 'review';
  return 'chat';
}

function inferIntent(text: string): 'chat' | 'practice' | 'plan' | 'review' {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('/practice')) return 'practice';
  if (trimmed.startsWith('/plan')) return 'plan';
  if (trimmed.startsWith('/hint')) return 'review';
  return 'chat';
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { learnerState, onLearnerStateUpdate, settings } = options;

  const [messages, setMessages] = useState<AgentMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [agentTrail, setAgentTrail] = useState<AgentTrailItem[]>([]);
  const [currentProblem, setCurrentProblem] = useState<AlgorithmProblem | null>(
    options.currentProblem ?? null
  );

  // Keep the latest learner state accessible inside async callbacks.
  const learnerStateRef = useRef(learnerState);
  learnerStateRef.current = learnerState;

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const sendMessage = useCallback(
    async (text: string, context?: SendMessageContext) => {
      const content = text.trim();
      if (!content || isLoading) return;

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
      setAgentTrail([]);

      const requestBody: ChatRequest = {
        messages: nextMessages,
        learnerState: learnerStateRef.current,
        provider: settings?.provider,
        apiKey: settings?.apiKey,
        mode,
        context: {
          currentProblem: context?.problem ?? currentProblem ?? undefined,
          codeSubmission: context?.code,
          executionResult: context?.executionResult,
        },
      };

      try {
        let data: ChatResponse;

        if (settings?.provider === 'volcengine' && settings?.apiKey) {
          // IGA Pages deploys static sites, so /api/chat is unavailable.
          // Call the Volcengine API directly from the browser.
          data = await callVolcengineBrowser(
            nextMessages,
            settings.apiKey,
            settings.model || '',
            mode,
            learnerStateRef.current,
            {
              currentProblem: context?.problem ?? currentProblem ?? undefined,
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
            }
          );
        } else {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(
              `服务返回 ${res.status}${detail ? `：${detail}` : ''}`
            );
          }

          data = (await res.json()) as ChatResponse;
        }

        const assistantMessage: AgentMessage = {
          role: 'assistant',
          content: data.content || '（导师暂未返回内容）',
          agentRole: data.agentTrail?.[data.agentTrail.length - 1]?.agent,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (data.agentTrail?.length) {
          setAgentTrail(data.agentTrail);
        }

        if (data.problem) {
          setCurrentProblem(data.problem);
        }

        if (data.assessment && context?.executionResult) {
          // Surface assessment outcome back into the chat context already.
        }

        // Integrate learner-state updates returned by the orchestrator.
        if (data.learnerStateUpdates && onLearnerStateUpdate) {
          onLearnerStateUpdate((prev) => ({
            ...prev,
            ...data.learnerStateUpdates!,
          }));
        }

        // Record a lightweight checkpoint for this exchange.
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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : '未知错误';
        const errorMessage: AgentMessage = {
          role: 'assistant',
          content: `抱歉，连接导师服务时出现问题：\n\n\`${message}\`\n\n请检查网络连接或前往「设置」确认 API Key 配置后重试。`,
          agentRole: 'orchestrator',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, settings, currentProblem, onLearnerStateUpdate]
  );

  const clearChat = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    setAgentTrail([]);
    setIsLoading(false);
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    agentTrail,
    currentProblem,
    clearChat,
  };
}
