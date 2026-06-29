'use client';

import {
  AgentMessage,
  AlgorithmProblem,
  ChatResponse,
  LearnerState,
  StreamCallbacks,
  AgentActivity,
  AgentRole,
  AgentParadigm,
  AgentStep,
  OrchestratorPlan,
} from '@/types';
import {
  LLMProvider,
  PROVIDER_DEFAULTS,
} from './client';
import { SUB_AGENTS } from '@/lib/agents/definitions';
import { skillRegistry } from '@/lib/skills/registry';
import { KNOWLEDGE_TOPICS } from '@/lib/knowledge/topics';
import { getRandomProblem } from '@/lib/knowledge/problems';
import { quickValidate } from '@/lib/problem-validator';
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

const AGENT_PARADIGM: Record<AgentRole, string> = {
  orchestrator: 'Plan-and-Execute',
  lecturer: 'ReAct+CoT',
  problem_setter: 'Plan-and-Execute+Reflexion',
  examiner: 'Reflexion',
  path_planner: 'Plan-and-Execute',
};

const AGENT_NAMES: Record<AgentRole, string> = {
  orchestrator: '总控',
  lecturer: '讲师',
  problem_setter: '出题官',
  examiner: '考官',
  path_planner: '规划师',
};

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
// ReAct Engine — LLM-driven tool calling loop
// ------------------------------------------------------------
// The LLM acts as the "brain": it decides which tools to call,
// when to call them, and how to use the results. The code only
// provides the tool catalogue and executes the actions the LLM
// chooses. This is true ReAct (Reasoning + Acting).
// ============================================================

/** CamelCase aliases → snake_case tool names in the registry */
const TOOL_ALIASES: Record<string, string> = {
  SearchKnowledge: 'search_knowledge',
  SearchProblems: 'search_problems',
  WebSearch: 'web_search',
  ValidateProblem: 'validate_problem',
  AnalyzeCode: 'analyze_code',
  LearningPath: 'learning_path',
  Finish: '__finish__',
};

/** Tools available to each agent role */
const AGENT_TOOLS: Record<AgentRole, string[]> = {
  orchestrator: ['search_knowledge', 'search_problems', 'web_search'],
  lecturer: ['search_knowledge', 'web_search'],
  problem_setter: ['search_knowledge', 'search_problems', 'web_search', 'validate_problem'],
  examiner: ['analyze_code', 'search_knowledge'],
  path_planner: ['search_knowledge', 'learning_path'],
};

/** Mode → agent role mapping for tool selection */
const MODE_TOOLS: Record<string, string[]> = {
  chat: AGENT_TOOLS.lecturer,
  practice: AGENT_TOOLS.problem_setter,
  review: AGENT_TOOLS.examiner,
  plan: AGENT_TOOLS.path_planner,
};

/**
 * Build the tool declaration text that gets appended to the system prompt.
 * This tells the LLM what tools it can use and the response format.
 */
function buildToolDeclaration(toolNames: string[], mode: string): string {
  const tools = toolNames
    .map((name) => toolRegistry.get(name))
    .filter(Boolean) as { name: string; label: string; description: string; parameters: { name: string; description: string; required?: boolean }[] }[];

  // Build human-readable tool list with camelCase aliases
  const aliasMap: Record<string, string> = {};
  for (const [camel, snake] of Object.entries(TOOL_ALIASES)) {
    if (snake !== '__finish__') aliasMap[snake] = camel;
  }

  const toolLines = tools.map((t) => {
    const alias = aliasMap[t.name] || t.name;
    const params = t.parameters
      .filter((p) => p.required)
      .map((p) => p.name)
      .join(', ');
    return `- **${alias}**[${params}]: ${t.description}`;
  });

  let extra = '';
  if (mode === 'practice') {
    extra = '\n- 出题时，先用 SearchKnowledge 或 SearchProblems 查找相关知识点和已有题目作为参考\n- 生成题目后，务必用 ValidateProblem 验证题目质量，如果验证失败请根据反馈修改后重新验证\n- Finish 的内容应包含用 ```json 代码块包裹的完整题目 JSON';
  } else if (mode === 'review') {
    extra = '\n- 审查代码时，先用 AnalyzeCode 分析代码复杂度和潜在问题\n- 结合分析结果给出详细的评估意见';
  } else if (mode === 'plan') {
    extra = '\n- 规划学习路径时，先用 LearningPath 获取参考路径，再根据学生情况调整';
  }

  return `\n\n## 可用工具与 ReAct 工作模式

你是一个自主的 AI Agent，可以主动调用工具来获取信息、验证结果。请按以下格式工作：

### 工具列表
${toolLines.join('\n')}
${extra}

### 回复格式（严格遵守）
每次回复必须包含两部分：

Thought: 你的思考过程（分析当前情况，决定下一步做什么）
Action: 工具名[参数]

示例：
Thought: 我需要先查找动态规划的相关知识来准确讲解
Action: SearchKnowledge[动态规划]

### 结束条件
当你收集了足够的信息，准备给出最终回答时：

Thought: 我已经获得了足够的信息，可以给出回答了
Action: Finish[你的最终回答内容]

### 重要规则
1. 每次只调用一个工具
2. 工具参数直接写在方括号内，不要加引号（除非参数本身包含引号）
3. Finish 的内容就是你给用户的最终回答
4. 最多使用 8 次工具调用，之后必须 Finish
5. 如果不需要工具就能回答，可以直接 Finish`;
}

interface ParsedAction {
  thought: string;
  toolName: string;   // resolved snake_case name, or '__finish__'
  rawAction: string;  // the camelCase alias as written by LLM
  args: string;       // raw argument string
  isFinish: boolean;
}

/**
 * Parse a ReAct-format LLM response into Thought + Action.
 * Falls back gracefully: if no Action is found, treats the entire
 * response as a Finish (final answer).
 */
function parseReActResponse(text: string): ParsedAction {
  // Extract Thought (everything between "Thought:" and "Action:" or end)
  const thoughtMatch = text.match(/Thought:\s*([\s\S]*?)(?=\n\s*Action:|$)/i);
  const thought = thoughtMatch?.[1]?.trim() || '';

  // Extract Action: ToolName[args]
  // Match patterns like: Action: SearchKnowledge[动态规划]
  // or: Action: Finish[最终回答内容]
  const actionMatch = text.match(/Action:\s*(\w+)\[([\s\S]*?)\]\s*$/i);

  if (actionMatch) {
    const rawAction = actionMatch[1];
    const args = actionMatch[2].trim();
    const resolved = TOOL_ALIASES[rawAction] || rawAction.toLowerCase();
    return {
      thought,
      toolName: resolved,
      rawAction,
      args,
      isFinish: resolved === '__finish__',
    };
  }

  // No Action found — treat entire text as a final answer
  return {
    thought: '',
    toolName: '__finish__',
    rawAction: 'Finish',
    args: text,
    isFinish: true,
  };
}

/**
 * Execute a single tool call and return the observation text.
 */
