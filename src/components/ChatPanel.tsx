'use client';

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AgentMessage, AgentRole } from '@/types';
import { PixelAvatar, MascotRole } from './PixelAvatar';

export interface AgentTrailItem {
  agent: AgentRole;
  action: string;
  timestamp: number;
}

export interface ChatPanelProps {
  messages: AgentMessage[];
  onSend: (text: string) => void;
  isLoading: boolean;
  agentTrail: AgentTrailItem[];
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
// Lightweight Markdown renderer (no external deps)
// Handles: code fences, inline code, bold, h1-h3, ul/ol,
// blockquotes and paragraphs.
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

    // Headers
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

    // Blockquote
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

    // Unordered list
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

    // Ordered list
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

    // Paragraph (gather consecutive plain lines)
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
      // Fenced code block
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

function AgentTrailBar({ trail }: { trail: AgentTrailItem[] }) {
  if (trail.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card/50 px-4 py-2.5">
      <span className="mr-1 text-[11px] font-medium text-muted">
        智能体协作
      </span>
      {trail.map((item, idx) => {
        const meta = AGENT_META[item.agent] ?? { name: item.agent, role: 'orchestrator' as MascotRole, color: '#818cf8' };
        return (
          <div key={`${item.timestamp}-${idx}`} className="flex items-center gap-1.5">
            {idx > 0 && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted/50">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            )}
            <span
              className="agent-chip-pixel"
              title={item.action}
              style={{ borderColor: `${meta.color}40`, color: meta.color }}
            >
              <PixelAvatar role={meta.role} size={14} />
              <span>{meta.name}</span>
            </span>
          </div>
        );
      })}
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
  agentTrail,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== 'system'),
    [messages]
  );

  // Auto-scroll to bottom on new messages / loading state.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages, isLoading]);

  // Auto-resize textarea.
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
      {/* Agent trail indicator */}
      <AgentTrailBar trail={agentTrail} />

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-3xl space-y-5">
          {visibleMessages.map((message, idx) => (
            <MessageBubble key={idx} message={message} />
          ))}
          {isLoading && <TypingIndicator />}
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
