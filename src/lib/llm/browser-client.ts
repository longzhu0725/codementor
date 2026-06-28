'use client';

import {
  AgentMessage,
  AlgorithmProblem,
  ChatResponse,
  LearnerState,
  StreamCallbacks,
  AgentActivity,
  AgentRole,
} from '@/types';
import {
  LLMProvider,
  PROVIDER_DEFAULTS,
} from './client';
import { SUB_AGENTS } from '@/lib/agents/definitions';
import { skillRegistry } from '@/lib/skills/registry';
import { KNOWLEDGE_TOPICS } from '@/lib/knowledge/topics';
import { getRandomProblem } from '@/lib/knowledge/problems';
import { quickValidate, validateProblemStructure } from '@/lib/problem-validator';
import { toolRegistry } from '@/lib/tools/registry';

interface ChatContext {
  currentProblem?: { title: string; description: string } | null;
  codeSubmission?: string;
  executionResult?: { passed: number; failed: number; details?: string };
}

/**
 * Settings passed from the app to the browser LLM client.
 * Supports any OpenAI-compatible API endpoint.
 */
export interface BrowserLLMSettings {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

const PRACTICE_SCHEMA_PROMPT = `你正在生成一道 Python 算法练习题。请严格按下方 JSON 格式返回，不要添加 JSON 之外的额外说明。JSON 必须包裹在 \`\`\`json 与 \`\`\` 代码块中。

\`\`\`json
{
  "id": "唯一题目标识，如 two-sum",
  "title": "题目标题",
  "topicId": "知识点ID，从知识库参考中选择一个最接近的",
  "difficulty": 1,
  "description": "题目描述，包含输入输出说明",
  "examples": [{"input": "示例输入", "output": "示例输出", "explanation": "解释"}],
  "constraints": ["约束1", "约束2"],
  "starterCode": "def solution(参数):\\n    pass",
  "hints": ["提示1", "提示2", "提示3"],
  "solution": "参考解答代码",
  "timeComplexity": "O(?)",
  "spaceComplexity": "O(?)",
  "testCases": [{"input": "输入", "expectedOutput": "期望输出"}]
}
\`\`\`

字段要求：
- id: 字符串，英文小写，用短横线连接
- title: 字符串，中文标题
- topicId: 字符串，必须与知识库中某个知识点的 id 一致
- difficulty: 整数 1-5
- description: 字符串，清晰描述题目要求
- examples: 数组，至少 1 个示例
- constraints: 数组，至少 1 条约束
- starterCode: 字符串，包含函数签名的 Python 代码
- hints: 数组，3 条由浅入深的提示
- solution: 字符串，完整可运行的 Python 参考解答
- timeComplexity: 字符串，如 O(n)
- spaceComplexity: 字符串，如 O(n)
- testCases: 数组，至少 3 个测试用例，包含边界情况`;

// ============================================================
// Activity helpers
// ============================================================

let activityCounter = 0;
function newActivity(
  agent: AgentRole,
  type: AgentActivity['type'],
  label: string,
  extra?: Partial<AgentActivity>
): AgentActivity {
  activityCounter++;
  return {
    id: `act-${Date.now()}-${activityCounter}`,
    agent,
    type,
    label,
    status: 'running',
    timestamp: Date.now(),
    ...extra,
  };
}

function finishActivity(
  act: AgentActivity,
  status: AgentActivity['status'] = 'success',
  detail?: string
): AgentActivity {
  return {
    ...act,
    status,
    detail: detail ?? act.detail,
    durationMs: Date.now() - act.timestamp,
  };
}

// ============================================================
// Endpoint resolution
// ============================================================

function resolveEndpoint(settings: BrowserLLMSettings): {
  baseURL: string;
  model: string;
} {
  if (settings.provider === 'custom') {
    return {
      baseURL: (settings.baseURL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
      model: settings.model || 'gpt-3.5-turbo',
    };
  }

  const defaults = PROVIDER_DEFAULTS[settings.provider];
  return {
    baseURL: (settings.baseURL || defaults.baseURL).replace(/\/+$/, ''),
    model: settings.model || defaults.model,
  };
}

// ============================================================
// Unified streaming browser LLM call
// ============================================================

/**
 * Streaming browser-side LLM call. Works with any OpenAI-compatible API.
 * Reports progress (activities, tokens, parsed problem) via StreamCallbacks.
 */
export async function streamBrowserLLM(
  messages: AgentMessage[],
  settings: BrowserLLMSettings,
  mode: 'chat' | 'practice' | 'plan' | 'review',
  learnerState: LearnerState,
  callbacks: StreamCallbacks,
  context?: ChatContext
): Promise<ChatResponse> {
  const { baseURL, model } = resolveEndpoint(settings);
  const activities: AgentActivity[] = [];
  const emit = (a: AgentActivity) => {
    activities.push(a);
    callbacks.onActivity?.(a);
  };
  const finish = (a: AgentActivity, status: AgentActivity['status'] = 'success', detail?: string) => {
    const done = finishActivity(a, status, detail);
    // Replace last matching activity in array
    const idx = activities.findIndex((x) => x.id === a.id);
    if (idx >= 0) activities[idx] = done;
    callbacks.onActivity?.(done);
    return done;
  };

  // --- Determine which sub-agent will respond ---
  let agentRole: AgentRole = 'lecturer';
  let agentName = '讲师';
  let skillName = 'socratic-teaching';
  if (mode === 'practice') {
    agentRole = 'problem_setter';
    agentName = '出题官';
    skillName = 'problem-generation';
  } else if (mode === 'plan') {
    agentRole = 'path_planner';
    agentName = '规划师';
    skillName = 'learning-path';
  } else if (mode === 'review') {
    agentRole = 'examiner';
    agentName = '考官';
    skillName = 'code-assessment';
  }

  // Step 1: Orchestrator dispatches
  const orchestratorStart = newActivity('orchestrator', 'agent_start', '总控分析用户意图');
  emit(orchestratorStart);

  const modeDesc: Record<string, string> = {
    chat: '答疑模式',
    practice: '练习模式',
    plan: '规划模式',
    review: '代码审查模式',
  };
  await sleep(120); // small delay so the UI can show the step
  finish(orchestratorStart, 'success', `识别为${modeDesc[mode]}，委派给${agentName}`);

  // Step 2: Sub-agent starts
  const agentStart = newActivity(agentRole, 'agent_start', `${agentName}开始工作`);
  emit(agentStart);

  // Step 3: Load skill
  const skill = skillRegistry.getSkill(skillName);
  const skillAct = newActivity(
    agentRole,
    'skill_load',
    `加载技能：${skill?.name || skillName}`,
    { detail: skill?.description?.slice(0, 120) }
  );
  emit(skillAct);
  await sleep(80);
  finish(skillAct, 'success');

  // Step 4: Read knowledge base
  const relevantTopics = getRelevantTopics(messages, mode);
  const knowledgeAct = newActivity(
    agentRole,
    'knowledge_read',
    `读取知识库（${relevantTopics.length} 个相关知识点）`,
    { detail: relevantTopics.map((t) => t.name).join('、') || '通用知识' }
  );
  emit(knowledgeAct);
  await sleep(60);
  finish(knowledgeAct, 'success');

  // Step 5: For review mode, also run static code analysis
  let codeAnalysisResult: string | null = null;
  if (mode === 'review' && context?.codeSubmission) {
    const analyzeAct = newActivity(agentRole, 'tool_call', '调用工具：analyze_code（代码静态分析）');
    emit(analyzeAct);
    const toolResult = await toolRegistry.execute('analyze_code', { code: context.codeSubmission });
    codeAnalysisResult = toolResult.display || null;
    finish(
      analyzeAct,
      toolResult.success ? 'success' : 'warning',
      (toolResult.display || toolResult.error || '').slice(0, 200)
    );
  }

  // Step 6: For plan mode, invoke learning_path tool for structured data
  let pathToolResult: string | null = null;
  if (mode === 'plan') {
    const pathAct = newActivity(agentRole, 'tool_call', '调用工具：learning_path（生成结构化路径）');
    emit(pathAct);
    const toolResult = await toolRegistry.execute('learning_path', {
      goal: learnerState.preferences?.targetGroup || '自学',
    });
    pathToolResult = toolResult.display || null;
    finish(pathAct, toolResult.success ? 'success' : 'warning', pathToolResult?.slice(0, 200));
  }

  finish(agentStart, 'success');

  // --- Build system prompt ---
  let systemPrompt = SUB_AGENTS.lecturer.systemPrompt;
  if (mode === 'practice') {
    systemPrompt = SUB_AGENTS.problem_setter.systemPrompt + '\n\n' + PRACTICE_SCHEMA_PROMPT;
  } else if (mode === 'plan') {
    systemPrompt = SUB_AGENTS.path_planner.systemPrompt;
    if (pathToolResult) {
      systemPrompt += '\n\n## 预计算的学习路径参考\n' + pathToolResult;
    }
  } else if (mode === 'review') {
    systemPrompt = SUB_AGENTS.examiner.systemPrompt;
    if (codeAnalysisResult) {
      systemPrompt += '\n\n## 静态代码分析结果\n' + codeAnalysisResult;
    }
  }

  const learnerContext = buildLearnerContext(learnerState, mode, context);
  const fullSystem = systemPrompt + '\n\n' + learnerContext;

  const apiMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: fullSystem },
    ...messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  // --- Thinking indicator ---
  const thinkAct = newActivity(agentRole, 'thinking', `${agentName}正在思考…`);
  emit(thinkAct);

  // --- Call LLM with streaming ---
  const { content, usedFallback } = await callLLMStreaming(
    baseURL,
    model,
    settings.apiKey,
    apiMessages,
    mode,
    callbacks
  );

  finish(thinkAct, 'success', usedFallback ? '（使用非流式模式）' : undefined);

  // --- Post-processing ---
  let finalContent = content;
  let problem: AlgorithmProblem | undefined;

  if (mode === 'practice') {
    const rawProblem = extractProblem(content);
    if (rawProblem) {
      const normalized = normalizeProblem(rawProblem);

      // Step 7: Validate problem using validate_problem tool
      const valAct = newActivity(agentRole, 'validate', '验证题目结构与质量');
      emit(valAct);

      const issues = validateProblemStructure(normalized);
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const quickOk = quickValidate(normalized);

      const valDetail = [
        quickOk ? '结构验证通过' : '结构验证失败',
        errors.length ? `错误 ${errors.length} 项` : '',
        warnings.length ? `警告 ${warnings.length} 项` : '',
      ]
        .filter(Boolean)
        .join('，');

      if (quickOk) {
        finish(valAct, warnings.length ? 'warning' : 'success', valDetail);
        problem = normalized;
        callbacks.onProblem?.(normalized);
        finalContent = `好的，我为你准备了一道 **${normalized.topicId}** 练习题：\n\n### ${normalized.title}\n\n${normalized.description}\n\n**难度**：${'⭐'.repeat(normalized.difficulty)}\n\n**示例**：\n${formatExamples(normalized.examples)}\n\n**约束**：\n${(normalized.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！输入 "/submit" 或点击运行后我会帮你评估。`;
      } else {
        finish(valAct, 'error', valDetail + '，降级到本地题库');
        // Fall back to local problem
        const localProblem = getRandomProblem();
        problem = localProblem;
        callbacks.onProblem?.(localProblem);
        finalContent = `我尝试为你生成一道题目，但生成的题目未通过质量验证（${errors.map(e => e.message).join('；')}）。我从本地题库为你挑选了一道题目：\n\n### ${localProblem.title}\n\n${localProblem.description}\n\n**难度**：${'⭐'.repeat(localProblem.difficulty)}\n\n**知识点**：${localProblem.topicId}\n\n**示例**：\n${formatExamples(localProblem.examples)}\n\n**约束**：\n${(localProblem.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！`;
      }
    } else {
      const valAct = newActivity(agentRole, 'validate', '解析题目 JSON 失败', {
        status: 'error',
      });
      emit(valAct);
      finish(valAct, 'error', '返回内容中未找到有效 JSON，降级到本地题库');
      const localProblem = getRandomProblem();
      problem = localProblem;
      callbacks.onProblem?.(localProblem);
      finalContent = `我尝试生成练习题，但返回格式不太对。我从本地题库为你挑选了一道题目：\n\n### ${localProblem.title}\n\n${localProblem.description}\n\n**难度**：${'⭐'.repeat(localProblem.difficulty)}\n\n快在右侧练习台编写你的 Python 代码吧！`;
    }
  }

  // Agent end
  const agentEnd = newActivity(agentRole, 'agent_end', `${agentName}完成回答`);
  emit(agentEnd);
  finish(agentEnd, 'success');

  // Build legacy trail for backward compatibility
  const agentTrail = buildLegacyTrail(activities, agentRole, mode);

  return {
    content: finalContent,
    agentTrail,
    activities,
    problem,
  };
}

/**
 * Non-streaming wrapper for backward compatibility.
 */
export async function callBrowserLLM(
  messages: AgentMessage[],
  settings: BrowserLLMSettings,
  mode: 'chat' | 'practice' | 'plan' | 'review',
  learnerState: LearnerState,
  context?: ChatContext
): Promise<ChatResponse> {
  // Collect streaming updates into buffers, then resolve.
  let content = '';
  const activities: AgentActivity[] = [];
  let problem: AlgorithmProblem | undefined;

  return streamBrowserLLM(
    messages,
    settings,
    mode,
    learnerState,
    {
      onToken: (delta) => { content += delta; },
      onActivity: (a) => {
        const idx = activities.findIndex((x) => x.id === a.id);
        if (idx >= 0) activities[idx] = a;
        else activities.push(a);
      },
      onProblem: (p) => { problem = p; },
    },
    context
  ).then((resp) => ({ ...resp, problem: problem ?? resp.problem }));
}

// ============================================================
// Backward-compatible wrapper
// ============================================================
export async function callVolcengineBrowser(
  messages: AgentMessage[],
  apiKey: string,
  model: string,
  mode: 'chat' | 'practice' | 'plan' | 'review',
  learnerState: LearnerState,
  context?: ChatContext
): Promise<ChatResponse> {
  return callBrowserLLM(
    messages,
    { provider: 'volcengine', apiKey, model },
    mode,
    learnerState,
    context
  );
}

// ============================================================
// LLM streaming call
// ============================================================

async function callLLMStreaming(
  baseURL: string,
  model: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  mode: string,
  callbacks: StreamCallbacks
): Promise<{ content: string; usedFallback: boolean }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
    stream: true,
  };
  if (mode === 'plan') {
    body.max_tokens = 1500;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  const MAX_RETRIES = 3;
  let res: Response | null = null;
  let lastError = '';
  let usedFallback = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) break;

      const detail = await res.text().catch(() => '');
      lastError = detail.slice(0, 300);

      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        clearTimeout(timeoutId);
        const waitMs = Math.min(2000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      clearTimeout(timeoutId);
      throw new Error(`API 返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt < MAX_RETRIES && err instanceof Error && err.name === 'AbortError') {
        continue;
      }
      lastError = err instanceof Error ? err.message : String(err);
      res = null;
      break;
    }
  }

  clearTimeout(timeoutId);

  if (!res || !res.ok) {
    // Fall back to non-streaming call (some providers don't support streaming well)
    usedFallback = true;
    return {
      content: await callLLMNonStreaming(baseURL, model, apiKey, messages, mode),
      usedFallback: true,
    };
  }

  // Parse SSE stream
  const reader = res.body?.getReader();
  if (!reader) {
    return { content: await callLLMNonStreaming(baseURL, model, apiKey, messages, mode), usedFallback: true };
  }

  let fullContent = '';
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            callbacks.onToken?.(delta);
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  } catch (err) {
    // Stream interrupted — use whatever we got so far, or fall back
    if (!fullContent) {
      return { content: await callLLMNonStreaming(baseURL, model, apiKey, messages, mode), usedFallback: true };
    }
  }

  return { content: fullContent, usedFallback };
}

async function callLLMNonStreaming(
  baseURL: string,
  model: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  mode: string
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
  };
  if (mode === 'plan') body.max_tokens = 1500;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timeoutId);
    if (mode === 'practice') {
      // Fall back to local problem bank silently — content will be replaced by caller
      return 'FALLBACK_LOCAL_PROBLEM';
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Context & helpers
// ============================================================

function getRelevantTopics(messages: AgentMessage[], mode: string) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = (lastUser?.content || '').toLowerCase();

  if (mode === 'plan') {
    return KNOWLEDGE_TOPICS.slice(0, 8);
  }

  const scored = KNOWLEDGE_TOPICS.map((t) => {
    let score = 0;
    if (text.includes(t.id)) score += 10;
    if (text.includes(t.name.toLowerCase())) score += 8;
    for (const kp of t.keyPoints) {
      if (kp.length >= 2 && text.includes(kp.toLowerCase().slice(0, Math.min(8, kp.length)))) {
        score += 2;
      }
    }
    if (text.includes(t.category.toLowerCase())) score += 3;
    return { topic: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.topic);
}

function buildLearnerContext(
  learnerState: LearnerState,
  mode: string,
  context?: ChatContext
): string {
  const parts: string[] = [];

  parts.push('## 学生当前学习状态');
  parts.push(`- 目标人群：${learnerState.preferences?.targetGroup || '自学者'}`);
  parts.push(`- 提示级别：${learnerState.preferences?.hintLevel || 2}/5`);
  parts.push(
    `- 已掌握知识点：${Object.entries(learnerState.mastery || {})
      .filter(([, v]) => v.mastery > 0.6)
      .map(([k]) => k)
      .join(', ') || '暂无'}`
  );
  parts.push(
    `- 薄弱知识点：${Object.entries(learnerState.mastery || {})
      .filter(([, v]) => v.mastery <= 0.6)
      .map(([k]) => k)
      .join(', ') || '暂无'}`
  );

  if (context?.currentProblem) {
    parts.push('\n## 当前题目');
    parts.push(`- 标题：${context.currentProblem.title}`);
    parts.push(`- 描述：${context.currentProblem.description}`);
  }

  if (context?.codeSubmission) {
    parts.push('\n## 学生提交的代码');
    parts.push('```python\n' + context.codeSubmission + '\n```');
  }

  if (context?.executionResult) {
    parts.push('\n## 代码执行结果');
    parts.push(`- 通过：${context.executionResult.passed}`);
    parts.push(`- 失败：${context.executionResult.failed}`);
    if (context.executionResult.details) {
      parts.push(`- 详情：${context.executionResult.details}`);
    }
  }

  if (mode !== 'plan') {
    parts.push('\n## 可用技能');
    parts.push(skillRegistry.getSkillContent('socratic-teaching') || '');
  }

  if (mode === 'plan') {
    parts.push('\n## 知识依赖图');
    parts.push(
      KNOWLEDGE_TOPICS.map(
        (t) =>
          `- ${t.name}(${t.id}) [难度${t.difficulty}星] [顺序${t.learningOrder}]：前置 ${t.prerequisites.join(', ') || '无'}`
      ).join('\n')
    );
  } else {
    parts.push('\n## 知识库参考');
    parts.push(KNOWLEDGE_TOPICS.map((t) => `- ${t.name}(${t.id})：${t.description}`).join('\n'));
  }

  return parts.join('\n');
}

function buildLegacyTrail(
  activities: AgentActivity[],
  primaryAgent: AgentRole,
  mode: string
): { agent: AgentRole; action: string; timestamp: number }[] {
  const seen = new Set<AgentRole>();
  const trail: { agent: AgentRole; action: string; timestamp: number }[] = [];
  for (const a of activities) {
    if (a.type === 'agent_start' && !seen.has(a.agent)) {
      seen.add(a.agent);
      trail.push({ agent: a.agent, action: a.label, timestamp: a.timestamp });
    }
  }
  if (trail.length === 0) {
    const actionMap: Record<string, string> = {
      chat: '回答学生问题',
      practice: '生成练习题',
      plan: '生成学习路径',
      review: '评估代码',
    };
    trail.push({ agent: primaryAgent, action: actionMap[mode] || '处理请求', timestamp: Date.now() });
  }
  return trail;
}

// ============================================================
// Problem parsing & normalization
// ============================================================

function extractProblem(content: string): Record<string, unknown> | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch { /* fall through */ }
  }
  const rawMatch = content.match(/\{[\s\S]*\}/);
  if (rawMatch) {
    try { return JSON.parse(rawMatch[0]); } catch { return null; }
  }
  return null;
}

function normalizeDifficulty(value: unknown): number {
  if (typeof value === 'number') return Math.max(1, Math.min(5, Math.round(value)));
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower.includes('简单') || lower.includes('入门') || lower === 'easy') return 1;
    if (lower.includes('中等') || lower === 'medium') return 3;
    if (lower.includes('困难') || lower.includes('难') || lower === 'hard') return 5;
    const num = parseInt(lower, 10);
    if (!isNaN(num)) return Math.max(1, Math.min(5, num));
  }
  return 2;
}

function normalizeExamples(examples: unknown): Array<{ input: string; output: string; explanation?: string }> {
  if (!Array.isArray(examples)) return [];
  return examples
    .map((ex: Record<string, unknown>) => ({
      input: String(ex.input ?? ex.stdin ?? ''),
      output: String(ex.output ?? ex.stdout ?? ''),
      explanation: ex.explanation ? String(ex.explanation) : undefined,
    }))
    .filter((ex) => ex.input !== '' || ex.output !== '');
}

function normalizeTestCases(testCases: unknown): Array<{ input: string; expectedOutput: string }> {
  if (!Array.isArray(testCases)) return [];
  return testCases
    .map((tc: Record<string, unknown>) => ({
      input: String(tc.input ?? tc.stdin ?? ''),
      expectedOutput: String(tc.expectedOutput ?? tc.output ?? tc.stdout ?? ''),
    }))
    .filter((tc) => tc.input !== '' || tc.expectedOutput !== '');
}

function inferTopicId(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  const topics = KNOWLEDGE_TOPICS;
  for (const t of topics) {
    if (text.includes(t.id.toLowerCase()) || text.includes(t.name.toLowerCase())) return t.id;
  }
  if (text.includes('recursion') || text.includes('递归')) return 'recursion';
  if (text.includes('sort')) return 'sorting';
  if (text.includes('tree')) return 'binary-tree';
  if (text.includes('graph')) return 'graph-basics';
  if (text.includes('dp') || text.includes('dynamic')) return 'dynamic-programming';
  if (text.includes('greedy')) return 'greedy';
  if (text.includes('queue') || text.includes('stack')) return 'linear-structures';
  if (text.includes('binary search')) return 'binary-search';
  if (text.includes('two pointers') || text.includes('sliding window')) return 'two-pointers';
  return topics[0]?.id || 'recursion';
}

function normalizeProblem(raw: Record<string, unknown>): AlgorithmProblem {
  const title = String(raw.title || raw.problem_title || '未命名题目');
  const description = String(
    raw.description || raw.problem_description || raw.problemDescription || raw.statement || ''
  );
  const topicId = String(raw.topicId || raw.topic_id || raw.topic || inferTopicId(title, description));
  const difficulty = normalizeDifficulty(raw.difficulty) as 1 | 2 | 3 | 4 | 5;
  const examples = normalizeExamples(raw.examples || raw.samples || raw.sample_cases || raw.io_examples);
  const testCases = normalizeTestCases(raw.testCases || raw.test_cases || raw.testcases || raw.samples || raw.cases);

  let starterCode = String(raw.starterCode || raw.starter_code || raw.template || raw.code_template || '');
  if (!starterCode.trim()) {
    starterCode = `def solution(s):\n    # 请在这里实现你的解法\n    pass\n`;
  }

  const solution = String(raw.solution || raw.reference_solution || raw.answer || '');
  const constraints = Array.isArray(raw.constraints) ? raw.constraints.map((c) => String(c)) : [];
  const hints = Array.isArray(raw.hints) ? raw.hints.map((h) => String(h)) : [];

  return {
    id: String(raw.id || raw.problem_id || `problem-${Date.now()}`),
    title,
    topicId,
    difficulty,
    description,
    examples: examples.length ? examples : [{ input: '', output: '' }],
    constraints: constraints.length ? constraints : ['请根据题目要求实现'],
    starterCode,
    hints: hints.length ? hints : ['仔细阅读题目', '思考输入输出', '尝试用示例验证'],
    solution,
    timeComplexity: String(raw.timeComplexity || raw.time_complexity || 'O(?)'),
    spaceComplexity: String(raw.spaceComplexity || raw.space_complexity || 'O(?)'),
    testCases: testCases.length ? testCases : examples.map((ex) => ({ input: ex.input, expectedOutput: ex.output })),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)) : [],
  };
}

function formatExamples(examples: Array<{ input: string; output: string; explanation?: string }>) {
  if (!Array.isArray(examples)) return '';
  return examples
    .map(
      (ex, i) =>
        `**示例 ${i + 1}**\n- 输入：${ex.input}\n- 输出：${ex.output}${ex.explanation ? `\n- 解释：${ex.explanation}` : ''}`
    )
    .join('\n\n');
}
