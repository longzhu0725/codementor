import { generateText, tool, isStepCount } from 'ai';
import { z } from 'zod';
import { getModelForEffort, LLMProvider } from '@/lib/llm/client';
import { ORCHESTRATOR_SYSTEM_PROMPT, SUB_AGENTS } from './definitions';
import { LearnerState, AgentMessage, ChatRequest, AlgorithmProblem, CodeExecutionResult } from '@/types';
import { getCheckpointSummary, getDueReviews, getStrugglingTopics } from '@/lib/memory/learner-state';
import { KNOWLEDGE_TOPICS, getTopicById } from '@/lib/knowledge/topics';
import { skillRegistry } from '@/lib/skills/registry';

// ============================================================
// Agent Orchestrator - The Core Agent Loop
// Inspired by Claude Code's agent loop:
// 1. Receive prompt (user input + learner state + context)
// 2. Evaluate (LLM decides which sub-agents to call)
// 3. Execute tools (call sub-agents, get results)
// 4. Repeat (if more tools needed) or Return (final response)
//
// Single-writer pattern: only orchestrator updates learner state
// Sub-agents communicate via prompt strings, return natural language
// ============================================================

interface OrchestratorConfig {
  provider: LLMProvider;
  apiKey: string;
  learnerState: LearnerState;
  context?: ChatRequest['context'];
}

// Build the system prompt with learner context
function buildSystemPrompt(state: LearnerState, context?: ChatRequest['context']): string {
  const checkpointSummary = getCheckpointSummary(state);
  const dueReviews = getDueReviews(state);
  const struggling = getStrugglingTopics(state);

  const masterySummary = Object.entries(state.mastery)
    .map(([id, entry]) => {
      const topic = getTopicById(id);
      return `- ${topic?.name || id}: 掌握度 ${entry.mastery.toFixed(2)} (${entry.attempts}次尝试)`;
    })
    .join('\n');

  let contextSection = '';
  if (context?.currentProblem) {
    contextSection += `\n## 当前题目\n${context.currentProblem.title} (${context.currentProblem.difficulty}星)\n${context.currentProblem.description}`;
  }
  if (context?.codeSubmission) {
    contextSection += `\n## 学生提交的代码\n\`\`\`python\n${context.codeSubmission}\n\`\`\``;
  }
  if (context?.executionResult) {
    const er = context.executionResult;
    contextSection += `\n## 代码执行结果\n成功: ${er.success}`;
    if (er.testResults) {
      contextSection += `\n测试: ${er.testResults.passed}/${er.testResults.total} 通过`;
      if (er.testResults.failures.length > 0) {
        contextSection += '\n失败用例:\n' + er.testResults.failures
          .map(f => `  输入: ${f.input}, 期望: ${f.expected}, 实际: ${f.actual}`)
          .join('\n');
      }
    }
    if (er.error) {
      contextSection += `\n错误: ${er.error}`;
    }
  }

  return `${ORCHESTRATOR_SYSTEM_PROMPT}

## 学习者状态
${checkpointSummary}

### 掌握度详情
${masterySummary || '暂无数据（新学习者）'}

### 到期复习
${dueReviews.length > 0 ? dueReviews.map(id => getTopicById(id)?.name || id).join(', ') : '暂无到期复习'}

### 薄弱知识点
${struggling.length > 0 ? struggling.map(id => getTopicById(id)?.name || id).join(', ') : '暂无薄弱点'}

### 学习目标
${state.preferences.targetGroup}

### 提示级别偏好
Level ${state.preferences.hintLevel}
${contextSection}`;
}

// Call a sub-agent with isolated context
async function callSubAgent(
  agentName: string,
  prompt: string,
  config: OrchestratorConfig
): Promise<string> {
  const agentDef = SUB_AGENTS[agentName];
  if (!agentDef) {
    return `错误: 未知的子 Agent ${agentName}`;
  }

  try {
    const model = getModelForEffort(
      config.provider,
      config.apiKey,
      agentDef.model || 'medium'
    );

    const { text } = await generateText({
      model,
      system: agentDef.systemPrompt,
      prompt,
      maxOutputTokens: 2000,
    });

    return text;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return `[子 Agent ${agentName} 调用失败: ${errMsg}]`;
  }
}

