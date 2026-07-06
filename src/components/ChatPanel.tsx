'use client';

import React, {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AgentMessage, AgentRole, AgentActivity, AgentParadigm } from '@/types';
import { PixelAvatar, MascotRole } from './PixelAvatar';

export interface ChatPanelProps {
  messages: AgentMessage[];
  onSend: (text: string) => void;
  isLoading: boolean;
  /** Activities for the currently in-flight turn (live-updating). */
  liveActivities?: AgentActivity[];
  /** Content being streamed in */
  streamingContent?: string;
  /** Which agent is currently streaming */
  streamingAgent?: AgentRole | null;
}

// ============================================================
// Agent metadata — colors, mascots, paradigm info
// ============================================================

const AGENT_META: Record<
  AgentRole,
  { name: string; role: MascotRole; color: string; paradigm: AgentParadigm; paradigmDesc: string; icon: string }
> = {
  orchestrator: { name: '总控', role: 'orchestrator', color: '#818cf8', paradigm: 'Plan-and-Execute', paradigmDesc: '规划→执行→再规划→综合', icon: '◎' },
  lecturer: { name: '讲师', role: 'lecturer', color: '#34d399', paradigm: 'ReAct+CoT', paradigmDesc: '推理→行动→观察循环', icon: '✦' },
  problem_setter: { name: '出题官', role: 'problem_setter', color: '#fbbf24', paradigm: 'Plan-and-Execute+Reflexion', paradigmDesc: '规划→生成→验证→反思修复', icon: '◈' },
  examiner: { name: '考官', role: 'examiner', color: '#f87171', paradigm: 'Reflexion', paradigmDesc: '评估→反思→改进', icon: '◆' },
  path_planner: { name: '规划师', role: 'path_planner', color: '#fb923c', paradigm: 'Plan-and-Execute', paradigmDesc: '评估→规划→输出路径', icon: '➤' },
};

const QUICK_ACTIONS: { cmd: string; label: string; desc: string; color: string }[] = [
  { cmd: '/practice', label: '/practice', desc: '开始练习', color: '#fbbf24' },
  { cmd: '/plan', label: '/plan', desc: '生成学习计划', color: '#fb923c' },
  { cmd: '/hint', label: '/hint', desc: '给我一个提示', color: '#34d399' },
];

// ============================================================
// Activity type visual configuration
// ============================================================

interface ActivityVisual {
  icon: string;
  label: string;
  category: 'orchestration' | 'reasoning' | 'tool' | 'system' | 'result';
}

const ACTIVITY_VISUAL: Record<AgentActivity['type'], ActivityVisual> = {
  agent_start: { icon: '●', label: '启动', category: 'system' },
  agent_end: { icon: '○', label: '完成', category: 'system' },
  skill_load: { icon: '◆', label: '加载技能', category: 'system' },
  knowledge_read: { icon: '▤', label: '读取知识', category: 'system' },
  tool_call: { icon: '▸', label: '工具调用', category: 'tool' },
  tool_result: { icon: '✓', label: '工具结果', category: 'result' },
  thinking: { icon: '…', label: '思考', category: 'reasoning' },
  validate: { icon: '✓', label: '验证', category: 'tool' },
  // Plan-and-Execute orchestration
  plan_created: { icon: '◉', label: '制定计划', category: 'orchestration' },
  plan_step_start: { icon: '▸', label: '步骤开始', category: 'orchestration' },
  plan_step_done: { icon: '✓', label: '步骤完成', category: 'orchestration' },
  plan_replan: { icon: '↻', label: '重新规划', category: 'orchestration' },
  plan_assess: { icon: '◐', label: '评估现状', category: 'orchestration' },
  plan_structure: { icon: '☰', label: '组织输出', category: 'orchestration' },
  // ReAct
  react_thought: { icon: '🧠', label: '推理', category: 'reasoning' },
  react_action: { icon: '⚡', label: '行动', category: 'tool' },
  react_observation: { icon: '👁', label: '观察', category: 'result' },
  // CoT
  cot_diagnose: { icon: '🔍', label: '诊断', category: 'reasoning' },
  cot_design: { icon: '✦', label: '设计', category: 'reasoning' },
  cot_present: { icon: '✎', label: '呈现', category: 'reasoning' },
  // Reflexion
  reflexion_evaluate: { icon: '⚖', label: '评估', category: 'reasoning' },
  reflexion_critique: { icon: '↺', label: '反思', category: 'reasoning' },
  reflexion_verdict: { icon: '◈', label: '判定', category: 'result' },
  reflexion_feedback: { icon: '💡', label: '反馈', category: 'result' },
  reflexion_iteration: { icon: '↻', label: '迭代', category: 'reasoning' },
  // Plan-and-Execute+Reflexion (problem setter)
  pe_plan: { icon: '◐', label: '规划', category: 'orchestration' },
  pe_generate: { icon: '✎', label: '生成', category: 'reasoning' },
  pe_validate: { icon: '✓', label: '验证', category: 'tool' },
  pe_reflect: { icon: '↺', label: '反思', category: 'reasoning' },
  pe_repair: { icon: '🔧', label: '修复', category: 'tool' },
  pe_complete: { icon: '★', label: '完成', category: 'result' },
  // System
  stream_chunk: { icon: '·', label: '', category: 'system' },
  error: { icon: '✕', label: '错误', category: 'result' },
};

function getActivityCategory(type: AgentActivity['type']): 'orchestration' | 'reasoning' | 'tool' | 'system' | 'result' {
  return ACTIVITY_VISUAL[type]?.category || 'system';
}

// Tool display names
const TOOL_DISPLAY_NAMES: Record<string, { name: string; icon: string }> = {
  SearchKnowledge: { name: '搜索知识库', icon: '📚' },
  SearchProblems: { name: '搜索题库', icon: '🔍' },
  WebSearch: { name: '网络搜索', icon: '🌐' },
  ValidateProblem: { name: '验证题目', icon: '✅' },
  AnalyzeCode: { name: '分析代码', icon: '🔬' },
  LearningPath: { name: '生成路径', icon: '🗺️' },
  search_knowledge: { name: '搜索知识库', icon: '📚' },
  search_problems: { name: '搜索题库', icon: '🔍' },
  web_search: { name: '网络搜索', icon: '🌐' },
  validate_problem: { name: '验证题目', icon: '✅' },
  analyze_code: { name: '分析代码', icon: '🔬' },
  learning_path: { name: '生成路径', icon: '🗺️' },
};

function getToolDisplay(name?: string): { name: string; icon: string } {
  if (!name) return { name: '未知工具', icon: '⚙️' };
  return TOOL_DISPLAY_NAMES[name] || { name, icon: '⚙️' };
}

