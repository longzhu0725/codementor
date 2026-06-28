'use client';

import { useCallback, useEffect, useState } from 'react';
import { ViewMode, AlgorithmProblem, CodeExecutionResult } from '@/types';
import { useLearnerState } from '@/lib/hooks/useLearnerState';
import { useChat } from '@/lib/hooks/useChat';
import { Sidebar } from '@/components/Sidebar';
import { ChatPanel } from '@/components/ChatPanel';
import { PracticeWorkbench } from '@/components/PracticeWorkbench';
import { Dashboard } from '@/components/Dashboard';
import { SettingsModal, AppSettings } from '@/components/SettingsModal';
import { getRandomProblem } from '@/lib/knowledge/problems';

const SETTINGS_KEY = 'codementor:settings:v1';

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'volcengine',
  apiKey: '',
  model: '',
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

  const learnerStateHook = useLearnerState();
  const { state: learnerState, updateState, recordAttempt, recordError } = learnerStateHook;

  const chat = useChat({
    learnerState,
    onLearnerStateUpdate: updateState,
    settings,
    currentProblem: problem,
  });

  // Sync problem from chat to practice view
  useEffect(() => {
    if (chat.currentProblem) {
      setProblem(chat.currentProblem);
      setCode(chat.currentProblem.starterCode);
      setExecutionResult(null);
    }
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

  const handleSend = useCallback(
    (text: string) => {
      // If user wants to practice, switch to practice view after response
      const isPractice = text.trim().toLowerCase().startsWith('/practice');
      const isPlan = text.trim().toLowerCase().startsWith('/plan');

      chat.sendMessage(text).then(() => {
        if (isPractice) {
          // Give a moment for the problem to be set
          setTimeout(() => setView('practice'), 500);
        }
      });
    },
    [chat]
  );

  const handleRun = useCallback((result: CodeExecutionResult) => {
    setExecutionResult(result);
  }, []);

  const handleSubmit = useCallback(
    (result: CodeExecutionResult) => {
      setExecutionResult(result);

      // Record attempt in learner state
      if (problem) {
        const quality = result.testResults
          ? Math.round((result.testResults.passed / result.testResults.total) * 5)
          : result.success
            ? 5
            : 0;

        recordAttempt(problem.topicId, quality);

        // Record errors if any
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

      // Send code + results to chat for assessment
      chat.sendMessage('请评估我的代码', {
        code,
        executionResult: result,
        problem: problem || undefined,
      });

      // Switch to chat to see assessment
      setView('chat');
    },
    [code, problem, chat, recordAttempt, recordError]
  );

  const handleStartPractice = useCallback(() => {
    // If no problem, get a random one from the bank
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
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary">
      {/* Sidebar */}
      <Sidebar
        activeView={view}
        onViewChange={setView}
        onOpenSettings={() => setSettingsOpen(true)}
        streak={learnerState.behaviorProfile.streak}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {view === 'chat' && (
          <ChatPanel
            messages={chat.messages}
            onSend={handleSend}
            isLoading={chat.isLoading}
            agentTrail={chat.agentTrail}
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
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