// Define tools for the orchestrator (each tool = one sub-agent invocation)
function createSubAgentTools(config: OrchestratorConfig) {
  return {
    call_lecturer: tool({
      description: '调用讲师 Agent 进行苏格拉底式教学引导。当学生提问概念、解题卡住需要提示时使用。',
      inputSchema: z.object({
        question: z.string().describe('学生的问题或遇到的困难'),
        topic: z.string().optional().describe('相关知识点名称'),
        mastery: z.number().optional().describe('学生该知识点的掌握度 0-1'),
      }),
      execute: async ({ question, topic, mastery }) => {
        const prompt = `学生问题: ${question}
${topic ? `相关知识点: ${topic}` : ''}
${mastery !== undefined ? `学生掌握度: ${mastery}` : '学生掌握度: 未知'}

请根据以上信息，为学生提供苏格拉底式的教学引导。`;
        return await callSubAgent('lecturer', prompt, config);
      },
    }),

    call_problem_setter: tool({
      description: '调用出题 Agent 生成练习题。当学生进入练习模式时使用。',
      inputSchema: z.object({
        topic: z.string().optional().describe('指定知识点的名称，如"二分查找"。不指定则根据掌握度自动选择'),
        difficulty: z.number().optional().describe('题目难度 1-5'),
        targetGroup: z.string().optional().describe('目标群体: competition/student/interview/self_learner'),
      }),
      execute: async ({ topic, difficulty, targetGroup }) => {
        const masteryInfo = Object.entries(config.learnerState.mastery)
          .map(([id, entry]) => {
            const t = getTopicById(id);
            return `${t?.name || id}: ${entry.mastery.toFixed(2)}`;
          })
          .join(', ');

        const prompt = `请为学生生成一道算法练习题。

${topic ? `指定知识点: ${topic}` : '请根据学生掌握度自动选择知识点'}
${difficulty ? `难度要求: ${difficulty}星` : '根据掌握度自动选择难度'}
目标群体: ${targetGroup || config.learnerState.preferences.targetGroup}

学生当前掌握度:
${masteryInfo || '新学习者，请从基础题目开始'}

请严格按照 JSON 格式输出题目。`;
        return await callSubAgent('problem_setter', prompt, config);
      },
    }),

    call_examiner: tool({
      description: '调用考官审查 Agent 评估学生代码。当学生提交代码时使用。',
      inputSchema: z.object({
        code: z.string().describe('学生提交的代码'),
        testResults: z.string().describe('测试用例执行结果摘要'),
        problemInfo: z.string().describe('题目信息：标题、描述、最优复杂度'),
      }),
      execute: async ({ code, testResults, problemInfo }) => {
        const prompt = `请评估以下学生代码。

## 题目信息
${problemInfo}

## 学生代码
\`\`\`python
${code}
\`\`\`

## 测试执行结果
${testResults}

请给出全面的评估反馈。`;
        return await callSubAgent('examiner', prompt, config);
      },
    }),

    call_path_planner: tool({
      description: '调用路径规划 Agent 设计学习路径。当学生请求学习计划或查看进度时使用。',
      inputSchema: z.object({
        goal: z.string().describe('学生的学习目标'),
        timeframe: z.string().optional().describe('时间约束，如"8周"'),
      }),
      execute: async ({ goal, timeframe }) => {
        const masteryInfo = Object.entries(config.learnerState.mastery)
          .map(([id, entry]) => {
            const t = getTopicById(id);
            return `- ${t?.name || id}: 掌握度 ${entry.mastery.toFixed(2)}, 尝试 ${entry.attempts} 次`;
          })
          .join('\n');

        const prompt = `请为学生设计学习路径。

学习目标: ${goal}
${timeframe ? `时间约束: ${timeframe}` : ''}
目标群体: ${config.learnerState.preferences.targetGroup}

当前掌握度:
${masteryInfo || '新学习者，请从基础开始规划'}

已做题数: ${config.learnerState.behaviorProfile.totalProblemsAttempted}
已解题数: ${config.learnerState.behaviorProfile.totalProblemsSolved}

请给出结构化的学习路径建议。`;
        return await callSubAgent('path_planner', prompt, config);
      },
    }),
  };
}

// Main orchestrator entry point
export async function runOrchestrator(
  messages: AgentMessage[],
  config: OrchestratorConfig
): Promise<{ content: string; agentTrail: { agent: string; action: string; timestamp: number }[] }> {
  const systemPrompt = buildSystemPrompt(config.learnerState, config.context);
  const tools = createSubAgentTools(config);
  const agentTrail: { agent: string; action: string; timestamp: number }[] = [];

  // Convert AgentMessage[] to AI SDK format
  const aiMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  try {
    const model = getModelForEffort(config.provider, config.apiKey, 'high');

    const { text, steps } = await generateText({
      model,
      system: systemPrompt,
      messages: aiMessages,
      tools,
      stopWhen: isStepCount(6), // Limit turns to prevent infinite loops
      onStepFinish: (step) => {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const tc of step.toolCalls) {
            agentTrail.push({
              agent: tc.toolName.replace('call_', ''),
              action: `调用子 Agent: ${tc.toolName}`,
              timestamp: Date.now(),
            });
          }
        }
      },
    });

    return { content: text, agentTrail };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      content: `抱歉，处理你的请求时出现了问题：${errMsg}\n\n请检查 API Key 配置是否正确，然后重试。`,
      agentTrail,
    };
  }
}