// ============================================================
// Lightweight Markdown renderer (enhanced)
// ============================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(```[\s\S]*?```|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      nodes.push(<code key={`${keyBase}-c${i}`} className="md-code">{m[2]}</code>);
    } else if (m[3] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${i}`} className="md-strong">{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      nodes.push(<em key={`${keyBase}-i${i}`} className="md-em">{m[4]}</em>);
    } else if (m[5] !== undefined) {
      nodes.push(<em key={`${keyBase}-i2${i}`} className="md-em">{m[5]}</em>);
    } else if (m[6] !== undefined) {
      nodes.push(
        <a key={`${keyBase}-a${i}`} href={m[7]} target="_blank" rel="noopener noreferrer" className="md-link">
          {m[6]}
        </a>
      );
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function smartJoin(lines: string[]): string {
  return lines.map((l) => l.trim()).reduce((acc, line, idx) => {
    if (idx === 0) return line;
    if (!acc) return line;
    if (!line) return acc + '\n';
    const lastChar = acc[acc.length - 1];
    const firstChar = line[0];
    const isCJK = (ch: string) => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch);
    const needsSpace = !isCJK(lastChar) && !isCJK(firstChar) && !/[.,;:!?，。；：！？、）】」』]/.test(lastChar);
    return acc + (needsSpace ? ' ' : '') + line;
  }, '');
}

function tryParseTable(lines: string[], i: number, keyBase: string): { el: React.ReactNode; nextI: number } | null {
  const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const isRow = (l: string) => l.trim().startsWith('|') || l.includes('|');
  if (!isRow(lines[i])) return null;
  if (i + 1 >= lines.length || !isSep(lines[i + 1])) return null;
  const splitRow = (l: string): string[] => {
    let s = l.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  };
  const header = splitRow(lines[i]);
  let j = i + 2;
  const rows: string[][] = [];
  while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) { rows.push(splitRow(lines[j])); j++; }
  const el = (
    <table key={`${keyBase}-t${i}`} className="md-table">
      <thead><tr>{header.map((h, hi) => <th key={hi}>{renderInline(h, `${keyBase}-th${i}-${hi}`)}</th>)}</tr></thead>
      <tbody>{rows.map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci}>{renderInline(c, `${keyBase}-td${i}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
    </table>
  );
  return { el, nextI: j };
}

