'use client';

import { AgentMessage, AlgorithmProblem, ChatResponse, LearnerState } from '@/types';
import {
  LLMProvider,
  PROVIDER_DEFAULTS,
  VOLCENGINE_BASE_URL,
  VOLCENGINE_DEFAULT_MODEL,
} from './client';
import { SUB_AGENTS } from '@/lib/agents/definitions';
import { skillRegistry } from '@/lib/skills/registry';
import { KNOWLEDGE_TOPICS } from '@/lib/knowledge/topics';

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

/**
 * Resolve the API endpoint and model for a given provider configuration.
 * All providers use the OpenAI-compatible /chat/completions format.
 */
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

/**
 * Unified browser-side LLM call. Works with any OpenAI-compatible API:
 * Volcengine Ark, OpenAI, DeepSeek, Moonshot, local Ollama, etc.
 *
 * Anthropic uses a different request format, but for browser-side calls
 * we route through the OpenAI-compatible endpoint when available, or
 * fall back to the /api/chat server route.
 */
export async function callBrowserLLM(
  messages: AgentMessage[],
  settings: BrowserLLMSettings,
  mode: 'chat' | 'practice' | 'plan' | 'review',
  learnerState: LearnerState,
  context?: ChatContext
): Promise<ChatResponse> {
  const { baseURL, model } = resolveEndpoint(settings);

  // Select system prompt based on mode
  let systemPrompt = SUB_AGENTS.lecturer.systemPrompt;
  if (mode === 'practice') {
    systemPrompt = SUB_AGENTS.problem_setter.systemPrompt + '\n\n' + PRACTICE_SCHEMA_PROMPT;
  } else if (mode === 'plan') {
    systemPrompt = SUB_AGENTS.path_planner.systemPrompt;
  } else if (mode === 'review') {
    systemPrompt = SUB_AGENTS.examiner.systemPrompt;
  }

  const learnerContext = buildLearnerContext(learnerState, mode, context);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt + '\n\n' + learnerContext },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ],
    temperature: 0.7,
  };

  if (mode === 'plan') {
    body.max_tokens = 1500;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `API 返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`
    );
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  // For practice mode, try to parse problem JSON from response
  if (mode === 'practice') {
    const rawProblem = extractProblem(content);
    if (rawProblem) {
      const problem = normalizeProblem(rawProblem);
      return {
        content: `好的，我为你准备了一道 **${problem.topicId}** 练习题：\n\n### ${problem.title}\n\n${problem.description}\n\n**难度**：${'⭐'.repeat(problem.difficulty)}\n\n**示例**：\n${formatExamples(problem.examples)}\n\n**约束**：\n${(problem.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！输入 "/submit" 或点击运行后我会帮你评估。`,
        agentTrail: [
          { agent: 'problem_setter', action: '生成练习题', timestamp: Date.now() },
        ],
        problem,
      };
    }
    return {
      content: `我尝试生成练习题，但返回格式不太对。你可以再试一次，或查看下方内容：\n\n${content}`,
      agentTrail: [{ agent: 'problem_setter', action: '生成练习题失败', timestamp: Date.now() }],
    };
  }

  return {
    content,
    agentTrail: [
      {
        agent: mode === 'plan' ? 'path_planner' : mode === 'review' ? 'examiner' : 'lecturer',
        action: mode === 'plan' ? '生成学习路径' : mode === 'review' ? '评估代码' : '回答学生问题',
        timestamp: Date.now(),
      },
    ],
  };
}

// ============================================================
// Backward-compatible wrapper for existing code that calls
// callVolcengineBrowser. Delegates to callBrowserLLM.
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
    parts.push(
      KNOWLEDGE_TOPICS.map((t) => `- ${t.name}(${t.id})：${t.description}`).join('\n')
    );
  }

  return parts.join('\n');
}

function extractProblem(content: string): Record<string, unknown> | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // fall through
    }
  }
  const rawMatch = content.match(/\{[\s\S]*\}/);
  if (rawMatch) {
    try {
      return JSON.parse(rawMatch[0]);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeDifficulty(value: unknown): number {
  if (typeof value === 'number') {
    return Math.max(1, Math.min(5, Math.round(value)));
  }
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
    if (text.includes(t.id.toLowerCase()) || text.includes(t.name.toLowerCase())) {
      return t.id;
    }
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
  const topicId = String(
    raw.topicId || raw.topic_id || raw.topic || inferTopicId(title, description)
  );
  const difficulty = normalizeDifficulty(raw.difficulty) as 1 | 2 | 3 | 4 | 5;

  const examples = normalizeExamples(raw.examples || raw.samples || raw.sample_cases || raw.io_examples);
  const testCases = normalizeTestCases(raw.testCases || raw.test_cases || raw.testcases || raw.samples || raw.cases);

  let starterCode = String(
    raw.starterCode || raw.starter_code || raw.template || raw.code_template || ''
  );
  if (!starterCode.trim()) {
    starterCode = `def solution(s):\n    # 请在这里实现你的解法\n    pass\n`;
  }

  const solution = String(raw.solution || raw.reference_solution || raw.answer || '');
  const constraints = Array.isArray(raw.constraints)
    ? raw.constraints.map((c) => String(c))
    : [];
  const hints = Array.isArray(raw.hints)
    ? raw.hints.map((h) => String(h))
    : [];

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
    testCases: testCases.length
      ? testCases
      : examples.map((ex) => ({ input: ex.input, expectedOutput: ex.output })),
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
