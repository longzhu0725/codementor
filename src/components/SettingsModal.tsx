'use client';

import { useEffect, useState } from 'react';
import { LearnerState } from '@/types';

export type LLMProvider = 'openai' | 'anthropic' | 'volcengine';
export type TargetGroup = 'competition' | 'student' | 'interview' | 'self_learner';
export type HintLevel = 1 | 2 | 3 | 4 | 5;

export interface AppSettings {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  targetGroup: TargetGroup;
  hintLevel: HintLevel;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'volcengine',
  apiKey: '',
  model: '',
  targetGroup: 'self_learner',
  hintLevel: 2,
};

const PROVIDER_OPTIONS: { value: LLMProvider; label: string; hint: string }[] = [
  { value: 'volcengine', label: '火山引擎', hint: '豆包大模型 (Doubao)' },
  { value: 'openai', label: 'OpenAI', hint: 'GPT-4o / GPT-4.1 系列' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude Sonnet / Opus 系列' },
];

const TARGET_GROUP_OPTIONS: { value: TargetGroup; label: string; desc: string }[] = [
  { value: 'self_learner', label: '自学者', desc: '系统化自学算法' },
  { value: 'student', label: '在校学生', desc: '配合课程进度' },
  { value: 'interview', label: '面试备战', desc: '高频题与思维训练' },
  { value: 'competition', label: '竞赛选手', desc: '进阶与优化技巧' },
];

const HINT_LEVEL_LABELS: Record<HintLevel, string> = {
  1: '1 · 极简',
  2: '2 · 适中',
  3: '3 · 标准',
  4: '4 · 详细',
  5: '5 · 手把手',
};

function getApiKeyPlaceholder(provider: LLMProvider): string {
  switch (provider) {
    case 'volcengine':
      return '请输入火山引擎方舟 API Key';
    case 'openai':
      return 'sk-...';
    case 'anthropic':
      return 'sk-ant-...';
  }
}

function getModelPlaceholder(provider: LLMProvider): string {
  switch (provider) {
    case 'volcengine':
      return '留空使用默认模型 doubao-seed-2-1-pro-260628';
    case 'openai':
      return '留空使用默认模型 gpt-4o-mini';
    case 'anthropic':
      return '留空使用默认模型 claude-sonnet';
  }
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);

  // Re-sync the draft whenever the modal opens or settings change.
  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
    }
  }, [isOpen, settings]);

  // Close on Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft({ ...DEFAULT_SETTINGS, provider: settings.provider });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl animate-slide-up">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-6 py-4 backdrop-blur">
          <h2 id="settings-title" className="text-lg font-semibold text-foreground">
            设置
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
            aria-label="关闭"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-7 px-6 py-6">
          {/* Provider */}
          <section>
            <label className="mb-2 block text-sm font-medium text-foreground">
              AI 服务商
            </label>
            <div className="grid grid-cols-1 gap-2.5">
              {PROVIDER_OPTIONS.map((opt) => {
                const active = draft.provider === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('provider', opt.value)}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-accent bg-accent/10 ring-1 ring-accent'
                        : 'border-border bg-background hover:border-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">
                        {opt.label}
                      </div>
                      {active && (
                        <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                          已选择
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* API Key */}
          <section>
            <label
              htmlFor="api-key"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              API Key
            </label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              placeholder={getApiKeyPlaceholder(draft.provider)}
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1.5 text-xs text-muted">
              {draft.provider === 'volcengine'
                ? '火山引擎方舟 API Key 可在方舟控制台获取。密钥仅保存在本地浏览器。'
                : '密钥仅保存在本地浏览器，不会上传至第三方。后端将使用它直接调用对应服务商。'}
            </p>
          </section>

          {/* Model (optional) */}
          <section>
            <label
              htmlFor="model"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              模型/端点 <span className="text-muted">（可选）</span>
            </label>
            <input
              id="model"
              type="text"
              spellCheck={false}
              value={draft.model ?? ''}
              onChange={(e) => update('model', e.target.value)}
              placeholder={getModelPlaceholder(draft.provider)}
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1.5 text-xs text-muted">
              {draft.provider === 'volcengine' ? (
                <>
                  支持火山方舟 Model ID（如 doubao-seed-2-1-pro-260628）或自定义 Endpoint ID（如 ep-xxx）。
                  <a
                    href="https://console.volcengine.com/ark/region:ark+cn-beijing/model"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    查看模型列表
                  </a>
                </>
              ) : (
                '留空将使用默认模型。'
              )}
            </p>
          </section>

          {/* Target group */}
          <section>
            <label className="mb-2 block text-sm font-medium text-foreground">
              学习目标人群
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {TARGET_GROUP_OPTIONS.map((opt) => {
                const active = draft.targetGroup === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('targetGroup', opt.value)}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-accent bg-accent/10 ring-1 ring-accent'
                        : 'border-border bg-background hover:border-muted/50'
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">
                      {opt.label}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Hint level */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="hint-level"
                className="block text-sm font-medium text-foreground"
              >
                提示详细程度
              </label>
              <span className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                {HINT_LEVEL_LABELS[draft.hintLevel]}
              </span>
            </div>
            <input
              id="hint-level"
              type="range"
              min={1}
              max={5}
              step={1}
              value={draft.hintLevel}
              onChange={(e) =>
                update('hintLevel', Number(e.target.value) as HintLevel)
              }
              className="w-full accent-accent"
            />
            <div className="mt-1.5 flex justify-between text-xs text-muted">
              <span>仅方向</span>
              <span>适中</span>
              <span>逐步引导</span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-card/95 px-6 py-4 backdrop-blur">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground"
          >
            重置
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/20 transition-colors hover:bg-accent-hover"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** Map app settings onto learner-state preferences. */
export function settingsToPreferences(
  settings: AppSettings
): Pick<LearnerState['preferences'], 'hintLevel' | 'targetGroup'> {
  return {
    hintLevel: settings.hintLevel,
    targetGroup: settings.targetGroup,
  };
}