async function executeToolForReAct(
  toolName: string,
  args: string,
  context?: ChatContext
): Promise<{ observation: string; success: boolean }> {
  // Handle special tools that need context
  if (toolName === 'analyze_code' && context?.codeSubmission) {
    const result = await toolRegistry.execute('analyze_code', { code: context.codeSubmission });
    return {
      observation: result.display || result.error || '分析完成',
      success: result.success,
    };
  }

  if (toolName === 'learning_path') {
    // Parse goal from LLM-provided args (e.g., "面试" or "goal: 竞赛")
    let goal = '入门';
    const trimmedArgs = args.trim();
    if (trimmedArgs) {
      // Try to extract goal from common patterns: "面试", "goal: 面试", "目标:竞赛"
      const goalMatch = trimmedArgs.match(/(?:goal|目标)\s*[:：]\s*(.+)/i);
      if (goalMatch) {
        goal = goalMatch[1].trim();
      } else {
        // Use the entire arg as goal if it looks like a goal keyword
        const lower = trimmedArgs.toLowerCase();
        if (lower.includes('面试') || lower.includes('interview') ||
            lower.includes('竞赛') || lower.includes('competition') || lower.includes('oi') ||
            lower.includes('入门') || lower.includes('自学') || lower.includes('beginner') ||
            lower.includes('课程') || lower.includes('course') || lower.includes('student')) {
          goal = trimmedArgs;
        }
      }
    }
    const result = await toolRegistry.execute('learning_path', { goal });
    return {
      observation: result.display || result.error || '路径生成完成',
      success: result.success,
    };
  }

  // Generic tool execution: parse args based on tool parameters
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    return {
      observation: `错误：未知工具 "${toolName}"。可用工具：${Object.keys(TOOL_ALIASES).filter(k => k !== 'Finish').join(', ')}`,
      success: false,
    };
  }

  // Build args object from the raw string
  const toolArgs: Record<string, unknown> = {};
  const params = tool.parameters;
  if (params.length > 0) {
    // The first required param gets the raw args string
    const firstRequired = params.find((p) => p.required) || params[0];
    if (firstRequired) {
      toolArgs[firstRequired.name] = args;
    }
  }

  const result = await toolRegistry.execute(toolName, toolArgs);
  return {
    observation: result.display || result.error || '工具执行完成（无输出）',
    success: result.success,
  };
}

/**
 * Make a single non-streaming LLM call and capture reasoning_content.
 * Used by the ReAct loop for each iteration.
 */
async function callLLMStep(
  baseURL: string,
  model: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  agentRole: AgentRole,
  callbacks: StreamCallbacks
): Promise<{ content: string; reasoning: string }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
    stream: false,
  };

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message || {};
    const content = (message.content as string) || '';
    const reasoning = (message.reasoning_content as string) || '';

    // Note: reasoning is captured but not emitted here — the ReAct loop
    // emits it as part of the react_thought activity to avoid duplicate entries.
    return { content, reasoning };
  } catch (err) {
    // Fallback: try streaming call
    const { content } = await callLLMStreaming(
      baseURL, model, apiKey, messages, 'chat', callbacks, agentRole
    );
    return { content, reasoning: '' };
  }
}

/**
 * The core ReAct loop. The LLM drives tool calling autonomously.
 *
 * Flow:
 * 1. Call LLM with system prompt (includes tool catalogue) + conversation
 * 2. Parse response for Thought + Action
 * 3. If Finish → stream final content to user, return
 * 4. If tool call → execute tool, add Observation to messages, loop
 * 5. Max turns safety: force Finish after N iterations
 */
