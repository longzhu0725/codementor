'use client';

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AgentMessage, AgentRole, AgentActivity } from '@/types';
import { PixelAvatar, MascotRole } from './PixelAvatar';

export interface ChatPanelProps {
  messages: AgentMessage[];
  onSend: (text: string) => void;
  isLoading: boolean;
  /** @deprecated Use activities instead */
  agentTrail?: { agent: AgentRole; action: string; timestamp: number }[];
  /** Real-time activity log */
  activities?: AgentActivity[];
  /** Content being streamed in */
  streamingContent?: string;
  /** Which agent is currently streaming */
  streamingAgent?: AgentRole | null;
}

const AGENT_META: Record<AgentRole, { name: string; role: MascotRole; color: string }> = {
  orchestrator: { name: '总控', role: 'orchestrator', color: '#818cf8' },
  lecturer: { name: '讲师', role: 'lecturer', color: '#34d399' },
  problem_setter: { name: '出题官', role: 'problem_setter', color: '#fbbf24' },
  examiner: { name: '考官', role: 'examiner', color: '#f87171' },
  path_planner: { name: '规划师', role: 'path_planner', color: '#fb923c' },
};

const QUICK_ACTIONS: { cmd: string; label: string; desc: string }[] = [
  { cmd: '/practice', label: '/practice', desc: '开始练习' },
  { cmd: '/plan', label: '/plan', desc: '生成学习计划' },
  { cmd: '/hint', label: '/hint', desc: '给我一个提示' },
];

// ============================================================
// Activity type icons
// ============================================================

const ACTIVITY_ICONS: Record<AgentActivity['type'], { running: string; done: string }> = {
  agent_start: { running: '◐', done: '●' },
  agent_end: { running: '○', done: '●' },
  skill_load: { running: '◐', done: '◆' },
  knowledge_read: { running: '◐', done: '▤' },
  tool_call: { running: '◐', done: '▸' },
  tool_result: { running: '○', done: '✓' },
  thinking: { running: '◐', done: '…' },
  validate: { running: '◐', done: '✓' },
  stream_chunk: { running: '·', done: '·' },
  error: { running: '✕', done: '✕' },
};

function getActivityIcon(act: AgentActivity): string {
  const icons = ACTIVITY_ICONS[act.type] || ACTIVITY_ICONS.thinking;
  if (act.status === 'running') return icons.running;
  if (act.status === 'error') return '✕';
  if (act.status === 'warning') return '⚠';
  return icons.done;
}

function getActivityColor(act: AgentActivity): string {
  if (act.status === 'error') return '#f87171';
  if (act.status === 'warning') return '#fbbf24';
  if (act.status === 'running') return '#818cf8';
  return '#64748b';
}