// Demo mode responses (when no API key is available)
export function getDemoResponse(
  messages: AgentMessage[],
  state: LearnerState,
  context?: ChatRequest['context']
): { content: string; agentTrail: { agent: string; action: string; timestamp: number }[] } {
  const lastMessage = messages[messages.length - 1]?.content || '';
  const lowerMsg = lastMessage.toLowerCase();
  const agentTrail: { agent: string; action: string; timestamp: number }[] = [];

  // Intent recognition
  if (lowerMsg.includes('练习') || lowerMsg.includes('做题') || lowerMsg.includes('/practice')) {
    agentTrail.push({ agent: 'problem_setter', action: '生成练习题', timestamp: Date.now() });
    const topic = '哈希表';
    const mastery = state.mastery['hash']?.mastery ?? 0.5;
    return {
      content: `好的！我来为你出一道${topic}的练习题。

## 两数之和

给定一个整数数组 \`nums\` 和一个整数目标值 \`target\`，请你在该数组中找出和为目标值的那两个整数，并返回它们的数组下标。

**示例：**
- 输入：\`nums = [2,7,11,15], target = 9\`
- 输出：\`[0,1]\`
- 解释：因为 nums[0] + nums[1] == 9

**约束：**
- 2 <= nums.length <= 10^4
- 只会存在一个有效答案

**起始代码：**
\`\`\`python
def two_sum(nums, target):
    # 在这里写你的代码
    pass
\`\`\`

> 当前你的${topic}掌握度为 ${(mastery * 100).toFixed(0)}%，这道题难度适中，加油！
> 
> 写完后点击"运行代码"测试，然后提交让我评估。`,
      agentTrail,
    };
  }

  if (lowerMsg.includes('计划') || lowerMsg.includes('路径') || lowerMsg.includes('/plan')) {
    agentTrail.push({ agent: 'path_planner', action: '规划学习路径', timestamp: Date.now() });
    return {
      content: `## 你的算法学习路径

基于你当前的学习状态，我为你规划了以下路径：

### 里程碑 1：基础数据结构（1-2周）
- ✅ 数组与字符串
- ✅ 哈希表
- ⬜ 排序算法
- ⬜ 栈与队列

### 里程碑 2：基础算法（2-3周）
- ⬜ 二分查找
- ⬜ 双指针
- ⬜ 递归

### 里程碑 3：核心数据结构（3-4周）
- ⬜ 链表
- ⬜ 树与二叉树
- ⬜ 图

### 里程碑 4：核心算法（4-6周）
- ⬜ BFS 与 DFS
- ⬜ 回溯算法
- ⬜ 贪心算法
- ⬜ 动态规划

### 下一步建议
1. 先完成"排序算法"的学习
2. 每天做 1-2 道练习题
3. 每周回顾错题

> 💡 这是演示模式。配置 API Key 后，路径会根据你的实际掌握度动态调整。`,
      agentTrail,
    };
  }

  if (context?.codeSubmission) {
    agentTrail.push({ agent: 'examiner', action: '评估代码', timestamp: Date.now() });
    const passed = context.executionResult?.testResults?.passed || 0;
    const total = context.executionResult?.testResults?.total || 0;
    return {
      content: `## 代码评估结果

### 测试结果
${passed}/${total} 测试用例通过 ${passed === total ? '✅' : '⚠️'}

${
  passed === total
    ? '太棒了！所有测试用例都通过了！🎉\n\n### 代码审查\n- **时间复杂度**：O(n) - 使用哈希表一次遍历，达到了最优解\n- **空间复杂度**：O(n) - 哈希表存储\n- **可读性**：4/5 - 变量命名清晰\n- **边界覆盖**：5/5 - 处理了所有边界情况\n\n### 优化建议\n你的解法已经很好了！可以考虑：\n- 是否可以用更少的代码实现同样的逻辑？\n- 是否有其他解法（如排序+双指针）？'
    : '让我们看看哪里出了问题...\n\n### 分析\n从失败的测试用例来看，你的代码在某些边界情况下可能有问题。\n\n### 苏格拉底式提问\n- 你考虑过数组中有重复元素的情况吗？\n- 你的循环终止条件是否正确？\n- 是否遗漏了某个边界情况？\n\n> 💡 提示：检查一下你的索引更新逻辑。'
}

> 💡 这是演示模式。配置 API Key 后，评估会更详细和准确。`,
      agentTrail,
    };
  }

  // Default: chat mode (lecturer)
  agentTrail.push({ agent: 'lecturer', action: '苏格拉底式引导', timestamp: Date.now() });
  return {
    content: `好问题！让我来引导你思考。

## 关于你的问题

你问到了关于"${lastMessage.slice(0, 30)}..."的内容，这是一个很好的学习方向。

### 苏格拉底式提问 🤔

在直接回答之前，让我先问你几个问题：

1. 你目前对这个概念的理解是什么？
2. 你在什么场景下遇到了这个问题？
3. 你已经尝试过哪些方法？

### 相关知识点

根据你的学习进度，我建议你关注以下知识点：
${KNOWLEDGE_TOPICS.slice(0, 3).map((t) => `- **${t.name}**：${t.description}`).join('\n')}

> 💡 这是演示模式，回复基于预设模板。配置 OpenAI 或 Anthropic API Key 后，你将获得完整的 AI 导师体验，包括：
> - 个性化的苏格拉底式引导
> - 基于你掌握度的自适应练习题
> - 深度代码评估
> - 动态学习路径规划
>
> 点击右上角设置图标配置 API Key。`,
    agentTrail,
  };
}