async function runReActLoop(
  baseURL: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  agentRole: AgentRole,
  mode: string,
  callbacks: StreamCallbacks,
  emit: (a: AgentActivity) => void,
  finish: (a: AgentActivity, status?: AgentActivity['status'], detail?: string) => AgentActivity,
  context?: ChatContext,
  maxTurns: number = 8
): Promise<{ content: string; usedFallback: boolean }> {
  const agentName = AGENT_NAMES[agentRole];
  const availableTools = MODE_TOOLS[mode] || AGENT_TOOLS[agentRole];

  // Build the full system prompt with tool declarations
  const reactSystemPrompt = systemPrompt + buildToolDeclaration(availableTools, mode);

  // ReAct conversation: starts with system + original messages
  const reactMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: reactSystemPrompt },
    ...messages,
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const turnNum = turn + 1;

    // --- Call LLM ---
    const llmCallAct = newActivity(
      agentRole,
      'react_thought',
      `${agentName} · 第 ${turnNum} 轮推理中…`,
      {
        paradigm: AGENT_PARADIGM[agentRole] as AgentParadigm,
        reactTurn: turnNum,
      }
    );
    emit(llmCallAct);

    const { content, reasoning } = await callLLMStep(
      baseURL, model, apiKey, reactMessages, agentRole, callbacks
    );

    // --- Parse the response ---
    const parsed = parseReActResponse(content);

    // Emit Thought content
    const thoughtContent = reasoning || parsed.thought;
    if (thoughtContent) {
      finish(llmCallAct, 'success', thoughtContent.length > 600
        ? thoughtContent.slice(0, 600) + '…'
        : thoughtContent
      );
    } else {
      finish(llmCallAct, 'success', '（模型未输出推理过程）');
    }

    // --- Check if LLM wants to Finish ---
    if (parsed.isFinish) {
      // Stream the final content to the user
      callbacks.onToken?.(parsed.args);
      return { content: parsed.args, usedFallback: false };
    }

    // --- Execute the tool call ---
    const toolDisplayName = parsed.rawAction;
    const normalizedToolName = parsed.toolName; // Normalized snake_case name
    const argsPreview = parsed.args.length > 60
      ? parsed.args.slice(0, 60) + '…'
      : parsed.args;

    const toolCallAct = newActivity(
      agentRole,
      'react_action',
      `调用 ${toolDisplayName}`,
      {
        paradigm: AGENT_PARADIGM[agentRole] as AgentParadigm,
        reactTurn: turnNum,
        toolName: normalizedToolName, // Use normalized name for UI lookup
        toolArgs: argsPreview,
        detail: `参数: ${parsed.args}`,
      }
    );
    emit(toolCallAct);

    const { observation, success } = await executeToolForReAct(
      parsed.toolName, parsed.args, context
    );

    // Finish tool call with result
    const obsPreview = observation.length > 300
      ? observation.slice(0, 300) + '…'
      : observation;
    finish(
      toolCallAct,
      success ? 'success' : 'warning',
      `${toolDisplayName} 执行${success ? '成功' : '返回警告'}`
    );

    // Emit observation
    const obsAct = newActivity(
      agentRole,
      'react_observation',
      `${toolDisplayName} 返回结果（${observation.length} 字）`,
      {
        paradigm: AGENT_PARADIGM[agentRole] as AgentParadigm,
        reactTurn: turnNum,
        toolName: toolDisplayName,
        detail: obsPreview,
        status: success ? 'success' : 'warning',
      }
    );
    emit(obsAct);
    finish(obsAct, success ? 'success' : 'warning');

    // --- Add to conversation history and loop ---
    reactMessages.push({
      role: 'assistant',
      content: `Thought: ${parsed.thought}\nAction: ${parsed.rawAction}[${parsed.args}]`,
    });
    reactMessages.push({
      role: 'user',
      content: `Observation: ${observation}`,
    });
  }

  // --- Max turns exceeded: force a final Finish ---
  const forceAct = newActivity(
    agentRole,
    'thinking',
    `${agentName} · 达到最大轮次，生成最终回答…`
  );
  emit(forceAct);

  reactMessages.push({
    role: 'user',
    content: '你已经达到了最大工具调用次数。请根据目前收集到的信息，直接给出你的最终回答。使用格式：Action: Finish[你的回答]',
  });

  const { content: finalContent } = await callLLMStep(
    baseURL, model, apiKey, reactMessages, agentRole, callbacks
  );

  const finalParsed = parseReActResponse(finalContent);
  const answer = finalParsed.isFinish ? finalParsed.args : finalContent;

  finish(forceAct, 'success', '生成最终回答');
  callbacks.onToken?.(answer);
  return { content: answer, usedFallback: true };
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
    // Update-or-insert: replace if same ID exists (for status updates)
    const idx = activities.findIndex((x) => x.id === a.id);
    if (idx >= 0) activities[idx] = a;
    else activities.push(a);
    callbacks.onActivity?.(a);
  };
  const finish = (a: AgentActivity, status: AgentActivity['status'] = 'success', detail?: string) => {
    const done = finishActivity(a, status, detail);
    const idx = activities.findIndex((x) => x.id === a.id);
    if (idx >= 0) activities[idx] = done;
    else activities.push(done);
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

  // Step 4b-6: REMOVED — tools are now LLM-driven via the ReAct loop.
  // The LLM decides when to call search_knowledge, analyze_code, learning_path,
  // validate_problem, web_search, etc. Code no longer controls tool flow.

  finish(agentStart, 'success');

  // --- Build system prompt ---
  let systemPrompt = SUB_AGENTS.lecturer.systemPrompt;
  if (mode === 'practice') {
    systemPrompt = SUB_AGENTS.problem_setter.systemPrompt + '\n\n' + PRACTICE_SCHEMA_PROMPT;
  } else if (mode === 'plan') {
    systemPrompt = SUB_AGENTS.path_planner.systemPrompt;
  } else if (mode === 'review') {
    systemPrompt = SUB_AGENTS.examiner.systemPrompt;
    // Include the code submission in the system prompt for review mode
    if (context?.codeSubmission) {
      systemPrompt += '\n\n## 待审查的代码\n```python\n' + context.codeSubmission + '\n```';
    }
  }

  const learnerContext = buildLearnerContext(learnerState, mode, context);
  const fullSystem = systemPrompt + '\n\n' + learnerContext;

  const apiMessages: Array<{ role: string; content: string }> = [
    ...messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  // --- Emit paradigm-specific entry activities ---
  if (mode === 'practice') {
    // PE+R 范式: 规划题目参数
    const planAct = newActivity(
      agentRole,
      'pe_plan',
      '规划题目参数',
      {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
        peIteration: 0,
        detail: '根据学习者水平和知识点，规划题目的难度、类型、约束条件',
      }
    );
    emit(planAct);
    await sleep(40);
    finish(planAct, 'success');
    // PE+R 范式: 生成题目
    const genAct = newActivity(
      agentRole,
      'pe_generate',
      '生成题目中…',
      {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
        peIteration: 0,
        status: 'running',
      }
    );
    emit(genAct);
    // We'll finish genAct after ReAct loop completes
    (genAct as any)._deferredFinish = true;
    (apiMessages as any)._genAct = genAct;
  } else if (mode === 'plan') {
    // Plan-and-Execute 范式: 评估学习者现状
    const assessAct = newActivity(
      agentRole,
      'plan_assess',
      '评估学习者现状',
      {
        paradigm: 'Plan-and-Execute' as AgentParadigm,
        detail: '分析学习者已掌握知识点、薄弱环节、学习偏好',
        status: 'running',
      }
    );
    emit(assessAct);
    await sleep(40);
    finish(assessAct, 'success', '完成学习者画像分析，开始规划学习路径');
    // Plan-and-Execute 范式: 组织路径结构
    const structAct = newActivity(
      agentRole,
      'plan_structure',
      '组织学习路径结构…',
      {
        paradigm: 'Plan-and-Execute' as AgentParadigm,
        status: 'running',
      }
    );
    emit(structAct);
    (structAct as any)._deferredFinish = true;
    (apiMessages as any)._structAct = structAct;
  } else if (mode === 'review') {
    // Reflexion 范式: 评估代码
    const evalAct = newActivity(
      agentRole,
      'reflexion_evaluate',
      '评估提交代码…',
      {
        paradigm: 'Reflexion' as AgentParadigm,
        reflexionTurn: 1,
        status: 'running',
      }
    );
    emit(evalAct);
    (evalAct as any)._deferredFinish = true;
    (apiMessages as any)._evalAct = evalAct;
  } else if (mode === 'chat') {
    // ReAct+CoT 范式: 讲师诊断
    const diagAct = newActivity(
      agentRole,
      'cot_diagnose',
      '诊断学生问题…',
      {
        paradigm: 'ReAct+CoT' as AgentParadigm,
        cotStep: 'diagnose',
        status: 'running',
      }
    );
    emit(diagAct);
    (diagAct as any)._deferredFinish = true;
    (apiMessages as any)._diagAct = diagAct;
  }

  // --- ReAct loop: LLM drives tool calling autonomously ---
  const { content, usedFallback } = await runReActLoop(
    baseURL,
    model,
    settings.apiKey,
    fullSystem,
    apiMessages,
    agentRole,
    mode,
    callbacks,
    emit,
    finish,
    context,
  );

  // --- Post-processing ---
  let finalContent = content;
  let problem: AlgorithmProblem | undefined;

  // Finish deferred entry activities and emit follow-up paradigm activities
  const deferredGen = (apiMessages as any)._genAct as AgentActivity | undefined;
  const deferredStruct = (apiMessages as any)._structAct as AgentActivity | undefined;
  const deferredEval = (apiMessages as any)._evalAct as AgentActivity | undefined;
  const deferredDiag = (apiMessages as any)._diagAct as AgentActivity | undefined;

  if (mode === 'practice') {
    if (deferredGen) finish(deferredGen, 'success', '题目生成完成，开始验证质量');
  } else if (mode === 'plan') {
    if (deferredStruct) finish(deferredStruct, 'success', '学习路径结构组织完成');
  } else if (mode === 'review') {
    if (deferredEval) finish(deferredEval, 'success', '代码分析完成，进入反思评估');
    const critiqueAct = newActivity(
      agentRole,
      'reflexion_critique',
      '反思评估质量…',
      {
        paradigm: 'Reflexion' as AgentParadigm,
        reflexionTurn: 1,
        status: 'running',
      }
    );
    emit(critiqueAct);
    await sleep(30);
    const critiqueDetail = content.includes('问题') || content.includes('不足')
      ? '自我审查评估维度：正确性、效率、代码风格、边界处理'
      : '自我审查完成：评估维度覆盖全面';
    finish(critiqueAct, 'success', critiqueDetail);
    const scoreMatch = content.match(/(\d{1,3})\s*分/);
    const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : undefined;
    const verdictAct = newActivity(
      agentRole,
      'reflexion_verdict',
      score != null ? `判定：${score} 分` : '给出综合判定',
      {
        paradigm: 'Reflexion' as AgentParadigm,
        reflexionTurn: 1,
        score,
        detail: score != null
          ? (score >= 80 ? '代码质量良好，通过考核' : score >= 60 ? '基本正确，有待改进' : '存在较多问题，需要加强练习')
          : '综合判定已完成',
      }
    );
    emit(verdictAct);
    finish(verdictAct, 'success');
    const feedbackAct = newActivity(
      agentRole,
      'reflexion_feedback',
      '整理改进建议…',
      {
        paradigm: 'Reflexion' as AgentParadigm,
        reflexionTurn: 1,
        status: 'running',
      }
    );
    emit(feedbackAct);
    await sleep(30);
    const feedbackLines = content.split('\n').filter((l: string) => l.trim().startsWith('-') || l.trim().startsWith('*') || /^\d+\./.test(l.trim())).slice(0, 3).join('; ');
    finish(feedbackAct, 'success', feedbackLines || '反馈建议已组织完成');
  } else if (mode === 'chat') {
    if (deferredDiag) finish(deferredDiag, 'success', '诊断完成，分析了学生的知识卡点和理解水平');
    const designAct = newActivity(
      agentRole,
      'cot_design',
      '设计引导问题…',
      {
        paradigm: 'ReAct+CoT' as AgentParadigm,
        cotStep: 'design',
        status: 'running',
      }
    );
    emit(designAct);
    await sleep(30);
    finish(designAct, 'success', '采用苏格拉底式提问法，设计层层递进的引导路径');
    const presentAct = newActivity(
      agentRole,
      'cot_present',
      '组织教学呈现…',
      {
        paradigm: 'ReAct+CoT' as AgentParadigm,
        cotStep: 'present',
        status: 'running',
      }
    );
    emit(presentAct);
    await sleep(30);
    finish(presentAct, 'success', '教学内容已组织为清晰的引导式讲解');
  }

  if (mode === 'practice') {
    const rawProblem = extractProblem(content);
    if (rawProblem) {
      const normalized = normalizeProblem(rawProblem);

      if (quickValidate(normalized)) {
        // Quick validation passed - emit PE+R complete
        const quickVal = newActivity(agentRole, 'pe_validate', '快速验证题目结构', {
          paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
          peIteration: 0,
          status: 'running',
        });
        emit(quickVal); await sleep(20);
        finish(quickVal, 'success', '题目结构完整，包含标题、描述、示例和约束');
        const completeAct = newActivity(agentRole, 'pe_complete', '题目验证通过', {
          paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
          peIteration: 0,
          detail: '题目结构完整，测试用例正确，可以交付给学生',
        });
        emit(completeAct); finish(completeAct, 'success');
        problem = normalized;
        callbacks.onProblem?.(normalized);
        finalContent = `好的，我为你准备了一道 **${normalized.topicId}** 练习题：\n\n### ${normalized.title}\n\n${normalized.description}\n\n**难度**：${'⭐'.repeat(normalized.difficulty)}\n\n**示例**：\n${formatExamples(normalized.examples)}\n\n**约束**：\n${(normalized.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！输入 "/submit" 或点击运行后我会帮你评估。`;
      } else {
        // Safety-net failed; try one repair
        const { problem: validated, validationText } = await validateAndRepairProblem(
          normalized, agentRole, baseURL, model, settings.apiKey,
          emit, finish, apiMessages, fullSystem, 1
        );
        if (validated && quickValidate(validated)) {
          problem = validated;
          callbacks.onProblem?.(validated);
          finalContent = `好的，我为你准备了一道 **${validated.topicId}** 练习题：\n\n### ${validated.title}\n\n${validated.description}\n\n**难度**：${'⭐'.repeat(validated.difficulty)}\n\n**示例**：\n${formatExamples(validated.examples)}\n\n**约束**：\n${(validated.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！输入 "/submit" 或点击运行后我会帮你评估。`;
        } else {
          const localProblem = getRandomProblem();
          problem = localProblem;
          callbacks.onProblem?.(localProblem);
          finalContent = `我尝试为你生成一道题目，但未通过质量验证（${validationText}）。我从本地题库为你挑选了一道题目：\n\n### ${localProblem.title}\n\n${localProblem.description}\n\n**难度**：${'⭐'.repeat(localProblem.difficulty)}\n\n**知识点**：${localProblem.topicId}\n\n**示例**：\n${formatExamples(localProblem.examples)}\n\n**约束**：\n${(localProblem.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！`;
        }
      }
    } else {
      const valAct = newActivity(agentRole, 'tool_call', '调用工具：validate_problem（解析题目 JSON 失败）');
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

// ============================================================
// Orchestrator task decomposition via LLM
// ============================================================

const ORCHESTRATOR_DECOMPOSITION_PROMPT = `你是 CodeMentor 的总控 Agent（Orchestrator），负责分析学生的请求并将其分解为可由专业 Agent 顺序执行的任务计划。

## 可用 Agent 及其职责

1. **lecturer（讲师）**
   - 职责：讲解算法与数据结构概念、回答概念性问题、用苏格拉底式引导帮助学生理解
   - 适用场景：学生提问"什么是XXX"、"讲一下XXX"、"解释XXX"等

2. **problem_setter（出题官）**
   - 职责：生成练习题、算法题
   - 适用场景：学生要求出题、练习、做题、考考我等

3. **examiner（考官）**
   - 职责：评估代码、给出改进建议
   - 适用场景：学生提交代码、要求代码评估/审查等

4. **path_planner（规划师）**
   - 职责：制定学习计划、学习路径
   - 适用场景：学生要求学习计划、规划、路线图、怎么学等

## 你的任务

请分析学生的最新输入，完成以下工作：
1. **识别所有意图**：一句话可能包含多个意图，必须全部列出
2. **判断是否需要澄清**：如果请求存在歧义、缺少关键信息或自相矛盾，必须设置 requiresClarification=true，并给出具体的澄清问题
3. **生成执行计划**：将请求分解为按顺序执行的 AgentStep 序列

## 执行计划规则

- 每个步骤必须指定一个最合适的 Agent（lecturer / problem_setter / examiner / path_planner）
- 每个步骤必须对应一个 mode：chat（答疑）、practice（练习）、plan（规划）、review（审查）
- 如果多个意图存在依赖关系（如"先讲解再出题"），必须按依赖顺序排列
- 上游 Agent 的输出可以通过 usePrevContext=true 传递给下游 Agent
- **严格的职责边界**：
  - lecturer（讲师）只负责讲解概念、回答问题、引导思考，绝对不能出题目
  - problem_setter（出题官）只负责出题，出题时如果 usePrevContext=true，必须基于上一个 Agent 讲解的内容来出题（不能自己随便选知识点）
  - examiner（考官）只负责评估代码
  - path_planner（规划师）只负责制定学习路径
- task 描述必须具体明确，特别是后续步骤的 task 要说明"基于上一步讲解的XXX内容来YYY"
- 不要猜测用户未提供的信息

## 输出格式

必须返回严格的 JSON 格式，不要包含任何 Markdown 代码块或额外解释：

{
  "analysis": "对用户请求的分析，列出识别出的意图与潜在歧义",
  "requiresClarification": false,
  "clarificationQuestion": null,
  "intents": [
    { "intent": "chat", "confidence": 0.95, "topic": "数组" }
  ],
  "plan": [
    {
      "agent": "lecturer",
      "mode": "chat",
      "task": "请讲解数组的基本概念、特点和应用场景",
      "reason": "用户要求先讲解数组概念",
      "usePrevContext": false
    },
    {
      "agent": "problem_setter",
      "mode": "practice",
      "task": "基于数组概念出一道练习题",
      "reason": "用户要求在讲解后再出一道数组练习题",
      "usePrevContext": true
    }
  ]
}

## 示例

用户输入："先给我讲解一下数组，再出一道相关的题"
输出：
{
  "analysis": "用户有两个意图：1) 了解数组概念；2) 获得一道与数组讲解内容紧密相关的练习题。两个意图有先后依赖关系：必须先讲解，再基于讲解内容出题。",
  "requiresClarification": false,
  "clarificationQuestion": null,
  "intents": [
    { "intent": "chat", "confidence": 0.95, "topic": "数组" },
    { "intent": "practice", "confidence": 0.92, "topic": "数组" }
  ],
  "plan": [
    {
      "agent": "lecturer",
      "mode": "chat",
      "task": "请详细讲解数组的基本概念、存储结构、常见操作的时间复杂度以及核心特点。用苏格拉底式提问引导学生思考，不要直接出练习题。",
      "reason": "用户要求先讲解数组概念",
      "usePrevContext": false
    },
    {
      "agent": "problem_setter",
      "mode": "practice",
      "task": "根据上一步讲师讲解的数组概念和特点（特别是数组的插入、删除、随机访问等操作），出一道与讲解内容紧密相关的数组练习题。题目必须直接考察讲解中提到的核心知识点，不要脱离讲解内容自行选题。",
      "reason": "用户要求在讲解后再获得练习题，题目必须基于讲解内容",
      "usePrevContext": true
    }
  ]
}

用户输入："帮我规划一下怎么学算法"
输出：
{
  "analysis": "用户请求制定算法学习计划，单个规划意图。",
  "requiresClarification": false,
  "clarificationQuestion": null,
  "intents": [
    { "intent": "plan", "confidence": 0.95 }
  ],
  "plan": [
    {
      "agent": "path_planner",
      "mode": "plan",
      "task": "为学生制定一份个性化的算法学习计划",
      "reason": "用户请求学习路径规划",
      "usePrevContext": false
    }
  ]
}

用户输入："发给他"
输出：
{
  "analysis": "用户意图不明确，缺少关键信息：发给谁、发什么、通过什么方式发送。",
  "requiresClarification": true,
  "clarificationQuestion": "请问你要发给谁？发送什么内容？通过什么方式发送？",
  "intents": [],
  "plan": []
}`;

/**
 * Use the orchestrator LLM to decompose a user request into an execution plan.
 * Returns null if decomposition fails (caller should fall back to single-step mode).
 */
export async function decomposeWithLLM(
  messages: AgentMessage[],
  settings: BrowserLLMSettings,
  learnerState: LearnerState,
  context?: ChatContext
): Promise<OrchestratorPlan | null> {
  const { baseURL, model } = resolveEndpoint(settings);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) return null;

  const learnerContext = buildLearnerContext(learnerState, 'chat', context);

  const apiMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: ORCHESTRATOR_DECOMPOSITION_PROMPT + '\n\n' + learnerContext },
    ...messages.slice(-6).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        temperature: 0.2,
        max_tokens: 1500,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[decomposeWithLLM] API error:', res.status, detail.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Try to extract JSON from the response
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : rawContent;

    const parsed = JSON.parse(jsonStr) as Partial<OrchestratorPlan>;

    // Validate the plan
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.requiresClarification) {
      return {
        analysis: parsed.analysis || '',
        requiresClarification: true,
        clarificationQuestion: parsed.clarificationQuestion,
        intents: [],
        plan: [],
      };
    }

    const plan = Array.isArray(parsed.plan) ? parsed.plan : [];
    const validPlan = plan.filter((step): step is AgentStep => {
      return (
        !!step &&
        typeof step === 'object' &&
        typeof step.task === 'string' &&
        ['lecturer', 'problem_setter', 'examiner', 'path_planner'].includes(step.agent) &&
        ['chat', 'practice', 'plan', 'review'].includes(step.mode)
      );
    });

    if (validPlan.length === 0) return null;

    return {
      analysis: parsed.analysis || '',
      requiresClarification: false,
      intents: Array.isArray(parsed.intents) ? parsed.intents : [],
      plan: validPlan,
    };
  } catch (err) {
    console.warn('[decomposeWithLLM] parse error:', err);
    return null;
  }
}

