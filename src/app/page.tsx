'use client';

import { useCallback, useEffect, useState } from 'react';
import { ViewMode, AlgorithmProblem, CodeExecutionResult, AgentMessage } from '@/types';
import { useLearnerState } from '@/lib/hooks/useLearnerState';
import { useChat } from '@/lib/hooks/useChat';
import { Sidebar } from '@/components/Sidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { PracticeWorkbench } from '@/components/PracticeWorkbench';
import { Dashboard } from '@/components/Dashboard';
import { ResourceManager } from '@/components/ResourceManager';
import { SettingsModal, AppSettings } from '@/components/SettingsModal';
import { getRandomProblem } from '@/lib/knowledge/problems';
import { sessionManager, ChatSession } from '@/lib/sessions/manager';
import { toolRegistry, SLASH_COMMANDS } from '@/lib/tools/registry';
import { getProblemHistory } from '@/lib/problem-history/manager';

const SETTINGS_KEY = 'codementor:settings:v1';

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'volcengine',
  apiKey: '',
  model: '',
  baseURL: '',
  targetGroup: 'self_learner',
  hintLevel: 2,
};

export default function Home() {
  const [view, setView] = useState<ViewMode>('chat');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [code, setCode] = useState('');
  const [executionResult, setExecutionResult] = useState<CodeExecutionResult | null>(null);
  const [problem, setProblem] = useState<AlgorithmProblem | null>(null);

  // Multi-session state
  const [activeSessionId, setActiveSessionId] = useState(sessionManager.getActiveSessionId());
  const [sessions, setSessions] = useState<ChatSession[]>(() => sessionManager.getSessionsSorted());

  const learnerStateHook = useLearnerState();
  const { state: learnerState, updateState, recordAttempt, recordError } = learnerStateHook;

  const chat = useChat({
    learnerState,
    onLearnerStateUpdate: updateState,
    settings,
    currentProblem: problem,
  });

  // Refresh sessions list
  const refreshSessions = useCallback(() => {
    setSessions(sessionManager.getSessionsSorted());
    setActiveSessionId(sessionManager.getActiveSessionId());
  }, []);

  // Save current chat messages + problem to the active session before switching
  const saveCurrentSession = useCallback(() => {
    const currentMessages = chat.messages;
    if (currentMessages.length > 1) {
      sessionManager.updateSession(activeSessionId, {
        messages: currentMessages as AgentMessage[],
        learnerState,
        problem: problem ?? null,
        code: code || '',
      });
    }
  }, [chat.messages, activeSessionId, learnerState, problem, code]);

  const handleNewSession = useCallback(() => {
    // Save current session before creating a new one
    saveCurrentSession();
    const newSession = sessionManager.createSession();
    refreshSessions();
    chat.clearChat();
    setProblem(null);
    setCode('');
    setExecutionResult(null);
    setView('chat');
  }, [chat, refreshSessions, saveCurrentSession]);

  const handleSessionChange = useCallback((session: ChatSession) => {
    // Save current session before switching
    saveCurrentSession();
    // Switch to the selected session
    sessionManager.setActiveSession(session.id);
    refreshSessions();
    // Load the selected session's messages
    chat.loadMessages(session.messages as AgentMessage[]);
    // Restore problem and code from the session
    setProblem(session.problem ?? null);
    setCode(session.code || (session.problem?.starterCode ?? ''));
    setExecutionResult(null);
    setView('chat');
  }, [chat, refreshSessions, saveCurrentSession]);

  const handleDeleteSession = useCallback((id: string) => {
    sessionManager.deleteSession(id);
    refreshSessions();
    const active = sessionManager.getActiveSession();
    chat.loadMessages(active.messages as AgentMessage[]);
    setProblem(active.problem ?? null);
    setCode(active.code || (active.problem?.starterCode ?? ''));
    setExecutionResult(null);
  }, [chat, refreshSessions]);

  // Sync problem from chat to practice view (only when a NEW problem arrives)
  useEffect(() => {
    if (chat.currentProblem && chat.currentProblem.id !== problem?.id) {
      setProblem(chat.currentProblem);
      setCode(chat.currentProblem.starterCode);
      setExecutionResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.currentProblem]);

  // Hydrate settings from localStorage after mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {
      // ignore
    }
  }, []);

  // Persist settings
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  // Sync settings to learner state preferences
  useEffect(() => {
    updateState((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        targetGroup: settings.targetGroup,
        hintLevel: settings.hintLevel,
      },
    }));
  }, [settings.targetGroup, settings.hintLevel, updateState]);

  // Save session on chat state changes (including problem and code)
  useEffect(() => {
    if (chat.messages.length > 1) {
      sessionManager.updateSession(activeSessionId, {
        messages: chat.messages as AgentMessage[],
        learnerState,
        problem: problem ?? null,
        code: code || '',
      });
    }
  }, [chat.messages, learnerState, activeSessionId, problem, code]);

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const lowerText = trimmed.toLowerCase();

      // Handle /help
      if (lowerText === '/help') {
        const helpContent = `## 可用命令与工具\n\n**斜杠命令：**\n${Object.entries(SLASH_COMMANDS)
          .map(([cmd, info]) => `- \`${cmd}\` — ${info.description}`)
          .join('\n')}\n\n**内置工具：**\n${toolRegistry
          .list()
          .map((t) => `- **${t.label}** — ${t.description}`)
          .join('\n')}\n\n**示例：**\n- \`/search 动态规划入门\` — 网络搜索\n- \`/find 二分查找\` — 搜索知识库\n- \`/problems 动态规划\` — 查找相关题目\n- \`/analyze\`（在练习模式中分析代码）\n- \`/path 面试\` — 获取学习路径\n- \`/practice\` — 开始练习\n- \`/plan\` — 生成学习计划`;

        chat.appendMessage({
          role: 'user',
          content: '/help',
          timestamp: Date.now(),
        });
        chat.appendMessage({
          role: 'assistant',
          content: helpContent,
          agentRole: 'orchestrator',
          timestamp: Date.now(),
        });
        return;
      }

      // Handle tool slash commands
      for (const [cmd, info] of Object.entries(SLASH_COMMANDS)) {
        if (!info.tool) continue;
        if (lowerText === cmd || lowerText.startsWith(cmd + ' ')) {
          const arg = trimmed.slice(cmd.length).trim();
          chat.appendMessage({
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
          });

          try {
            let result;
            switch (info.tool) {
              case 'web_search':
                result = await toolRegistry.execute('web_search', { query: arg || '算法学习' });
                break;
              case 'search_knowledge':
                result = toolRegistry.execute('search_knowledge', { query: arg });
                break;
              case 'search_problems':
                result = toolRegistry.execute('search_problems', { topic: arg });
                break;
              case 'analyze_code':
                result = toolRegistry.execute('analyze_code', { code, topicId: problem?.topicId });
                break;
              case 'learning_path':
                result = toolRegistry.execute('learning_path', { goal: arg || '入门' });
                break;
            }
            if (result) {
              const res = await result;
              chat.appendMessage({
                role: 'assistant',
                content: res.success ? (res.display || '工具执行完成') : `工具执行失败：${res.error}`,
                agentRole: 'orchestrator',
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            chat.appendMessage({
              role: 'assistant',
              content: `工具执行出错：${err instanceof Error ? err.message : String(err)}`,
              agentRole: 'orchestrator',
              timestamp: Date.now(),
            });
          }
          return;
        }
      }

      const isPractice = lowerText.startsWith('/practice');
      await chat.sendMessage(text);
      if (isPractice) {
        setTimeout(() => setView('practice'), 500);
      }
    },
    [chat, code, problem]
  );

  const handleRun = useCallback((result: CodeExecutionResult) => {
    setExecutionResult(result);
  }, []);

  const handleSubmit = useCallback(
    (result: CodeExecutionResult) => {
      setExecutionResult(result);

      if (problem) {
        // Save to problem history for later review
        const history = getProblemHistory();
        history.saveProblem(problem, code, result);

        const quality = result.testResults
          ? Math.round((result.testResults.passed / result.testResults.total) * 5)
          : result.success
            ? 5
            : 0;

        recordAttempt(problem.topicId, quality);

        if (result.testResults && result.testResults.failures.length > 0) {
          recordError({
            problemId: problem.id,
            topicId: problem.topicId,
            errorType: 'logic',
            description: `${result.testResults.failures.length} 个测试用例失败`,
          });
        }

        if (result.error) {
          recordError({
            problemId: problem.id,
            topicId: problem.topicId,
            errorType: 'runtime',
            description: result.error,
          });
        }
      }

      chat.sendMessage('请评估我的代码', {
        code,
        executionResult: result,
        problem: problem || undefined,
      });

      setView('chat');
    },
    [code, problem, chat, recordAttempt, recordError]
  );

  const handleStartPractice = useCallback(() => {
    if (!problem) {
      const random = getRandomProblem();
      setProblem(random);
      setCode(random.starterCode);
      setExecutionResult(null);
    }
    setView('practice');
  }, [problem]);

  const handleSaveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    setSettingsOpen(false);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        activeView={view}
        onViewChange={setView}
        onOpenSettings={() => setSettingsOpen(true)}
        streak={learnerState.behaviorProfile.streak}
        activeSessionId={activeSessionId}
        onSessionChange={handleSessionChange}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        sessions={sessions}
      />

      <main className="flex-1 overflow-hidden">
        {view === 'chat' && (
          <ChatPanel
            messages={chat.messages}
            onSend={handleSend}
            isLoading={chat.isLoading}
            agentTrail={chat.agentTrail}
            activities={chat.activities}
            streamingContent={chat.streamingContent}
            streamingAgent={chat.streamingAgent}
          />
        )}

        {view === 'practice' && (
          <PracticeWorkbench
            problem={problem}
            onRun={handleRun}
            onSubmit={handleSubmit}
            code={code}
            setCode={setCode}
            executionResult={executionResult}
          />
        )}

        {view === 'dashboard' && <Dashboard learnerState={learnerState} />}

        {view === 'manage' && <ResourceManager />}
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