// ============================================================
// Lightweight Markdown renderer
// ============================================================

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    if (m[2] !== undefined) {
      nodes.push(
        <strong key={`${keyBase}-s${i}`} className="md-strong">
          {m[2]}
        </strong>
      );
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={`${keyBase}-c${i}`} className="md-code">
          {m[3]}
        </code>
      );
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderTextBlocks(text: string, keyBase: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let listKey = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const header = line.match(/^(#{1,3})\s+(.*)$/);
    if (header) {
      const level = header[1].length;
      const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3';
      blocks.push(
        <div key={`${keyBase}-h${i}`} className={cls}>
          {renderInline(header[2], `${keyBase}-hi${i}`)}
        </div>
      );
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`${keyBase}-q${i}`} className="md-blockquote">
          {quoteLines.map((l, li) => (
            <p key={li} className="md-p">
              {renderInline(l, `${keyBase}-ql${i}-${li}`)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`${keyBase}-ul${listKey++}`} className="md-ul">
          {items.map((it, li) => (
            <li key={li} className="md-li">
              {renderInline(it, `${keyBase}-uli${li}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`${keyBase}-ol${listKey++}`} className="md-ol">
          {items.map((it, li) => (
            <li key={li} className="md-li">
              {renderInline(it, `${keyBase}-oli${li}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|>\s?|[-*]\s|\d+\.\s)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`${keyBase}-p${i}`} className="md-p">
        {renderInline(paraLines.join(' '), `${keyBase}-pi${i}`)}
      </p>
    );
  }

  return blocks;
}

function renderMarkdown(content: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  const parts = content.split(/```/);

  parts.forEach((part, idx) => {
    const key = `b${idx}`;
    if (idx % 2 === 1) {
      const trimmed = part.replace(/^\n/, '').replace(/\n$/, '');
      const langMatch = trimmed.match(/^([a-zA-Z0-9_+-]+)\n/);
      let lang = '';
      let code = trimmed;
      if (langMatch) {
        lang = langMatch[1];
        code = trimmed.slice(langMatch[0].length);
      }
      blocks.push(
        <pre key={key} className="md-code-block">
          {lang && (
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-muted">
              {lang}
            </span>
          )}
          <code>{code}</code>
        </pre>
      );
    } else if (part.trim()) {
      blocks.push(...renderTextBlocks(part, key));
    }
  });

  return <div className="md-content">{blocks}</div>;
}

// ============================================================
// Sub-components
// ============================================================

function ActivityLog({ activities }: { activities: AgentActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState<string | null>(null);

  if (activities.length === 0) return null;

  // Group activities by agent
  const agentGroups = new Map<AgentRole, AgentActivity[]>();
  for (const act of activities) {
    if (act.type === 'stream_chunk') continue;
    const list = agentGroups.get(act.agent) || [];
    list.push(act);
    agentGroups.set(act.agent, list);
  }

  // Summary: count running vs done, list agents involved
  const runningCount = activities.filter((a) => a.status === 'running' && a.type !== 'stream_chunk').length;
  const agentsInvolved = Array.from(agentGroups.keys());
  const hasErrors = activities.some((a) => a.status === 'error');

  return (
    <div className="border-b border-border bg-card/30 px-4 py-2">
      {/* Collapsed summary bar */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground"
      >
        <div className="flex items-center gap-1.5">
          {agentsInvolved.map((agentRole, idx) => {
            const meta = AGENT_META[agentRole];
            return (
              <div key={agentRole} className="flex items-center gap-1">
                {idx > 0 && <span className="text-muted/40">→</span>}
                <span
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                  style={{ color: meta.color, backgroundColor: `${meta.color}15` }}
                >
                  <PixelAvatar role={meta.role} size={12} />
                  {meta.name}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex-1" />

        {runningCount > 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-accent">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            工作中…
          </span>
        ) : hasErrors ? (
          <span className="text-[11px] text-red-400">完成（有问题）</span>
        ) : (
          <span className="text-[11px] text-muted">完成（{activities.length} 步）</span>
        )}

        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-background/60 p-2">
          {activities
            .filter((a) => a.type !== 'stream_chunk' && a.type !== 'agent_end')
            .map((act) => {
              const meta = AGENT_META[act.agent];
              const icon = getActivityIcon(act);
              const color = getActivityColor(act);
              const isRunning = act.status === 'running';
              const hasDetail = !!act.detail;
              const isOpen = showDetails === act.id;

              return (
                <div key={act.id} className="group">
                  <button
                    type="button"
                    onClick={() => hasDetail && setShowDetails(isOpen ? null : act.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11.5px] transition-colors ${
                      hasDetail ? 'hover:bg-accent/5 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <span
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[11px] ${isRunning ? 'animate-spin-slow' : ''}`}
                      style={{ color }}
                    >
                      {icon}
                    </span>
                    <span
                      className="shrink-0 text-[10px] font-medium opacity-60"
                      style={{ color: meta.color }}
                    >
                      {meta.name}
                    </span>
                    <span className={`flex-1 truncate ${isRunning ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {act.label}
                    </span>
                    {act.durationMs !== undefined && !isRunning && (
                      <span className="shrink-0 font-mono text-[10px] text-muted/60">
                        {act.durationMs < 1000 ? `${act.durationMs}ms` : `${(act.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    )}
                    {hasDetail && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={`text-muted/40 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    )}
                  </button>
                  {isOpen && act.detail && (
                    <div className="ml-8 mr-2 mb-1 rounded bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                      {act.detail}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function StreamingBubble({
  agent,
  content,
}: {
  agent: AgentRole | null;
  content: string;
}) {
  const agentMeta = agent ? AGENT_META[agent] : AGENT_META.orchestrator;
  const role = agentMeta.role;

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div
        className="pixel-avatar-box h-8 w-8 shrink-0"
        style={{ borderColor: `${agentMeta.color}50` }}
      >
        <PixelAvatar role={role} size={26} floating />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: agentMeta.color }}>
            {agentMeta.name}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-accent">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            正在输出…
          </span>
        </div>
        <div className="chat-bubble chat-bubble-assistant max-w-[85%]">
          {content ? (
            <>
              {renderMarkdown(content)}
              <span className="streaming-cursor" />
            </>
          ) : (
            <span className="flex items-center gap-1.5 py-1">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="pixel-avatar-box h-8 w-8 shrink-0">
        <PixelAvatar role="orchestrator" size={26} floating />
      </div>
      <div className="chat-bubble chat-bubble-assistant flex items-center gap-1.5 py-3">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="ml-2 text-xs text-muted">正在思考…</span>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const time =
    message.timestamp && message.timestamp > 0
      ? new Date(message.timestamp).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  if (isUser) {
    return (
      <div className="flex items-start justify-end gap-3 animate-slide-up">
        <div className="chat-bubble chat-bubble-user max-w-[80%]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <div className="pixel-avatar-box h-8 w-8 shrink-0">
          <PixelAvatar role="user" size={26} />
        </div>
      </div>
    );
  }

  const agentMeta = message.agentRole
    ? AGENT_META[message.agentRole]
    : null;

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div
        className="pixel-avatar-box h-8 w-8 shrink-0"
        style={agentMeta ? { borderColor: `${agentMeta.color}50` } : undefined}
      >
        <PixelAvatar
          role={agentMeta?.role ?? 'orchestrator'}
          size={26}
          floating
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          {agentMeta && (
            <span
              className="text-xs font-semibold"
              style={{ color: agentMeta.color }}
            >
              {agentMeta.name}
            </span>
          )}
          {time && <span className="text-[10px] text-muted">{time}</span>}
        </div>
        <div className="chat-bubble chat-bubble-assistant max-w-[85%]">
          {renderMarkdown(message.content)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ChatPanel
// ============================================================

export function ChatPanel({
  messages,
  onSend,
  isLoading,
  activities = [],
  streamingContent = '',
  streamingAgent = null,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== 'system'),
    [messages]
  );

  const isStreaming = isLoading && (streamingContent.length > 0 || streamingAgent !== null);
  const showTyping = isLoading && !isStreaming;

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages, isLoading, streamingContent, activities.length]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    onSend(text);
    setInput('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleQuickAction = (cmd: string) => {
    if (isLoading) return;
    onSend(cmd);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Activity log (transparent agent trail) */}
      <ActivityLog activities={activities} />

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-3xl space-y-5">
          {visibleMessages.map((message, idx) => (
            <MessageBubble key={idx} message={message} />
          ))}
          {isStreaming && (
            <StreamingBubble agent={streamingAgent} content={streamingContent} />
          )}
          {showTyping && <TypingIndicator />}
        </div>
      </div>

      {/* Quick actions */}
      <div className="border-t border-border px-4 pt-3">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.cmd}
              type="button"
              disabled={isLoading}
              onClick={() => handleQuickAction(action.cmd)}
              className="group flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:border-accent/50 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="font-mono font-medium text-accent">
                {action.label}
              </span>
              <span className="text-muted group-hover:text-foreground">
                {action.desc}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={submit} className="px-4 pb-4 pt-2">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/40">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="向导师提问，或输入 /practice 开始练习…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted/60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-md shadow-accent/30 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            aria-label="发送"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted/70">
          按 Enter 发送，Shift + Enter 换行
        </p>
      </form>
    </div>
  );
}