// ============================================================
// Multi-step orchestration (sequential multi-agent)
// ============================================================

const AGENT_SKILL_MAP: Record<AgentRole, string> = {
  orchestrator: 'socratic-teaching',
  lecturer: 'socratic-teaching',
  problem_setter: 'problem-generation',
  examiner: 'code-assessment',
  path_planner: 'learning-path',
};

/**
 * Orchestrator re-planning: after each step, ask the orchestrator LLM
 * whether the remaining plan should be adjusted based on the step's result.
 * This is the "Re-plan" phase of Plan-and-Execute.
 */
async function orchestratorRePlan(
  baseURL: string,
  model: string,
  apiKey: string,
  steps: AgentStep[],
  completedStepIdx: number,
  stepResult: string,
  messages: AgentMessage[],
  learnerState: LearnerState
): Promise<{ shouldReplan: boolean; newSteps: AgentStep[] | null; reason: string }> {
  const completedStep = steps[completedStepIdx];
  const remainingSteps = steps.slice(completedStepIdx + 1);

  const rePlanPrompt = `你是 CodeMentor 的总控 Agent。你之前制定了一个多步执行计划，现在第 ${completedStepIdx + 1} 步已完成。

## 已完成的步骤
第${completedStepIdx + 1}步：${AGENT_NAMES[completedStep.agent]}(${completedStep.mode}) - ${completedStep.task}
执行结果摘要：${stepResult.slice(0, 500)}

## 剩余计划
${remainingSteps.map((s, i) => `${i + 1}.${AGENT_NAMES[s.agent]}(${s.mode}) - ${s.task}`).join('\n')}

## 你的任务（Plan-and-Execute 再规划阶段）
评估已完成步骤的结果，判断剩余计划是否需要调整：
1. 结果是否符合预期？
2. 剩余步骤的任务描述是否需要根据已完成结果修改？
3. 是否需要增加或删除步骤？

返回 JSON：
{
  "shouldReplan": false,
  "reason": "结果符合预期，继续执行原计划",
  "newSteps": null
}

如果需要调整：
{
  "shouldReplan": true,
  "reason": "讲解重点偏向了XX，出题应该聚焦XX",
  "newSteps": [
    { "agent": "problem_setter", "mode": "practice", "task": "基于XX内容出题", "usePrevContext": true }
  ]
}

注意：只在确实需要调整时才 shouldReplan=true。大多数情况下保持原计划即可。`;

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: rePlanPrompt }],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!res.ok) return { shouldReplan: false, newSteps: null, reason: '再规划请求失败' };

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { shouldReplan: false, newSteps: null, reason: '解析失败' };

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.shouldReplan) {
      return { shouldReplan: false, newSteps: null, reason: parsed.reason || '继续原计划' };
    }

    // Validate new steps
    const newSteps = Array.isArray(parsed.newSteps) ? parsed.newSteps.filter((s: AgentStep) =>
      s && typeof s.task === 'string' &&
      ['lecturer', 'problem_setter', 'examiner', 'path_planner'].includes(s.agent) &&
      ['chat', 'practice', 'plan', 'review'].includes(s.mode)
    ) : [];

    if (newSteps.length === 0) {
      return { shouldReplan: false, newSteps: null, reason: '新计划为空，保持原计划' };
    }

    return { shouldReplan: true, newSteps, reason: parsed.reason || '计划已调整' };
  } catch {
    return { shouldReplan: false, newSteps: null, reason: '再规划异常' };
  }
}