function renderTextBlocks(text: string, keyBase: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let listKey = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={`${keyBase}-hr${i}`} className="md-hr" />); i++; continue; }
    if (!line.trim()) { i++; continue; }
    const tbl = tryParseTable(lines, i, keyBase);
    if (tbl) { blocks.push(tbl.el); i = tbl.nextI; continue; }
    const header = line.match(/^(#{1,6})\s+(.*)$/);
    if (header) {
      const level = header[1].length;
      blocks.push(<div key={`${keyBase}-h${i}`} className={`md-h${level}`}>{renderInline(header[2], `${keyBase}-hi${i}`)}</div>);
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push(<blockquote key={`${keyBase}-q${i}`} className="md-blockquote"><p className="md-p">{renderInline(smartJoin(quoteLines), `${keyBase}-qi${i}`)}</p></blockquote>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      blocks.push(<ul key={`${keyBase}-ul${listKey++}`} className="md-ul">{items.map((it, li) => <li key={li} className="md-li">{renderInline(it, `${keyBase}-uli${li}`)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      blocks.push(<ol key={`${keyBase}-ol${listKey++}`} className="md-ol">{items.map((it, li) => <li key={li} className="md-li">{renderInline(it, `${keyBase}-oli${li}`)}</li>)}</ol>);
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?|[-*]\s|\d+\.\s|\s*[-*_]{3,}\s*$)/.test(lines[i]) && !tryParseTable(lines, i, 'p')) { paraLines.push(lines[i]); i++; }
    if (paraLines.length > 0) blocks.push(<p key={`${keyBase}-p${i}`} className="md-p">{renderInline(smartJoin(paraLines), `${keyBase}-pi${i}`)}</p>);
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
      if (langMatch) { lang = langMatch[1]; code = trimmed.slice(langMatch[0].length); }
      blocks.push(
        <pre key={key} className="md-code-block">
          {lang && <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-muted">{lang}</span>}
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
// PixelMini — tiny 8x8 pixel art icons for paradigm step types
// ============================================================

function PixelIcon({ type, size = 14, color }: { type: string; size?: number; color?: string }) {
  // Each icon is an 8x8 grid. '.' = transparent, 'a' = primary color
  const icons: Record<string, string[]> = {
    // Diagnose - magnifying glass
    diagnose: [
      '........',
      '..aaaa..',
      '.a....a.',
      '.a.aa.a.',
      '.a.aa.a.',
      '.a....a.',
      '..aaaa..',
      '....aa..',
    ],
    // Design - sparkle/star
    design: [
      '....a...',
      '...aaa..',
      '.aaaaaa.',
      '...aaa..',
      'a.aaaa.a',
      '.a.aa.a.',
      '..a..a..',
      '........',
    ],
    // Present - pencil/writing
    present: [
      '......a.',
      '.....aa.',
      '....aa..',
      '...aa...',
      '..aa....',
      '.aaba...',
      'aabaa...',
      '.aaa....',
    ],
    // Evaluate - scales/balance
    evaluate: [
      'a......a',
      'aa....aa',
      '.a.aa.a.',
      '..aaaa..',
      '...aa...',
      '...aa...',
      '..aaaa..',
      '.a....a.',
    ],
    // Critique - circular arrow (reflection)
    critique: [
      '..aaa...',
      '.a...a..',
      'a..a..a.',
      'a.a...a.',
      'a....aa.',
      '.a...a..',
      'a..aaa..',
      '........',
    ],
    // Verdict - diamond/badge
    verdict: [
      '...aa...',
      '..aaaa..',
      '.aaaaaa.',
      'aaaaaaaa',
      'aaaaaaaa',
      '.aaaaaa.',
      '..aaaa..',
      '...aa...',
    ],
    // Feedback - lightbulb
    feedback: [
      '..aaaa..',
      '.aaaaaa.',
      'a.aaaa.a',
      'a.aaaa.a',
      '.aaaaaa.',
      '..aaaa..',
      '...aa...',
      '........',
    ],
    // PE plan - compass/map
    pe_plan: [
      '.aaaaaa.',
      'a......a',
      'a..aa..a',
      'a.aaaa.a',
      'a..aa..a',
      'a......a',
      '.aaaaaa.',
      '........',
    ],
    // PE generate - gear/create
    pe_generate: [
      '...aa...',
      '.a.aa.a.',
      'a.aaaa.a',
      'aa.aa.aa',
      'aaaaaaaa',
      '.a.aa.a.',
      '..a..a..',
      '........',
    ],
    // PE validate - checkmark
    pe_validate: [
      '......a.',
      '.....a..',
      '....a...',
      'a..a....',
      '.a.a....',
      '..a.....',
      '........',
      '........',
    ],
    // PE reflect - thought bubble
    pe_reflect: [
      '..aaaa..',
      '.a....a.',
      'a.aaaa.a',
      'a......a',
      'a.aaaa.a',
      '.a....a.',
      '..a..a..',
      '...aa...',
    ],
    // PE repair - wrench
    pe_repair: [
      'a.......',
      'aa......',
      '.aa.....',
      '..aaa...',
      '...aaa..',
      '....aaa.',
      '.....aa.',
      '......a.',
    ],
    // PE complete - star
    pe_complete: [
      '...a....',
      '..aaa...',
      '.aaaaa..',
      'aa.aa.aa',
      'a.aaaa.a',
      '..a..a..',
      '.a....a.',
      '........',
    ],
    // Plan assess - eye
    plan_assess: [
      '........',
      '..aaaa..',
      '.aabbba.',
      'aabbbbaa',
      'aababbaa',
      '.aabbba.',
      '..aaaa..',
      '........',
    ],
    // Plan structure - list/blocks
    plan_structure: [
      'a.a.aaa.',
      'a.a.a...',
      'aaa.aaa.',
      '...a...a',
      'aaa.aaa.',
      'a.a.a.a.',
      'a.a.aaa.',
      '........',
    ],
  };

  const grid = icons[type] || icons.diagnose;
  const pixels: React.ReactNode[] = [];
  const fill = color || '#818cf8';
  const darkFill = color ? `${color}88` : '#6366f1';

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      pixels.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1.02}
          height={1.02}
          fill={ch === 'b' ? darkFill : fill}
        />
      );
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      className="pixel-mini-icon"
      style={{ imageRendering: 'pixelated' }}
    >
      {pixels}
    </svg>
  );
}

// ============================================================
// PlanTimeline — visualizes Plan-and-Execute orchestration
// Shows steps as a horizontal/vertical progress with status
// ============================================================

function PlanTimeline({ activities, isLive }: { activities: AgentActivity[]; isLive?: boolean }) {
  const planCreated = activities.find(a => a.type === 'plan_created');
  if (!planCreated) return null;

  const totalSteps = planCreated.planTotal || 0;
  const stepStarts = activities.filter(a => a.type === 'plan_step_start');
  const stepDones = activities.filter(a => a.type === 'plan_step_done');
  const replans = activities.filter(a => a.type === 'plan_replan');
  const assessAct = activities.find(a => a.type === 'plan_assess');
  const structAct = activities.find(a => a.type === 'plan_structure');

  const completedCount = stepDones.length;
  const currentRunning = stepStarts.find(s => !stepDones.some(d => d.planStep === s.planStep));
  const currentStepIdx = currentRunning ? (currentRunning.planStep ?? completedCount) : completedCount;

  const [expanded, setExpanded] = useState(true);

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="flex w-8 shrink-0 flex-col items-center pt-2">
        <div className="h-2 w-2" style={{
          backgroundColor: isLive && currentStepIdx < totalSteps ? '#818cf8' : '#64748b',
          boxShadow: isLive && currentStepIdx < totalSteps ? '0 0 6px #818cf880' : 'none',
        }} />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="pixel-card group flex w-full items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-3 py-2 text-left transition-all hover:border-indigo-500/40 hover:bg-indigo-500/10"
        >
          <PixelIcon type="pe_plan" size={14} color="#818cf8" />
          <span className="text-[11px] font-bold tracking-wide" style={{ color: '#818cf8' }}>
            总控 · PLAN-AND-EXECUTE
          </span>
          <span className="font-mono text-[10px] text-muted/70">
            {isLive ? `执行中 ${completedCount}/${totalSteps}` : `已完成 ${totalSteps}步`}
          </span>
          <div className="flex-1" />
          {/* Pixel progress bar */}
          <div className="hidden sm:flex items-center gap-px">
            {Array.from({ length: Math.min(totalSteps, 8) }, (_, i) => {
              const isDone = i < completedCount;
              const isCurrent = i === currentStepIdx && isLive;
              return (
                <div key={i} className="h-2" style={{
                  width: '8px',
                  backgroundColor: isDone ? '#818cf8' : isCurrent ? '#818cf8' : '#2a2e3e',
                  opacity: isCurrent ? 0.7 : 1,
                  animation: isCurrent ? 'cm-pulse-subtle 1s ease-in-out infinite' : 'none',
                }} />
              );
            })}
          </div>
          {/* Pixel arrow */}
          <div className="flex flex-col gap-0.5" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <div className="h-0.5 w-2 bg-muted/40" />
            <div className="h-0.5 w-1.5 bg-muted/40 ml-0.5" />
          </div>
        </button>

        {expanded && (
          <div className="pixel-card mt-1.5 ml-1 rounded-xl border border-border/50 bg-card/60 p-3">
            {/* Assess/structure indicators */}
            {(assessAct || structAct) && (
              <div className="mb-2 flex items-center gap-2 rounded-sm border border-indigo-500/10 bg-indigo-950/20 px-2 py-1">
                {assessAct && (
                  <div className="flex items-center gap-1">
                    <PixelIcon type="plan_assess" size={10} color="#818cf8" />
                    <span className="text-[10px] text-indigo-300/80">评估</span>
                  </div>
                )}
                {structAct && (
                  <>
                    <div className="h-0.5 w-2 bg-indigo-500/20" />
                    <div className="flex items-center gap-1">
                      <PixelIcon type="plan_structure" size={10} color="#818cf8" />
                      <span className="text-[10px] text-indigo-300/80">规划</span>
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Plan detail */}
            {planCreated.detail && (
              <div className="mb-2 rounded-sm bg-indigo-950/10 px-2 py-1.5 text-[10.5px] text-indigo-200/60 whitespace-pre-wrap leading-relaxed">
                {planCreated.detail}
              </div>
            )}
            {/* Step indicators */}
            <div className="space-y-0.5">
              {Array.from({ length: totalSteps }, (_, i) => {
                const startAct = stepStarts.find(s => s.planStep === i);
                const doneAct = stepDones.find(d => d.planStep === i);
                const isDone = !!doneAct;
                const isRunning = !!startAct && !isDone;
                const isPending = !startAct;
                const agentRole = startAct?.agent || (isDone ? doneAct?.agent : null);
                const meta = agentRole ? AGENT_META[agentRole] : null;

                return (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    {/* Pixel step box */}
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[9px] font-bold"
                      style={{
                        backgroundColor: isDone ? `${meta?.color || '#818cf8'}20` : isRunning ? `${meta?.color || '#818cf8'}15` : '#1a1d29',
                        color: isDone ? meta?.color || '#818cf8' : isRunning ? meta?.color || '#818cf8' : '#64748b',
                        border: `2px solid ${isDone ? meta?.color || '#818cf8' : isRunning ? `${meta?.color || '#818cf8'}80` : '#3a3f52'}`,
                      }}
                    >
                      {isDone ? (
                        <PixelIcon type="pe_validate" size={8} color={meta?.color || '#818cf8'} />
                      ) : isRunning ? (
                        <span className="animate-pulse-subtle" style={{ color: meta?.color || '#818cf8' }}>▶</span>
                      ) : (
                        <span className="font-mono">{i + 1}</span>
                      )}
                    </div>
                    <span className={`text-[10.5px] ${isDone ? 'text-muted' : isRunning ? 'text-foreground font-medium' : 'text-muted/50'}`}>
                      {meta ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="rounded-sm px-1 text-[9px] font-bold"
                            style={{ color: meta.color, backgroundColor: `${meta.color}15`, border: `1px solid ${meta.color}25` }}>
                            {meta.icon} {meta.name}
                          </span>
                        </span>
                      ) : ''}
                      <span className="ml-1">{isDone ? '已完成' : isRunning ? '执行中…' : '等待中'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Re-plan notifications */}
            {replans.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                {replans.map((r) => (
                  <div key={r.id} className="flex items-start gap-1.5 rounded-sm border border-amber-500/10 bg-amber-950/20 px-2 py-1 text-[10.5px]">
                    <PixelIcon type="critique" size={10} color="#fbbf24" />
                    <div>
                      <span className="font-bold text-amber-400">计划已调整</span>
                      <span className="text-amber-200/70"> — {r.detail?.split('\n')[0]?.replace('原因: ', '') || r.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ReActIteration — groups Thought/Action/Observation by turn
// ============================================================

function ReActIteration({
  turn,
  activities,
  agentMeta,
}: {
  turn: number;
  activities: AgentActivity[];
  agentMeta: typeof AGENT_META[AgentRole];
}) {
  const [expanded, setExpanded] = useState(false);
  const thought = activities.find(a => a.type === 'react_thought');
  const action = activities.find(a => a.type === 'react_action');
  const observation = activities.find(a => a.type === 'react_observation');
  const isRunning = activities.some(a => a.status === 'running');
  const hasError = activities.some(a => a.status === 'error' || a.status === 'warning');

  const toolInfo = action ? getToolDisplay(action.toolName) : null;
  const toolSuccess = observation?.status !== 'warning' && observation?.status !== 'error';

  return (
    <div className="react-turn" data-turn={turn}>
      {/* Turn header — pixel style */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left transition-colors hover:bg-background/40"
      >
        {/* Pixel turn number box */}
        <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-[9px] font-bold ${isRunning ? 'animate-pulse' : ''}`}
          style={{
            backgroundColor: isRunning ? `${agentMeta.color}20` : hasError ? '#f8717120' : `${agentMeta.color}10`,
            color: isRunning ? agentMeta.color : hasError ? '#f87171' : agentMeta.color,
            border: `2px solid ${isRunning ? agentMeta.color : hasError ? '#f8717180' : `${agentMeta.color}50`}`,
          }}
        >
          {isRunning ? <span className="text-[8px]">▶</span> : hasError ? '!' : turn}
        </span>
        <span className="text-[10px] font-bold tracking-wide" style={{ color: agentMeta.color }}>
          T{turn}
        </span>
        {toolInfo && !isRunning && (
          <span className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-bold"
            style={{
              backgroundColor: toolSuccess ? '#10b98110' : '#f59e0b10',
              color: toolSuccess ? '#34d399' : '#fbbf24',
              border: `1px solid ${toolSuccess ? '#10b98130' : '#f59e0b30'}`,
            }}>
            <PixelIcon type="pe_generate" size={9} color={toolSuccess ? '#34d399' : '#fbbf24'} />
            {toolInfo.name}
          </span>
        )}
        {isRunning && !action && (
          <span className="text-[10px] text-emerald-300/70 flex items-center gap-1">
            <PixelIcon type="diagnose" size={9} color="#34d399" /> 推理中…
          </span>
        )}
        {isRunning && action && !observation && (
          <span className="text-[10px] text-blue-300/70 flex items-center gap-1">
            <PixelIcon type="pe_generate" size={9} color="#60a5fa" /> 执行工具…
          </span>
        )}
        <div className="flex-1" />
        {/* Pixel arrow */}
        <div className="flex flex-col gap-0.5" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <div className="h-0.5 w-2 bg-muted/30" />
          <div className="h-0.5 w-1.5 bg-muted/30 ml-0.5" />
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="ml-6 mr-1 space-y-1 pb-1">
          {/* Thought */}
          {thought && thought.detail && (
            <div className="pixel-card rounded-sm border border-purple-500/20 bg-purple-500/5 p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <PixelIcon type="diagnose" size={10} color="#c084fc" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-purple-300/80">THOUGHT · 推理</span>
              </div>
              <div className="text-[10.5px] leading-relaxed text-purple-100/70 whitespace-pre-wrap">
                {thought.detail}
              </div>
            </div>
          )}

          {/* Action */}
          {action && (
            <div className={`pixel-card rounded-sm border p-2 ${
              action.status === 'running'
                ? 'border-blue-500/25 bg-blue-500/8'
                : toolSuccess
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/25 bg-amber-500/8'
            }`}>
              <div className="mb-1 flex items-center gap-1.5">
                <PixelIcon type="pe_generate" size={10} color={action.status === 'running' ? '#60a5fa' : toolSuccess ? '#34d399' : '#fbbf24'} />
                <span className={`text-[9px] font-bold uppercase tracking-wider ${
                  action.status === 'running' ? 'text-blue-300/80' : toolSuccess ? 'text-emerald-300/80' : 'text-amber-300/80'
                }`}>
                  ACTION · {action.status === 'running' ? '执行中' : toolSuccess ? '执行成功' : '执行警告'}
                </span>
                <span className="font-mono text-[10px] font-bold" style={{ color: toolSuccess ? '#34d399' : '#fbbf24' }}>
                  {toolInfo?.name || action.toolName}
                </span>
              </div>
              {action.toolArgs && (
                <div className="font-mono text-[10px] text-slate-400/80 break-all rounded-sm bg-black/20 px-1.5 py-1 mt-1">
                  {action.toolArgs}
                </div>
              )}
            </div>
          )}

          {/* Observation */}
          {observation && observation.detail && (
            <div className={`pixel-card rounded-sm border p-2 ${
              toolSuccess ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              <div className="mb-1 flex items-center gap-1.5">
                <PixelIcon type="plan_assess" size={10} color={toolSuccess ? '#22d3ee' : '#fbbf24'} />
                <span className={`text-[9px] font-bold uppercase tracking-wider ${
                  toolSuccess ? 'text-cyan-300/80' : 'text-amber-300/80'
                }`}>
                  OBSERVATION · 观察
                </span>
              </div>
              <div className="text-[10.5px] leading-relaxed text-slate-300/70 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {observation.detail}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CoTChain — Chain-of-Thought teaching reasoning (Lecturer)
// Shows: Diagnose → Design → Present (linear pipeline with connector line)
// ============================================================

function CoTChain({ activities, agentMeta }: {
  activities: AgentActivity[];
  agentMeta: typeof AGENT_META[AgentRole];
}) {
  const diagnose = activities.find(a => a.type === 'cot_diagnose');
  const design = activities.find(a => a.type === 'cot_design');
  const present = activities.find(a => a.type === 'cot_present');

  const stepDefs = [
    { act: diagnose, key: 'diagnose', label: '诊断卡点', color: '#a78bfa' },
    { act: design, key: 'design', label: '设计引导', color: '#c084fc' },
    { act: present, key: 'present', label: '组织呈现', color: '#e879f9' },
  ];
  const steps = stepDefs.filter(s => s.act);

  if (steps.length === 0) return null;

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="flex w-8 shrink-0 flex-col items-center pt-2">
        <div className="h-2 w-2" style={{ backgroundColor: agentMeta.color, boxShadow: `0 0 0 1px ${agentMeta.color}40` }} />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="pixel-card rounded-xl border border-purple-500/25 bg-purple-500/5 p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <PixelIcon type="diagnose" size={14} color="#c084fc" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300/90">
              CoT · 教学思维链
            </span>
            <span className="font-mono text-[9px] text-purple-300/40">DIAGNOSE→DESIGN→PRESENT</span>
          </div>
          <div className="flex items-center gap-0.5">
            {steps.map((s, i) => {
              const isDone = s.act!.status === 'success' || s.act!.status === 'warning';
              const isRunning = s.act!.status === 'running';
              return (
                <React.Fragment key={s.key}>
                  <div className="flex flex-col items-center gap-1">
                    {/* Pixel step box */}
                    <div className="flex h-8 w-8 items-center justify-center transition-all"
                      style={{
                        backgroundColor: isRunning ? `${s.color}20` : isDone ? `${s.color}12` : '#1a1d29',
                        border: `2px solid ${isRunning ? s.color : isDone ? `${s.color}70` : '#3a3f52'}`,
                        boxShadow: isRunning ? `0 0 0 1px ${s.color}60, 0 0 10px ${s.color}30` : isDone ? `inset 0 0 0 1px ${s.color}20` : 'none',
                      }}>
                      {isRunning ? (
                        <span className="animate-pulse-subtle text-[10px] font-bold" style={{ color: s.color }}>▶</span>
                      ) : isDone ? (
                        <PixelIcon type={s.key} size={14} color={s.color} />
                      ) : (
                        <span className="text-[10px] font-mono text-slate-600">{i + 1}</span>
                      )}
                    </div>
                    <span className="text-[9px] font-medium text-center" style={{ color: isDone ? s.color : '#64748b' }}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className="h-0.5 flex-1" style={{
                      backgroundColor: s.color,
                      opacity: steps[i+1].act && steps[i+1].act!.status !== 'running' ? 0.5 : 0.2,
                      maxWidth: '40px',
                    }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {/* Show detail for running/last completed step */}
          {steps.map(s => s.act!.detail && (
            <div key={s.key} className="mt-2 rounded-sm border border-purple-500/10 bg-purple-950/30 px-2 py-1.5 text-[10.5px] leading-relaxed text-purple-200/60 whitespace-pre-wrap"
              style={{ fontFamily: 'var(--font-pixel)' }}>
              {s.act!.detail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ReflexionChain — Reflection-based evaluation (Examiner)
// Shows: Evaluate → Critique → Verdict → Feedback (cyclic reflection)
// ============================================================

function ReflexionChain({ activities, agentMeta }: {
  activities: AgentActivity[];
  agentMeta: typeof AGENT_META[AgentRole];
}) {
  const [expanded, setExpanded] = useState(false);

  const evaluate = activities.find(a => a.type === 'reflexion_evaluate');
  const critique = activities.find(a => a.type === 'reflexion_critique');
  const verdict = activities.find(a => a.type === 'reflexion_verdict');
  const feedback = activities.find(a => a.type === 'reflexion_feedback');

  const hasAny = evaluate || critique || verdict || feedback;
  if (!hasAny) return null;

  const isRunning = activities.some(a => a.status === 'running');
  const score = verdict?.score;

  const steps = [
    { act: evaluate, key: 'evaluate', label: '评估', color: '#f87171', desc: '分析代码正确性' },
    { act: critique, key: 'critique', label: '反思', color: '#fb923c', desc: '自我审查评估质量' },
    { act: verdict, key: 'verdict', label: '判定', color: '#fbbf24', desc: score != null ? `${score} 分` : '综合判定' },
    { act: feedback, key: 'feedback', label: '反馈', color: '#34d399', desc: '输出改进建议' },
  ];

  const completedCount = steps.filter(s => s.act && s.act.status !== 'running').length;
  const scoreColor = score != null ? (score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171') : '#f87171';

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="flex w-8 shrink-0 flex-col items-center pt-2">
        <div className="h-2 w-2" style={{ backgroundColor: isRunning ? '#f87171' : agentMeta.color, boxShadow: `0 0 0 1px ${isRunning ? '#f87171' : agentMeta.color}40` }} />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="pixel-card group flex w-full items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2 text-left transition-all hover:border-red-500/40 hover:bg-red-500/10"
        >
          <PixelIcon type="evaluate" size={14} color="#f87171" />
          <span className="text-[11px] font-bold tracking-wide" style={{ color: '#f87171' }}>
            考官 · REFLEXION
          </span>
          <span className="font-mono text-[10px] text-muted/70">
            {isRunning ? `评估中 ${completedCount}/4` : score != null ? `评分 ${score}` : '评估完成'}
          </span>
          <div className="flex-1" />
          {/* Pixel score bar */}
          {score != null && (
            <div className="flex items-center gap-1">
              <div className="flex h-2 gap-px" style={{ backgroundColor: '#1a1d29', padding: '1px' }}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="w-1.5 h-full"
                    style={{ backgroundColor: i < Math.floor(score / 10) ? scoreColor : '#2a2e3e' }} />
                ))}
              </div>
              <span className="font-mono text-[11px] font-bold" style={{ color: scoreColor }}>{score}</span>
            </div>
          )}
          {/* Pixel arrow */}
          <div className="flex flex-col gap-0.5" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <div className="h-0.5 w-2 bg-muted/40" />
            <div className="h-0.5 w-1.5 bg-muted/40 ml-0.5" />
          </div>
        </button>
        {expanded && (
          <div className="pixel-card mt-1.5 ml-1 rounded-xl border border-border/50 bg-card/60 p-3">
            <div className="grid grid-cols-4 gap-2">
              {steps.map((s, i) => {
                if (!s.act) return <div key={i} />;
                const isDone = s.act.status === 'success' || s.act.status === 'warning';
                const isActive = s.act.status === 'running';
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5 p-2 text-center"
                    style={{
                      backgroundColor: isActive ? `${s.color}10` : isDone ? `${s.color}06` : 'transparent',
                      border: isActive ? `2px solid ${s.color}50` : isDone ? `1px solid ${s.color}20` : '1px dashed #3a3f52',
                    }}>
                    <div className="flex h-8 w-8 items-center justify-center"
                      style={{
                        backgroundColor: isActive ? `${s.color}20` : isDone ? `${s.color}10` : '#1a1d29',
                        border: `2px solid ${isActive ? s.color : isDone ? `${s.color}60` : '#3a3f52'}`,
                      }}>
                      {isActive ? (
                        <span className="animate-pulse-subtle text-[10px] font-bold" style={{ color: s.color }}>▶</span>
                      ) : isDone ? (
                        <PixelIcon type={s.key} size={14} color={s.color} />
                      ) : (
                        <span className="text-[10px] font-mono text-slate-600">{i + 1}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: isDone ? s.color : '#64748b' }}>
                      {s.label}
                    </span>
                    <span className="text-[9px] text-muted/60">{s.desc}</span>
                  </div>
                );
              })}
            </div>
            {evaluate?.detail && (
              <div className="mt-2 rounded-sm border border-red-500/10 bg-red-950/20 px-2 py-1.5 text-[10.5px] text-red-200/70 whitespace-pre-wrap">
                {evaluate.detail}
              </div>
            )}
            {feedback?.detail && (
              <div className="mt-1 rounded-sm border border-emerald-500/10 bg-emerald-950/20 px-2 py-1.5 text-[10.5px] text-emerald-200/70 whitespace-pre-wrap">
                {feedback.detail}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PEChain — Plan-and-Execute+Reflexion (Problem Setter)
// Shows: Plan → Generate → Validate → (Reflect → Repair)* → Complete
// ============================================================

function PEChain({ activities, agentMeta }: {
  activities: AgentActivity[];
  agentMeta: typeof AGENT_META[AgentRole];
}) {
  const [expanded, setExpanded] = useState(false);

  const plan = activities.find(a => a.type === 'pe_plan');
  const generate = activities.find(a => a.type === 'pe_generate');
  const validates = activities.filter(a => a.type === 'pe_validate');
  const reflects = activities.filter(a => a.type === 'pe_reflect');
  const repairs = activities.filter(a => a.type === 'pe_repair');
  const complete = activities.find(a => a.type === 'pe_complete');

  const hasAny = plan || generate || validates.length > 0 || complete;
  if (!hasAny) return null;

  const isRunning = activities.some(a => a.status === 'running');
  const repairCount = repairs.length;

  type Step = { key: string; label: string; color: string; status: 'done' | 'running' | 'pending'; detail?: string };
  const pipelineSteps: Step[] = [
    { key: 'pe_plan', label: '规划', color: '#fbbf24', status: plan ? (plan.status === 'running' ? 'running' : 'done') : 'pending' },
    { key: 'pe_generate', label: '生成', color: '#fb923c', status: generate ? (generate.status === 'running' ? 'running' : 'done') : 'pending' },
  ];

  for (let i = 0; i < Math.max(validates.length, repairs.length + 1); i++) {
    const v = validates[i];
    const r = repairs[i];
    const ref = reflects[i];
    if (v) {
      pipelineSteps.push({
        key: 'pe_validate',
        label: i === 0 ? '验证' : `验证#${i+1}`,
        color: v.status === 'error' ? '#f87171' : v.status === 'warning' ? '#fbbf24' : '#34d399',
        status: v.status === 'running' ? 'running' : v.status === 'error' ? 'done' : v.status === 'warning' ? 'done' : 'done',
        detail: v.detail,
      });
    }
    if (r || ref) {
      pipelineSteps.push({
        key: 'pe_reflect', label: '反思', color: '#f87171',
        status: ref ? (ref.status === 'running' ? 'running' : 'done') : 'pending',
      });
      pipelineSteps.push({
        key: 'pe_repair', label: '修复', color: '#fb923c',
        status: r ? (r.status === 'running' ? 'running' : 'done') : 'pending',
      });
    }
  }

  if (complete) {
    pipelineSteps.push({ key: 'pe_complete', label: '完成', color: '#34d399', status: 'done' });
  }

  const doneCount = pipelineSteps.filter(s => s.status === 'done').length;

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="flex w-8 shrink-0 flex-col items-center pt-2">
        <div className="h-2 w-2" style={{ backgroundColor: isRunning ? '#fbbf24' : agentMeta.color, boxShadow: `0 0 0 1px ${isRunning ? '#fbbf24' : agentMeta.color}40` }} />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="pixel-card group flex w-full items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-left transition-all hover:border-amber-500/40 hover:bg-amber-500/10"
        >
          <PixelIcon type="pe_plan" size={14} color="#fbbf24" />
          <span className="text-[11px] font-bold tracking-wide" style={{ color: '#fbbf24' }}>
            出题官 · PE+R
          </span>
          <span className="font-mono text-[10px] text-muted/70">
            {isRunning ? `执行中 ${doneCount}/${pipelineSteps.length}` : complete ? `出题完成${repairCount > 0 ? ` · ${repairCount}次修复` : ''}` : `生成中`}
          </span>
          <div className="flex-1" />
          {/* Pixel mini pipeline */}
          <div className="hidden sm:flex items-center gap-px">
            {pipelineSteps.slice(0, 8).map((s, i) => (
              <div key={i} className="h-2" style={{
                width: '6px',
                backgroundColor: s.status === 'done' ? s.color : s.status === 'running' ? s.color : '#2a2e3e',
                opacity: s.status === 'running' ? 0.8 : s.status === 'done' ? 1 : 0.4,
                animation: s.status === 'running' ? 'cm-pulse-subtle 1s ease-in-out infinite' : 'none',
              }} />
            ))}
          </div>
          {/* Pixel arrow */}
          <div className="flex flex-col gap-0.5" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <div className="h-0.5 w-2 bg-muted/40" />
            <div className="h-0.5 w-1.5 bg-muted/40 ml-0.5" />
          </div>
        </button>
        {expanded && (
          <div className="pixel-card mt-1.5 ml-1 rounded-xl border border-border/50 bg-card/60 p-3">
            <div className="flex flex-wrap items-center gap-0.5">
              {pipelineSteps.map((s, i) => (
                <React.Fragment key={i}>
                  <div className="flex items-center gap-1 px-1.5 py-1"
                    style={{
                      backgroundColor: s.status === 'running' ? `${s.color}15` : s.status === 'done' ? `${s.color}08` : 'transparent',
                      border: s.status === 'running' ? `1px solid ${s.color}50` : 'none',
                    }}>
                    <div className="flex h-5 w-5 items-center justify-center"
                      style={{
                        backgroundColor: s.status === 'running' ? `${s.color}20` : s.status === 'done' ? `${s.color}10` : '#1a1d29',
                        border: `1.5px solid ${s.status === 'running' ? s.color : s.status === 'done' ? `${s.color}60` : '#3a3f52'}`,
                      }}>
                      {s.status === 'running' ? (
                        <span className="animate-pulse-subtle text-[9px] font-bold" style={{ color: s.color }}>▶</span>
                      ) : s.status === 'done' ? (
                        <PixelIcon type={s.key} size={10} color={s.color} />
                      ) : (
                        <span className="text-[8px] font-mono text-slate-600">{i + 1}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-medium" style={{
                      color: s.status === 'done' ? s.color : s.status === 'running' ? s.color : '#64748b',
                    }}>{s.label}</span>
                  </div>
                  {i < pipelineSteps.length - 1 && (
                    <div className="h-0.5 w-2 bg-muted/20" />
                  )}
                </React.Fragment>
              ))}
            </div>
            {/* Reflection details */}
            {reflects.map((r, i) => r.detail && (
              <div key={i} className="mt-1.5 flex items-start gap-1.5 rounded-sm border border-red-500/10 bg-red-950/20 px-2 py-1 text-[10.5px]">
                <PixelIcon type="pe_reflect" size={10} color="#f87171" />
                <span className="text-red-200/70 whitespace-pre-wrap">{r.detail}</span>
              </div>
            ))}
            {complete?.detail && (
              <div className="mt-1.5 flex items-start gap-1.5 rounded-sm border border-emerald-500/10 bg-emerald-950/20 px-2 py-1 text-[10.5px]">
                <PixelIcon type="pe_complete" size={10} color="#34d399" />
                <span className="text-emerald-200/70">{complete.detail}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// EnhancedThinkingPanel — redesigned thinking chain
// Routes to paradigm-specific visualizers
// ============================================================

function EnhancedThinkingPanel({
  activities,
  isLive,
}: {
  activities: AgentActivity[];
  isLive?: boolean;
}) {
  if (activities.length === 0) return null;

  const visible = activities.filter(
    (a) => a.type !== 'stream_chunk' && a.type !== 'agent_end' && a.type !== 'agent_start'
  );
  if (visible.length === 0) return null;

  // --- Separate orchestrator plan activities (shown as PlanTimeline at top) ---
  const planActs = visible.filter(a => a.type.startsWith('plan_'));
  const nonPlanActs = visible.filter(a => !a.type.startsWith('plan_'));

  // --- Group remaining activities by agent ---
  const byAgent = new Map<AgentRole, AgentActivity[]>();
  for (const a of nonPlanActs) {
    if (!byAgent.has(a.agent)) byAgent.set(a.agent, []);
    byAgent.get(a.agent)!.push(a);
  }

  // --- For each agent, detect which paradigm components to render ---
  const agentBlocks: React.ReactNode[] = [];

  for (const [agent, acts] of byAgent) {
    const meta = AGENT_META[agent];
    const blocks: React.ReactNode[] = [];

    // Detect paradigm-specific activities
    const hasPE = acts.some(a => a.type.startsWith('pe_'));
    const hasReflexion = acts.some(a => a.type.startsWith('reflexion_'));
    const hasCoT = acts.some(a => a.type.startsWith('cot_'));
    const hasReAct = acts.some(a => a.type.startsWith('react_'));

    // PE+R chain (problem setter)
    if (hasPE) {
      blocks.push(<PEChain key={`pe-${agent}`} activities={acts} agentMeta={meta} />);
    }

    // Reflexion chain (examiner)
    if (hasReflexion) {
      blocks.push(<ReflexionChain key={`ref-${agent}`} activities={acts} agentMeta={meta} />);
    }

    // CoT chain (lecturer)
    if (hasCoT) {
      blocks.push(<CoTChain key={`cot-${agent}`} activities={acts} agentMeta={meta} />);
    }

    // ReAct iterations — only show as separate cards for ReAct-paradigm agents (lecturer)
    // For other paradigms, tool calls are shown as inline items in system activities
    const isReactParadigm = meta.paradigm === 'ReAct' || meta.paradigm === 'ReAct+CoT';
    if (hasReAct && isReactParadigm) {
      const reactTurns = new Map<number, AgentActivity[]>();
      for (const a of acts) {
        if (a.type.startsWith('react_') && a.reactTurn) {
          if (!reactTurns.has(a.reactTurn)) reactTurns.set(a.reactTurn, []);
          reactTurns.get(a.reactTurn)!.push(a);
        }
      }
      if (reactTurns.size > 0) {
        blocks.push(
          <div key={`react-wrap-${agent}`} className="flex items-start gap-3 animate-slide-up">
            <div className="flex w-8 shrink-0 flex-col items-center pt-2">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
              <div className="mt-1 w-px flex-1 bg-border" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="pixel-card rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2">
                <div className="mb-1 flex items-center gap-1.5 px-1">
                  <PixelIcon type="diagnose" size={12} color="#34d399" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">
                    ReAct · 推理-行动循环
                  </span>
                </div>
                {Array.from(reactTurns.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([turn, tActs]) => (
                    <ReActIteration key={turn} turn={turn} activities={tActs} agentMeta={meta} />
                  ))}
              </div>
            </div>
          </div>
        );
      }
    }

    // System activities (skill_load, knowledge_read, validate, tool_call, error, etc.)
    // For non-ReAct-paradigm agents, also include react_action/react_observation as tool call items
    const sysActs = acts.filter(a => {
      if (a.type.startsWith('plan_')) return false;
      if (a.type.startsWith('pe_')) return false;
      if (a.type.startsWith('reflexion_')) return false;
      if (a.type.startsWith('cot_')) return false;
      if (a.type === 'thinking') return false;
      if (isReactParadigm && a.type.startsWith('react_')) return false;
      // For non-ReAct agents, show react_action and react_observation as tool calls
      if (!isReactParadigm && a.type === 'react_thought') return false; // thoughts are internal
      return true;
    });

    if (sysActs.length > 0) {
      blocks.push(
        <div key={`sys-${agent}`} className="flex items-start gap-3 animate-slide-up">
          <div className="flex w-8 shrink-0 flex-col items-center pt-1">
            <div className="h-1.5 w-1.5" style={{ backgroundColor: '#475569', boxShadow: `0 0 0 1px ${meta.color}40` }} />
            <div className="mt-1 w-px flex-1 bg-border" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="pixel-card rounded-lg border border-border/40 bg-muted/10 px-2 py-1.5">
              <div className="space-y-0.5">
                {sysActs.map((act) => {
                  const isToolCall = act.type === 'react_action' || act.type === 'tool_call';
                  const isToolResult = act.type === 'react_observation' || act.type === 'tool_result';
                  const isError = act.status === 'error';
                  const hasDetail = Boolean(act.detail || act.toolArgs);
                  return (
                    <div key={act.id} className={`text-[10.5px] ${isToolCall ? 'py-0.5' : ''}`}>
                      <div className="flex items-center gap-1.5">
                        {isToolCall ? (
                          <PixelIcon type="pe_generate" size={10} color={act.status === 'running' ? '#fbbf24' : isError ? '#f87171' : '#60a5fa'} />
                        ) : isToolResult ? (
                          <PixelIcon type="pe_validate" size={10} color={isError ? '#f87171' : '#34d399'} />
                        ) : (
                          <span className="text-[9px]" style={{ color: '#64748b' }}>{ACTIVITY_VISUAL[act.type]?.icon || '·'}</span>
                        )}
                        <span className="rounded-sm px-1 text-[9px] font-bold tracking-wide"
                          style={{
                            color: meta.color,
                            backgroundColor: `${meta.color}15`,
                            border: `1px solid ${meta.color}25`,
                          }}>
                          {meta.icon} {meta.name}
                        </span>
                        <span className="text-muted/70 truncate flex-1">{act.label}</span>
                        {isToolCall && act.toolName && (
                          <span className="ml-0.5 rounded-sm bg-blue-500/10 px-1 font-mono text-[9px] text-blue-300/80"
                            style={{ border: '1px solid rgba(96,165,250,0.2)' }}>
                            {act.toolName}
                          </span>
                        )}
                        {isError && <span className="text-[9px] text-red-400">✗</span>}
                        {act.status === 'success' && isToolResult && <span className="text-[9px] text-emerald-400">✓</span>}
                      </div>
                      {/* Show tool args and detail for non-ReAct agents */}
                      {hasDetail && (
                        <div className="mt-0.5 ml-4 pl-2 border-l border-border/30">
                          {isToolCall && act.toolArgs && (
                            <div className="font-mono text-[9.5px] text-slate-400/70 break-all">
                              {act.toolArgs}
                            </div>
                          )}
                          {act.detail && (
                            <div className={`text-[9.5px] leading-relaxed whitespace-pre-wrap max-h-20 overflow-y-auto ${
                              isError ? 'text-red-300/60' : isToolResult ? 'text-cyan-300/60' : 'text-muted/60'
                            }`}>
                              {act.detail.length > 200 ? act.detail.slice(0, 200) + '…' : act.detail}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Thinking activities (generic, not captured by paradigm-specific chains)
    const thinkActs = acts.filter(a => a.type === 'thinking' && a.detail);
    if (thinkActs.length > 0 && !hasCoT && !hasReflexion && !hasPE) {
      blocks.push(
        <div key={`think-${agent}`} className="flex items-start gap-3 animate-slide-up">
          <div className="flex w-8 shrink-0 flex-col items-center pt-2">
            <div className="h-2 w-2" style={{ backgroundColor: meta.color, boxShadow: `0 0 0 1px ${meta.color}40` }} />
            <div className="mt-1 w-px flex-1 bg-border" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="pixel-card rounded-sm border border-slate-500/20 bg-slate-500/5 p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <PixelIcon type="diagnose" size={12} color="#94a3b8" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300/80">思考</span>
                <span className="rounded-sm px-1 text-[9px] font-bold"
                  style={{ color: meta.color, backgroundColor: `${meta.color}12`, border: `1px solid ${meta.color}20` }}>
                  {meta.icon} {meta.name}
                </span>
              </div>
              {thinkActs.map((t) => (
                <div key={t.id} className="text-[10.5px] leading-relaxed text-slate-300/70 whitespace-pre-wrap">
                  {t.detail}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    agentBlocks.push(...blocks);
  }

  return (
    <div className="space-y-1.5">
      {planActs.length > 0 && <PlanTimeline activities={planActs} isLive={isLive} />}
      {agentBlocks}
    </div>
  );
}

// ============================================================
// StreamingBubble — live content output with agent identity
// ============================================================

function StreamingBubble({
  agent,
  content,
}: {
  agent: AgentRole | null;
  content: string;
}) {
  const agentMeta = agent ? AGENT_META[agent] : AGENT_META.orchestrator;

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="pixel-avatar-box h-9 w-9 shrink-0" style={{ borderColor: `${agentMeta.color}50` }}>
        <PixelAvatar role={agentMeta.role} size={28} floating />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold"
            style={{ color: agentMeta.color, backgroundColor: `${agentMeta.color}12`, border: `1px solid ${agentMeta.color}25` }}>
            <span>{agentMeta.icon}</span>
            {agentMeta.name}
            <span className="opacity-60 font-normal text-[9px] ml-0.5">·{agentMeta.paradigm}</span>
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: agentMeta.color }} />
            <span style={{ color: agentMeta.color }}>正在输出…</span>
          </span>
        </div>
        <div className="agent-message-bubble max-w-[85%]" style={{ '--agent-color': agentMeta.color } as React.CSSProperties}>
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
      <div className="pixel-avatar-box h-9 w-9 shrink-0">
        <PixelAvatar role="orchestrator" size={28} floating />
      </div>
      <div className="agent-message-bubble flex items-center gap-2 py-3" style={{ '--agent-color': '#818cf8' } as React.CSSProperties}>
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="ml-2 text-xs text-muted">总控正在分析…</span>
      </div>
    </div>
  );
}

// ============================================================
// MessageBubble — user or assistant message with agent identity
// ============================================================

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const time = message.timestamp && message.timestamp > 0
    ? new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null;

  if (isUser) {
    return (
      <div className="flex items-start justify-end gap-3 animate-slide-up">
        <div className="user-message-bubble max-w-[80%]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <div className="pixel-avatar-box h-9 w-9 shrink-0" style={{ borderColor: '#a78bfa50' }}>
          <PixelAvatar role="user" size={28} />
        </div>
      </div>
    );
  }

  const agentMeta = message.agentRole ? AGENT_META[message.agentRole] : null;

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <div className="pixel-avatar-box h-9 w-9 shrink-0"
        style={agentMeta ? { borderColor: `${agentMeta.color}50` } : undefined}>
        <PixelAvatar role={agentMeta?.role ?? 'orchestrator'} size={28} floating />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          {agentMeta && (
            <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold"
              style={{ color: agentMeta.color, backgroundColor: `${agentMeta.color}12`, border: `1px solid ${agentMeta.color}25` }}>
              <span>{agentMeta.icon}</span>
              {agentMeta.name}
              <span className="opacity-60 font-normal text-[9px] ml-0.5">·{agentMeta.paradigm}</span>
            </span>
          )}
          {time && <span className="text-[10px] text-muted">{time}</span>}
        </div>
        <div className="agent-message-bubble max-w-[85%]"
          style={agentMeta ? { '--agent-color': agentMeta.color } as React.CSSProperties : undefined}>
          {renderMarkdown(message.content)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ActiveAgentsBar — shows which agents are currently active
// ============================================================

function ActiveAgentsBar({ activities, currentAgent }: { activities: AgentActivity[]; currentAgent: AgentRole | null }) {
  if (activities.length === 0 && !currentAgent) return null;

  const activeAgents = new Set<AgentRole>();
  for (const a of activities) {
    if (a.status === 'running') activeAgents.add(a.agent);
  }
  if (currentAgent) activeAgents.add(currentAgent);
  if (activeAgents.size === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 pt-2">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <span className="text-[10px] text-muted/60">活跃:</span>
        {Array.from(activeAgents).map(role => {
          const meta = AGENT_META[role];
          return (
            <span key={role}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ color: meta.color, backgroundColor: `${meta.color}12`, border: `1px solid ${meta.color}25` }}>
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: meta.color }} />
              {meta.icon} {meta.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// ChatPanel — main chat interface
// ============================================================

export function ChatPanel({
  messages,
  onSend,
  isLoading,
  liveActivities = [],
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
  const showLiveThinking = isLoading && liveActivities.length > 0;
  const showTyping = isLoading && !isStreaming && liveActivities.length === 0;

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages, isLoading, streamingContent, liveActivities.length]);

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
      {/* Active agents indicator bar */}
      <ActiveAgentsBar activities={liveActivities} currentAgent={streamingAgent} />

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {visibleMessages.map((message, idx) => {
            const isLastAssistant =
              message.role === 'assistant' && idx === visibleMessages.length - 1;
            return (
              <div key={idx} className="space-y-2">
                {/* Show enhanced thinking panel above assistant messages */}
                {message.role === 'assistant' &&
                  message.activities &&
                  message.activities.length > 0 &&
                  !(isLoading && isLastAssistant) && (
                    <EnhancedThinkingPanel activities={message.activities} isLive={false} />
                  )}
                <MessageBubble message={message} />
              </div>
            );
          })}

          {/* Live thinking panel for current in-flight turn */}
          {showLiveThinking && (
            <EnhancedThinkingPanel activities={liveActivities} isLive={true} />
          )}

          {/* Streaming content */}
          {isStreaming && (
            <StreamingBubble agent={streamingAgent} content={streamingContent} />
          )}

          {/* Typing indicator */}
          {showTyping && <TypingIndicator />}
        </div>
      </div>

      {/* Quick actions */}
      <div className="border-t border-border/60 px-4 pt-3">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.cmd}
              type="button"
              disabled={isLoading}
              onClick={() => handleQuickAction(action.cmd)}
              className="group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              style={{
                borderColor: `${action.color}30`,
                backgroundColor: `${action.color}08`,
              }}
            >
              <span className="font-mono font-medium" style={{ color: action.color }}>
                {action.label}
              </span>
              <span className="text-muted group-hover:text-foreground transition-colors">
                {action.desc}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={submit} className="px-4 pb-4 pt-2">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card/80 p-2 transition-all focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/30 focus-within:shadow-lg focus-within:shadow-accent/5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="向导师提问，或输入 /practice 开始练习…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted/50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 transition-all hover:shadow-indigo-500/40 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            aria-label="发送"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted/60">
          <span className="text-indigo-400/70">Enter</span> 发送 · <span className="text-indigo-400/70">Shift+Enter</span> 换行 · 多智能体实时协作
        </p>
      </form>
    </div>
  );
}
