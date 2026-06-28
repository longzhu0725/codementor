'use client';

import { LearnerState, ErrorRecord } from '@/types';
import { KNOWLEDGE_TOPICS } from '@/lib/knowledge/topics';

export interface DashboardProps {
  learnerState: LearnerState;
}

const ERROR_TYPE_LABELS: Record<ErrorRecord['errorType'], string> = {
  runtime: '运行时错误',
  logic: '逻辑错误',
  timeout: '超时',
  syntax: '语法错误',
  complexity: '复杂度问题',
};

const ERROR_TYPE_COLORS: Record<ErrorRecord['errorType'], string> = {
  runtime: 'text-warning bg-warning/10 border-warning/30',
  logic: 'text-danger bg-danger/10 border-danger/30',
  timeout: 'text-warning bg-warning/10 border-warning/30',
  syntax: 'text-accent bg-accent/10 border-accent/30',
  complexity: 'text-success bg-success/10 border-success/30',
};

function StatCard({
  label,
  value,
  sublabel,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-muted/40">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight text-foreground">
        {value}
      </div>
      {sublabel && <div className="mt-1 text-xs text-muted">{sublabel}</div>}
    </div>
  );
}

function MasteryBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="progress-track h-2 w-full">
      <div
        className={`progress-fill ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function difficultyStars(level: number): string {
  return '★'.repeat(level) + '☆'.repeat(5 - level);
}

export function Dashboard({ learnerState }: DashboardProps) {
  const { behaviorProfile, mastery, errorRecords } = learnerState;

  const masteryEntries = Object.values(mastery);
  const avgMastery =
    masteryEntries.length > 0
      ? masteryEntries.reduce((sum, m) => sum + m.mastery, 0) /
        masteryEntries.length
      : 0;

  const solveRate =
    behaviorProfile.totalProblemsAttempted > 0
      ? Math.round(
          (behaviorProfile.totalProblemsSolved /
            behaviorProfile.totalProblemsAttempted) *
            100
        )
      : 0;

  const recentErrors = [...errorRecords].reverse().slice(0, 8);

  const orderedTopics = [...KNOWLEDGE_TOPICS].sort(
    (a, b) => a.learningOrder - b.learningOrder
  );

  return (
    <div className="mx-auto h-full max-w-5xl space-y-6 overflow-y-auto p-6">
      <header className="animate-fade-in">
        <h1 className="text-2xl font-bold text-foreground">学习仪表盘</h1>
        <p className="mt-1 text-sm text-muted">
          追踪你的掌握度、学习路径与错误历史
        </p>
      </header>

      {/* Statistics cards */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="已尝试题目"
          value={behaviorProfile.totalProblemsAttempted}
          sublabel={`已解决 ${behaviorProfile.totalProblemsSolved} 题`}
          accent="bg-accent/15 text-accent"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          }
        />
        <StatCard
          label="正确率"
          value={`${solveRate}%`}
          sublabel={`${behaviorProfile.totalProblemsSolved}/${behaviorProfile.totalProblemsAttempted}`}
          accent="bg-success/15 text-success"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
        />
        <StatCard
          label="连续学习"
          value={`${behaviorProfile.streak} 天`}
          sublabel="保持势头"
          accent="bg-warning/15 text-warning"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
          }
        />
        <StatCard
          label="平均掌握度"
          value={`${Math.round(avgMastery * 100)}%`}
          sublabel={`覆盖 ${masteryEntries.length} 个知识点`}
          accent="bg-accent/15 text-accent"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
          }
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Mastery overview */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            知识点掌握度
          </h2>
          {masteryEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="mb-2 text-3xl">📊</div>
              <p className="text-sm text-muted">
                还没有练习记录
              </p>
              <p className="mt-1 text-xs text-muted/70">
                开始练习后，这里会展示各知识点的掌握情况
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {masteryEntries
                .sort((a, b) => a.mastery - b.mastery)
                .map((entry) => {
                  const topic = KNOWLEDGE_TOPICS.find(
                    (t) => t.id === entry.topicId
                  );
                  return (
                    <div key={entry.topicId}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="text-foreground">
                          {topic?.name ?? entry.topicId}
                        </span>
                        <span className="font-mono text-xs text-muted">
                          {Math.round(entry.mastery * 100)}%
                        </span>
                      </div>
                      <MasteryBar value={entry.mastery} />
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* Error history */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            错误历史
          </h2>
          {recentErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="mb-2 text-3xl">✨</div>
              <p className="text-sm text-muted">暂无错误记录</p>
              <p className="mt-1 text-xs text-muted/70">
                继续保持，遇到问题也会帮你记录下来
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {recentErrors.map((err, idx) => {
                const topic = KNOWLEDGE_TOPICS.find(
                  (t) => t.id === err.topicId
                );
                return (
                  <li
                    key={`${err.timestamp}-${idx}`}
                    className="rounded-xl border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
                          ERROR_TYPE_COLORS[err.errorType]
                        }`}
                      >
                        {ERROR_TYPE_LABELS[err.errorType]}
                      </span>
                      <span className="text-[11px] text-muted">
                        {topic?.name ?? err.topicId}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted">
                      {err.description}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Learning path */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-1 text-base font-semibold text-foreground">
          学习路径
        </h2>
        <p className="mb-4 text-xs text-muted">
          按依赖顺序排列，绿色勾代表已掌握（掌握度 ≥ 70%）
        </p>
        <ol className="space-y-2">
          {orderedTopics.map((topic, idx) => {
            const entry = mastery[topic.id];
            const value = entry?.mastery ?? 0;
            const mastered = value >= 0.7;
            const attempted = Boolean(entry && entry.attempts > 0);
            return (
              <li
                key={topic.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    mastered
                      ? 'bg-success/20 text-success'
                      : attempted
                        ? 'bg-accent/20 text-accent'
                        : 'bg-card-hover text-muted'
                  }`}
                >
                  {mastered ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {topic.name}
                    </span>
                    <span className="shrink-0 text-[10px] text-warning">
                      {difficultyStars(topic.difficulty)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1">
                      <MasteryBar value={value} />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted">
                      {attempted ? `${Math.round(value * 100)}%` : '—'}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