/**
 * Multi-step sequential orchestration.
 * Executes multiple sub-agents in sequence, passing each agent's output
 * as context to the next. Activities and streaming are tracked across
 * all steps so the UI shows a unified thinking chain.
 */
export async function streamBrowserLLMMultiStep(
  messages: AgentMessage[],
  settings: BrowserLLMSettings,
  steps: AgentStep[],
  learnerState: LearnerState,
  callbacks: StreamCallbacks,
  context?: ChatContext
): Promise<ChatResponse> {
  const { baseURL, model } = resolveEndpoint(settings);
  const activities: AgentActivity[] = [];
  const emit = (a: AgentActivity) => {
    const idx = activities.findIndex((x) => x.id === a.id);
    if (idx >= 0) activities[idx] = a;
    else activities.push(a);
    callbacks.onActivity?.(a);
  };
  const finish = (a: AgentActivity, status: AgentActivity['status'] = 'success', detail?: string) => {
    const done = finishActivity(a, status, detail);
    const idx = activities.findIndex((x) => x.id === a.id);
    if (idx >= 0) activities[idx] = done;
    else activities.push(done);
    callbacks.onActivity?.(done);
    return done;
  };

  // --- Orchestrator plans the multi-step task ---
  const orchStart = newActivity(
    'orchestrator',
    'agent_start',
    '总控分析用户意图（多步任务）',
    { paradigm: 'Plan-and-Execute' as AgentParadigm }
  );
  emit(orchStart);
  await sleep(150);

  const stepSummary = steps
    .map((s, i) => `${i + 1}.${AGENT_NAMES[s.agent]}(${s.mode})`)
    .join(' → ');

  // Emit plan_created activity with full plan details
  const planAct = newActivity(
    'orchestrator',
    'plan_created',
    `执行计划（${steps.length} 步）: ${stepSummary}`,
    {
      paradigm: 'Plan-and-Execute' as AgentParadigm,
      detail: steps.map((s, i) =>
        `${i + 1}. ${AGENT_NAMES[s.agent]}（${s.mode}）: ${s.task}` +
        (s.reason ? `\n   └─ ${s.reason}` : '')
      ).join('\n\n'),
      planTotal: steps.length,
    }
  );
  emit(planAct);
  finish(planAct, 'success');

  finish(orchStart, 'success', `识别为多步任务，计划：${stepSummary}`);

  let prevOutput = '';
  const allContents: string[] = [];
  let problem: AlgorithmProblem | undefined;

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    const agentName = AGENT_NAMES[step.agent];
    const skillName = AGENT_SKILL_MAP[step.agent];
    const stepActivitiesStart = activities.length; // Track where this step's activities begin

    // --- Plan step start ---
    const stepStartAct = newActivity(
      'orchestrator',
      'plan_step_start',
      `第${stepIdx + 1}步/${steps.length}: ${agentName} 开始执行`,
      {
        paradigm: 'Plan-and-Execute' as AgentParadigm,
        planStep: stepIdx,
        planTotal: steps.length,
        detail: `任务: ${step.task}`,
      }
    );
    emit(stepStartAct);

    // --- Sub-agent starts ---
    const agentStart = newActivity(
      step.agent,
      'agent_start',
      `${agentName}开始工作（第${stepIdx + 1}步/${steps.length}）`,
      { paradigm: AGENT_PARADIGM[step.agent] as AgentParadigm }
    );
    emit(agentStart);

    // --- Load skill ---
    const skill = skillRegistry.getSkill(skillName);
    const skillAct = newActivity(
      step.agent,
      'skill_load',
      `加载技能：${skill?.name || skillName}`,
      { detail: skill?.description?.slice(0, 120) }
    );
    emit(skillAct);
    await sleep(60);
    finish(skillAct, 'success');

    // --- Read knowledge base ---
    const relevantTopics = getRelevantTopics(messages, step.mode);
    const knowledgeAct = newActivity(
      step.agent,
      'knowledge_read',
      `读取知识库（${relevantTopics.length} 个相关知识点）`,
      { detail: relevantTopics.map((t) => t.name).join('、') || '通用知识' }
    );
    emit(knowledgeAct);
    await sleep(40);
    finish(knowledgeAct, 'success');

    // --- REMOVED: code-driven tool calls ---
    // Tools are now LLM-driven via the ReAct loop. The LLM decides
    // when to call search_knowledge, analyze_code, learning_path,
    // validate_problem, web_search, etc.

    finish(agentStart, 'success');

    // --- Build system prompt ---
    let systemPrompt = SUB_AGENTS[step.agent].systemPrompt;
    if (step.mode === 'practice') {
      systemPrompt += '\n\n' + PRACTICE_SCHEMA_PROMPT;
    } else if (step.mode === 'review' && context?.codeSubmission) {
      systemPrompt += '\n\n## 待审查的代码\n```python\n' + context.codeSubmission + '\n```';
    }

    const learnerContext = buildLearnerContext(learnerState, step.mode, context);
    const fullSystem = systemPrompt + '\n\n' + learnerContext;

    // --- Build user message ---
    // For multi-step, use the step's task as the user message.
    // If usePrevContext, append previous agent's output as reference.
    let userContent = step.task;
    if (step.usePrevContext && prevOutput) {
      userContent += '\n\n---\n\n## 上一个 Agent 的输出（作为参考上下文）\n\n' + prevOutput;
    }

    const apiMessages: Array<{ role: string; content: string }> = [
      // Include original conversation for context (but prioritize the step task)
      ...messages.slice(-4).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userContent },
    ];

    // --- Emit paradigm-specific entry activities (multi-step) ---
    if (step.mode === 'practice') {
      const planAct = newActivity(step.agent, 'pe_plan', '规划题目参数', {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm, peIteration: 0,
        detail: '根据学习者水平和知识点规划题目参数',
      });
      emit(planAct); await sleep(30); finish(planAct, 'success');
      const genAct = newActivity(step.agent, 'pe_generate', '生成题目中…', {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm, peIteration: 0, status: 'running',
      });
      emit(genAct);
      (genAct as any)._deferredFinish = true;
      (apiMessages as any)._genAct = genAct;
    } else if (step.mode === 'plan') {
      const assessAct = newActivity(step.agent, 'plan_assess', '评估学习者现状', {
        paradigm: 'Plan-and-Execute' as AgentParadigm, status: 'running',
      });
      emit(assessAct); await sleep(30); finish(assessAct, 'success');
      const structAct = newActivity(step.agent, 'plan_structure', '组织学习路径结构…', {
        paradigm: 'Plan-and-Execute' as AgentParadigm, status: 'running',
      });
      emit(structAct);
      (structAct as any)._deferredFinish = true;
      (apiMessages as any)._structAct = structAct;
    } else if (step.mode === 'review') {
      const evalAct = newActivity(step.agent, 'reflexion_evaluate', '评估提交代码…', {
        paradigm: 'Reflexion' as AgentParadigm, reflexionTurn: 1, status: 'running',
      });
      emit(evalAct);
      (evalAct as any)._deferredFinish = true;
      (apiMessages as any)._evalAct = evalAct;
    } else if (step.mode === 'chat') {
      const diagAct = newActivity(step.agent, 'cot_diagnose', '诊断学生问题…', {
        paradigm: 'ReAct+CoT' as AgentParadigm, cotStep: 'diagnose', status: 'running',
      });
      emit(diagAct);
      (diagAct as any)._deferredFinish = true;
      (apiMessages as any)._diagAct = diagAct;
    }

    // --- ReAct loop: LLM drives tool calling autonomously ---
    const { content: stepContent } = await runReActLoop(
      baseURL,
      model,
      settings.apiKey,
      fullSystem,
      apiMessages,
      step.agent,
      step.mode,
      callbacks,
      emit,
      finish,
      context,
    );

    // --- Post-processing for practice mode ---
    // The LLM may have already validated the problem during the ReAct loop.
    // Here we do a safety-net extraction + quick validation.
    let stepFinalContent = stepContent;

    // Finish deferred entry activities and emit follow-up activities (multi-step)
    const mDeferredGen = (apiMessages as any)._genAct as AgentActivity | undefined;
    const mDeferredStruct = (apiMessages as any)._structAct as AgentActivity | undefined;
    const mDeferredEval = (apiMessages as any)._evalAct as AgentActivity | undefined;
    const mDeferredDiag = (apiMessages as any)._diagAct as AgentActivity | undefined;

    if (step.mode === 'practice') {
      if (mDeferredGen) finish(mDeferredGen, 'success', '题目生成完成，开始验证质量');
    } else if (step.mode === 'plan') {
      if (mDeferredStruct) finish(mDeferredStruct, 'success', '学习路径结构组织完成');
    } else if (step.mode === 'review') {
      if (mDeferredEval) finish(mDeferredEval, 'success', '代码分析完成，进入反思评估');
      const critiqueAct = newActivity(step.agent, 'reflexion_critique', '反思评估质量…', {
        paradigm: 'Reflexion' as AgentParadigm, reflexionTurn: 1, status: 'running',
      });
      emit(critiqueAct); await sleep(20);
      // Extract critique points from content
      const critiqueDetail = stepContent.includes('问题') || stepContent.includes('不足')
        ? '自我审查评估维度：正确性、效率、代码风格、边界处理'
        : '自我审查完成：评估维度覆盖全面';
      finish(critiqueAct, 'success', critiqueDetail);
      const scoreMatch = stepContent.match(/(\d{1,3})\s*分/);
      const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : undefined;
      const verdictAct = newActivity(step.agent, 'reflexion_verdict', score != null ? `判定：${score} 分` : '给出综合判定', {
        paradigm: 'Reflexion' as AgentParadigm, reflexionTurn: 1, score,
        detail: score != null
          ? (score >= 80 ? '代码质量良好，通过考核' : score >= 60 ? '基本正确，有待改进' : '存在较多问题，需要加强练习')
          : '综合判定已完成',
      });
      emit(verdictAct); finish(verdictAct, 'success');
      const feedbackAct = newActivity(step.agent, 'reflexion_feedback', '整理改进建议…', {
        paradigm: 'Reflexion' as AgentParadigm, reflexionTurn: 1, status: 'running',
      });
      emit(feedbackAct); await sleep(20);
      // Extract feedback summary
      const feedbackLines = stepContent.split('\n').filter((l: string) => l.trim().startsWith('-') || l.trim().startsWith('*') || /^\d+\./.test(l.trim())).slice(0, 3).join('; ');
      finish(feedbackAct, 'success', feedbackLines || '改进建议已组织完成');
    } else if (step.mode === 'chat') {
      if (mDeferredDiag) finish(mDeferredDiag, 'success', '诊断完成，分析了学生的知识卡点和理解水平');
      const designAct = newActivity(step.agent, 'cot_design', '设计引导问题…', {
        paradigm: 'ReAct+CoT' as AgentParadigm, cotStep: 'design', status: 'running',
      });
      emit(designAct); await sleep(20);
      finish(designAct, 'success', '采用苏格拉底式提问法，设计层层递进的引导路径');
      const presentAct = newActivity(step.agent, 'cot_present', '组织教学呈现…', {
        paradigm: 'ReAct+CoT' as AgentParadigm, cotStep: 'present', status: 'running',
      });
      emit(presentAct); await sleep(20);
      finish(presentAct, 'success', '教学内容已组织为清晰的引导式讲解');
    }

    if (step.mode === 'practice') {
      const rawProblem = extractProblem(stepContent);
      if (rawProblem) {
        const normalized = normalizeProblem(rawProblem);
        if (quickValidate(normalized)) {
          // Quick validation passed - emit PE+R complete
          const quickVal = newActivity(step.agent, 'pe_validate', '快速验证题目结构', {
            paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
            peIteration: 0,
            status: 'running',
          });
          emit(quickVal); await sleep(20);
          finish(quickVal, 'success', '题目结构完整，包含标题、描述、示例和约束');
          const completeAct = newActivity(step.agent, 'pe_complete', '题目验证通过', {
            paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
            peIteration: 0,
            detail: '题目结构完整，测试用例正确，可以交付给学生',
          });
          emit(completeAct); finish(completeAct, 'success');
          problem = normalized;
          callbacks.onProblem?.(normalized);
          stepFinalContent = `好的，我为你准备了一道 **${normalized.topicId}** 练习题：\n\n### ${normalized.title}\n\n${normalized.description}\n\n**难度**：${'⭐'.repeat(normalized.difficulty)}\n\n**示例**：\n${formatExamples(normalized.examples)}\n\n**约束**：\n${(normalized.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！`;
        } else {
          // Safety-net validation failed; try one repair
          const { problem: validated, validationText } = await validateAndRepairProblem(
            normalized,
            step.agent,
            baseURL,
            model,
            settings.apiKey,
            emit,
            finish,
            apiMessages,
            fullSystem,
            1
          );
          if (validated && quickValidate(validated)) {
            problem = validated;
            callbacks.onProblem?.(validated);
            stepFinalContent = `好的，我为你准备了一道 **${validated.topicId}** 练习题：\n\n### ${validated.title}\n\n${validated.description}\n\n**难度**：${'⭐'.repeat(validated.difficulty)}\n\n**示例**：\n${formatExamples(validated.examples)}\n\n**约束**：\n${(validated.constraints || []).map((c: string) => `- ${c}`).join('\n')}\n\n快在右侧练习台编写你的 Python 代码吧！`;
          } else {
            const localProblem = getRandomProblem();
            problem = localProblem;
            callbacks.onProblem?.(localProblem);
            stepFinalContent = `我尝试为你生成一道题目，但生成的题目未通过质量验证（${validationText}）。我从本地题库为你挑选了一道题目：\n\n### ${localProblem.title}\n\n${localProblem.description}\n\n**难度**：${'⭐'.repeat(localProblem.difficulty)}\n\n快在右侧练习台编写你的 Python 代码吧！`;
          }
        }
      } else {
        const valAct = newActivity(step.agent, 'tool_call', '调用工具：validate_problem（解析题目 JSON 失败）');
        emit(valAct);
        finish(valAct, 'error', '返回内容中未找到有效 JSON，降级到本地题库');
        const localProblem = getRandomProblem();
        problem = localProblem;
        callbacks.onProblem?.(localProblem);
        stepFinalContent = `我尝试生成练习题，但返回格式不太对。我从本地题库为你挑选了一道题目：\n\n### ${localProblem.title}\n\n${localProblem.description}\n\n**难度**：${'⭐'.repeat(localProblem.difficulty)}\n\n快在右侧练习台编写你的 Python 代码吧！`;
      }
    }

    // --- Store output for next step ---
    prevOutput = stepFinalContent;
    allContents.push(stepFinalContent);

    // --- Agent end ---
    const agentEnd = newActivity(step.agent, 'agent_end', `${agentName}完成第${stepIdx + 1}步`);
    emit(agentEnd);
    finish(agentEnd, 'success');

    // Mark plan step as done
    finish(stepStartAct, 'success', `${agentName}完成，输出 ${stepFinalContent.length} 字`);

    // --- Plan step done activity ---
    const stepDoneAct = newActivity(
      'orchestrator',
      'plan_step_done',
      `第${stepIdx + 1}步完成: ${agentName}`,
      {
        paradigm: 'Plan-and-Execute' as AgentParadigm,
        planStep: stepIdx,
        planTotal: steps.length,
        detail: `输出 ${stepFinalContent.length} 字`,
      }
    );
    emit(stepDoneAct);
    finish(stepDoneAct, 'success');

    // --- Collect this step's activities and fire onStepComplete ---
    const stepActivities = activities.slice(stepActivitiesStart);
    callbacks.onStepComplete?.({
      agent: step.agent,
      content: stepFinalContent,
      activities: stepActivities,
      problem: step.mode === 'practice' ? problem : undefined,
    });

    // --- Orchestrator transition with re-planning ---
    if (stepIdx < steps.length - 1) {
      const transAct = newActivity(
        'orchestrator',
        'agent_start',
        `总控：评估第${stepIdx + 1}步结果，决定是否调整计划…`,
        { paradigm: 'Plan-and-Execute' as AgentParadigm }
      );
      emit(transAct);

      // Ask orchestrator: should we continue with the plan or re-plan?
      try {
        const rePlanResult = await orchestratorRePlan(
          baseURL,
          model,
          settings.apiKey,
          steps,
          stepIdx,
          stepFinalContent,
          messages,
          learnerState
        );

        if (rePlanResult.shouldReplan && rePlanResult.newSteps) {
          // Replace remaining steps with re-planned steps
          const oldRemaining = steps.length - stepIdx - 1;

          // Emit replan activity
          const replanAct = newActivity(
            'orchestrator',
            'plan_replan',
            `总控调整计划：${rePlanResult.reason.slice(0, 60)}`,
            {
              paradigm: 'Plan-and-Execute' as AgentParadigm,
              planStep: stepIdx,
              planTotal: steps.length,
              detail: `原因: ${rePlanResult.reason}\n\n原计划剩余 ${oldRemaining} 步，新计划 ${rePlanResult.newSteps.length} 步:\n` +
                rePlanResult.newSteps.map((s, i) =>
                  `${i + 1}. ${AGENT_NAMES[s.agent]}（${s.mode}）: ${s.task}`
                ).join('\n'),
              isReplanned: true,
            }
          );
          emit(replanAct);

          steps.splice(stepIdx + 1, oldRemaining, ...rePlanResult.newSteps);
          finish(
            transAct,
            'success',
            `总控决定调整计划：${rePlanResult.reason}\n新计划：${steps.slice(stepIdx + 1).map((s, i) => `${i + 1}.${AGENT_NAMES[s.agent]}(${s.mode})`).join(' → ')}`
          );
          finish(replanAct, 'success');
        } else {
          finish(
            transAct,
            'success',
            `总控评估通过，继续执行原计划。传递 ${stepFinalContent.length} 字上下文给下一个 Agent`
          );
        }
      } catch {
        // Re-planning failed, continue with original plan
        finish(transAct, 'success', `总控评估完成，继续原计划。传递 ${stepFinalContent.length} 字上下文`);
      }
    }
  }

  // --- Combine all outputs ---
  const finalContent = allContents.join('\n\n---\n\n');

  // --- Orchestrator finalizes ---
  const orchEnd = newActivity(
    'orchestrator',
    'agent_end',
    '总控：多步任务全部完成',
    { paradigm: 'Plan-and-Execute' as AgentParadigm }
  );
  emit(orchEnd);
  finish(orchEnd, 'success', `共完成 ${steps.length} 步，输出 ${finalContent.length} 字`);

  const agentTrail = buildLegacyTrail(activities, steps[steps.length - 1].agent, 'chat');

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
  callbacks: StreamCallbacks,
  agentRole: AgentRole = 'lecturer'
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
  let fullReasoning = '';
  let reasoningActivity: AgentActivity | null = null;
  const REASONING_PREVIEW_LIMIT = 800;
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
          const delta = parsed.choices?.[0]?.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          // Capture reasoning_content (e.g. DeepSeek-R1 / Volcengine reasoning models)
          const reasoningDelta = delta.reasoning_content as string | undefined;
          if (reasoningDelta) {
            fullReasoning += reasoningDelta;
            if (!reasoningActivity) {
              const paradigm = AGENT_PARADIGM[agentRole] as AgentParadigm;
              reasoningActivity = newActivity(
                agentRole,
                'thinking',
                `${AGENT_NAMES[agentRole]} · ${paradigm} 推理中…`,
                { detail: '', paradigm }
              );
              callbacks.onActivity?.(reasoningActivity);
            }
            const preview =
              fullReasoning.length > REASONING_PREVIEW_LIMIT
                ? '…' + fullReasoning.slice(-REASONING_PREVIEW_LIMIT)
                : fullReasoning;
            callbacks.onActivity?.({
              ...reasoningActivity,
              label: `${AGENT_NAMES[agentRole]} · ${reasoningActivity.paradigm} 推理中…`,
              detail: preview,
            });
          }

          const contentDelta = delta.content as string | undefined;
          if (contentDelta) {
            // First content token — finalize reasoning activity
            if (reasoningActivity) {
              const preview =
                fullReasoning.length > REASONING_PREVIEW_LIMIT
                  ? '…' + fullReasoning.slice(-REASONING_PREVIEW_LIMIT)
                  : fullReasoning;
              // Keep full reasoning as detail, put word count in label
              callbacks.onActivity?.({
                ...reasoningActivity,
                status: 'success',
                label: `${AGENT_NAMES[agentRole]} · ${reasoningActivity.paradigm} 推理完成（${fullReasoning.length} 字）`,
                detail: preview,
                durationMs: Date.now() - reasoningActivity.timestamp,
              });
              reasoningActivity = null;
            }
            fullContent += contentDelta;
            callbacks.onToken?.(contentDelta);
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

  // If stream ended but reasoning was still in flight (no content arrived), finalize it
  if (reasoningActivity) {
    const preview =
      fullReasoning.length > REASONING_PREVIEW_LIMIT
        ? '…' + fullReasoning.slice(-REASONING_PREVIEW_LIMIT)
        : fullReasoning;
    // Keep full reasoning as detail, put word count in label
    callbacks.onActivity?.({
      ...reasoningActivity,
      status: fullContent ? 'success' : 'warning',
      label: `${AGENT_NAMES[agentRole]} · ${reasoningActivity.paradigm} 推理完成（${fullReasoning.length} 字）`,
      detail: preview,
      durationMs: Date.now() - reasoningActivity.timestamp,
    });
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
// Problem validation & repair (shared by single-step and multi-step)
// ============================================================

async function validateAndRepairProblem(
  normalized: AlgorithmProblem,
  agentRole: AgentRole,
  baseURL: string,
  model: string,
  apiKey: string,
  emit: (a: AgentActivity) => void,
  finish: (a: AgentActivity, status?: AgentActivity['status'], detail?: string) => AgentActivity,
  apiMessages: Array<{ role: string; content: string }>,
  repairSystemPrompt: string,
  maxRetries = 1
): Promise<{ problem: AlgorithmProblem | null; validationText: string }> {
  let currentProblem = normalized;
  let attempts = 0;

  const finishAct = (
    act: AgentActivity,
    status: AgentActivity['status'],
    detail: string
  ) => {
    finish(act, status, detail.slice(0, 400));
  };

  // === PE+R 范式: 验证题目 ===
  let valAct = newActivity(
    agentRole,
    'pe_validate',
    `第 ${attempts + 1} 次验证题目质量`,
    {
      paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
      peIteration: attempts,
      detail: '检查题目结构完整性、测试用例正确性、边界条件覆盖度',
    }
  );
  emit(valAct);

  let lastResult = await toolRegistry.execute('validate_problem', {
    problem: JSON.stringify(currentProblem),
  });

  while (!lastResult.success && attempts < maxRetries) {
    attempts++;
    finishAct(
      valAct,
      'warning',
      `验证未通过：${lastResult.display || lastResult.error || '未知问题'}`
    );

    // === PE+R 范式: 反思失败原因 ===
    const reflectAct = newActivity(
      agentRole,
      'pe_reflect',
      `反思验证失败原因（第 ${attempts} 次）`,
      {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
        peIteration: attempts,
        detail: lastResult.display || lastResult.error || '分析题目缺陷',
        status: 'running',
      }
    );
    emit(reflectAct);

    // === PE+R 范式: 修复题目 ===
    const repairAct = newActivity(
      agentRole,
      'pe_repair',
      `修复题目（第 ${attempts} 次）`,
      {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
        peIteration: attempts,
        status: 'running',
      }
    );
    emit(repairAct);
    finish(reflectAct, 'success', `定位问题：${lastResult.display || lastResult.error || '结构/测试用例/约束问题'}`);

    const repairMessages = [
      { role: 'system', content: repairSystemPrompt },
      ...apiMessages.filter((m) => m.role === 'user'),
      {
        role: 'user',
        content:
          `你之前生成的题目未通过质量验证，请根据以下验证结果修复题目，并返回修复后的完整 JSON。\n\n` +
          `验证问题：\n${lastResult.display || lastResult.error || '未知错误'}\n\n` +
          `原题目 JSON：\n\`\`\`json\n${JSON.stringify(currentProblem, null, 2)}\n\`\`\`\n\n` +
          `请只返回修复后的 JSON，不要附加其他说明。`,
      },
    ];

    const repairRes = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: repairMessages,
        temperature: 0.3,
        max_tokens: 2500,
      }),
    });

    if (repairRes.ok) {
      const repairData = await repairRes.json();
      const repairContent = repairData.choices?.[0]?.message?.content || '';
      const repairedRaw = extractProblem(repairContent);
      if (repairedRaw) {
        currentProblem = normalizeProblem(repairedRaw);
        finish(repairAct, 'success', '已根据反思结果修复题目结构和测试用例');
      } else {
        finish(repairAct, 'error', '修复结果解析失败');
      }
    } else {
      finish(repairAct, 'error', '修复请求失败');
    }

    // Re-validate
    valAct = newActivity(
      agentRole,
      'pe_validate',
      `验证修复后题目（第 ${attempts + 1} 次）`,
      {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
        peIteration: attempts,
        status: 'running',
      }
    );
    emit(valAct);
    lastResult = await toolRegistry.execute('validate_problem', {
      problem: JSON.stringify(currentProblem),
    });
  }

  if (lastResult.success) {
    // === PE+R 范式: 题目通过验证 ===
    const completeAct = newActivity(
      agentRole,
      'pe_complete',
      `题目验证通过${attempts > 0 ? `（经过 ${attempts} 次修复）` : ''}`,
      {
        paradigm: 'Plan-and-Execute+Reflexion' as AgentParadigm,
        peIteration: attempts,
        detail: lastResult.display || '题目结构完整，测试用例正确，可以交付给学生',
      }
    );
    emit(completeAct);
    finishAct(valAct, 'success', lastResult.display || '验证通过');
    finish(completeAct, 'success');
    return { problem: currentProblem, validationText: lastResult.display || '验证通过' };
  }

  finishAct(
    valAct,
    'error',
    lastResult.display || lastResult.error || '验证失败'
  );
  return { problem: null, validationText: lastResult.display || lastResult.error || '验证失败' };
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
