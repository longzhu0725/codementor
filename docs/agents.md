# Agent 系统

## 多智能体架构

CodeMentor 采用**总控-专家**模式的多 Agent 架构，由一个总控（Orchestrator）根据用户意图派遣不同的专家 Agent 处理任务。每个 Agent 采用适合其角色的推理范式，让思维过程透明可见。

```
                    ┌─────────────┐
                    │     用户    │
                    └──────┬──────┘
                           │ 消息
                           ↓
                    ┌─────────────┐
                    │  Orchestrator│  ← 总控：ReAct 范式
                    │   (总控)     │    观察→推理→行动→观察
                    └──┬───┬───┬──┘
                       │   │   │
          ┌────────────┘   │   └────────────┐
          ↓                ↓                 ↓
   ┌────────────┐  ┌────────────┐   ┌────────────┐   ┌────────────┐
   │  Lecturer  │  │ Problem    │   │  Examiner  │   │   Path     │
   │ (Socratic) │  │ Setter     │   │(Reflection)│   │ Planner    │
   │  (讲师)    │  │(Plan-Solve)│   │  (考官)    │   │(Plan-Solve)│
   │            │  │ (出题官)   │   │            │   │ (规划师)   │
   └────────────┘  └────────────┘   └────────────┘   └────────────┘
```

## 智能体推理范式

每个 Agent 采用最适合其角色的推理范式，系统提示词明确要求 Agent 在 reasoning_content 中展示完整思维链，用户可在对话框中展开查看每个 Agent 的思考过程。

| 智能体 | 范式 | 核心思想 | 思维链展示内容 |
|---|---|---|---|
| **Orchestrator（总控）** | **ReAct** | 观察→推理→行动→观察的循环调度 | 分析用户输入→识别意图→选择派遣哪个Agent→为什么 |
| **Lecturer（讲师）** | **Socratic** | 苏格拉底式提问引导 | 判断学生卡点→选择提示级别→设计引导问题→如何帮助学生自己发现答案 |
| **Problem Setter（出题官）** | **Plan-and-Solve** | 先规划再执行 | 分析学生需求→规划题目结构→选择测试用例→校验题目质量→调整优化 |
| **Examiner（考官）** | **Reflection** | 评估→反思→改进的迭代 | 初步评估结果→反思遗漏点→改进建议针对性→最终评分与建议 |
| **Path Planner（规划师）** | **Plan-and-Solve** | 先制定路线图再输出 | 当前掌握度分析→目标设定→知识点拓扑排序→里程碑划分→最终路径 |

## Agent 角色定义

### Orchestrator（总控）
- **职责**：意图识别、任务调度、状态整合
- **触发**：所有用户消息首先经过总控
- **活动类型**：`agent_start/end`、`thinking`
- **决策逻辑**：
  1. 解析斜杠命令（`/practice`、`/plan`、`/hint`）
  2. 自然语言关键词匹配
  3. 代码提交上下文识别
  4. 派遣对应专家 Agent

### Lecturer（讲师）
- **职责**：知识点讲解、苏格拉底式引导、答疑
- **触发模式**：`chat`、`review`（hint 请求）
- **加载技能**：苏格拉底教学法（socratic-teaching）
- **使用工具**：`find_topic`（知识库查询）
- **教学方法**：五级渐进式提示
  1. 方向性提示 → 2. 关键思路 → 3. 关键步骤 → 4. 伪代码 → 5. 完整解答

### Problem Setter（出题官）
- **职责**：生成练习题、题目质量校验
- **触发模式**：`practice`
- **加载技能**：problem-generation（出题方法论）
- **使用工具**：`list_problems`、`find_topic`
- **工作流程**：
  1. 读取知识点详情（difficulty、keyPoints、commonMistakes）
  2. 根据学习者掌握度调整难度
  3. 生成题目（含 starterCode、testCases、hints、solution）
  4. **自动校验题目质量**（validateProblemStructure）
  5. 校验不通过则降级到本地题库

### Examiner（考官）
- **职责**：代码评估、错误分析、改进建议
- **触发模式**：`review`（代码提交后）
- **加载技能**：code-review（代码评审方法论）
- **使用工具**：`analyze_code`（静态分析）
- **评估维度**：
  - 正确性（测试用例结果）
  - 时间/空间复杂度
  - 代码可读性
  - 边界情况覆盖
  - 改进建议

### Path Planner（规划师）
- **职责**：制定个性化学习路径
- **触发模式**：`plan`
- **加载技能**：learning-path（路径规划方法论）
- **使用工具**：`learning_path`（结构化路径生成）
- **考虑因素**：
  - 学习者当前水平（掌握度向量）
  - 目标群体（竞赛/面试/自学/学生）
  - 知识点依赖关系（拓扑排序）
  - SM-2 间隔重复调度

## Agent 活动类型（AgentActivity）

每个 Agent 在执行过程中产生的活动通过 `AgentActivity` 结构记录，实时推送到 UI：

| type | 含义 | 触发时机 |
|---|---|---|
| `agent_start` | Agent 启动 | Agent 开始处理任务 |
| `agent_end` | Agent 完成 | Agent 任务结束 |
| `skill_load` | 加载教学技能 | Agent 加载对应的方法论技能 |
| `knowledge_read` | 读取知识库 | 查询 topics.ts 中的知识点 |
| `tool_call` | 调用工具 | 调用 analyze_code / learning_path 等 |
| `tool_result` | 工具返回 | 工具执行完成，记录结果摘要 |
| `thinking` | 思考中 | LLM 推理过程中（流式输出时） |
| `validate` | 验证/校验 | 出题官校验题目质量 |
| `error` | 错误/降级 | 发生错误或触发降级 |

活动结构：
```typescript
type AgentParadigm = 'ReAct' | 'Plan-and-Solve' | 'Reflection' | 'Socratic';

interface AgentActivity {
  id: string;           // 唯一 ID
  agent: AgentRole;     // 哪个 Agent
  type: AgentActivityType;
  label: string;        // 简短描述，如"加载苏格拉底教学法"
  detail?: string;      // 详细信息（可展开查看）
  status?: 'running' | 'success' | 'warning' | 'error';
  durationMs?: number;  // 耗时（完成后）
  timestamp: number;
  paradigm?: AgentParadigm;  // 该 Agent 使用的推理范式
}
```

### ThinkingChain 思维链组件

思维链以内联方式展示在对话消息中，用户可点击展开/折叠查看每个 Agent 的完整思考过程：

- **实时流式更新**：thinking 类型活动在 LLM 推理时实时追加内容
- **按 Agent 分组**：不同 Agent 的思维链用不同颜色标签区分（总控紫色、讲师绿色、出题官黄色、考官红色、规划师橙色）
- **范式标签**：标签显示 Agent 名称和使用的范式（如"讲师·Socratic"），鼠标悬停显示范式说明
- **自动折叠**：生成完成后默认折叠，点击可展开查看完整推理过程
- **预览截断**：折叠时只显示最后 500 字符的推理预览，避免占用过多空间

## 流式输出流程

```
streamBrowserLLM() 开始
  │
  ├─ POST {stream: true} → LLM API (SSE)
  │
  ├─ emit onActivity({type: 'agent_start', agent: 'problem_setter'})
  ├─ emit onActivity({type: 'skill_load', label: '加载出题方法论'})
  ├─ emit onActivity({type: 'knowledge_read', label: '读取二叉树知识点'})
  ├─ emit onActivity({type: 'thinking', label: '正在生成题目...'})
  │
  ├─ for each SSE chunk:
  │    ├─ reasoning_content → emit onActivity({type: 'thinking', detail: preview})
  │    └─ content → emit onToken(delta)  → UI 逐字渲染
  │
  ├─ emit onActivity({type: 'validate', label: '校验题目结构'})
  ├─ emit onActivity({type: 'agent_end'})
  │
  └─ resolve(ChatResponse)
```

### 思维链持久化

思维链活动通过 `emit()` 函数同时推送到两个位置：
1. **activities 数组**：随 `ChatResponse` 返回，附加到 assistant 消息上
2. **onActivity 回调**：实时推送给 UI 的 `liveActivities`，生成中可见

关键设计原则：

1. **不创建空思考占位**：`callLLMStreaming` 只在模型返回真实 `reasoning_content` 时才创建 thinking 活动。如果模型不支持推理输出（如 GPT-4），则不显示思考活动，避免"空思考 UI"。

2. **推理内容不被覆盖**：`finishActivity` 不再用字数摘要覆盖 `detail` 字段。完整推理内容保留在 `detail` 中，字数信息放在 `label` 中（如"讲师 · Socratic 推理完成（523 字）"）。用户展开思维链可以看到完整的推理过程。

3. **总控思考可见**：`decomposeWithLLM` 返回后，总控的 `analysis` 字段作为 thinking 活动的 `detail` 显示。用户可以看到总控是如何分析意图、为什么选择这个执行计划的。

4. **多步活动独立**：多步流程中，每步完成时 `onStepComplete` 回调将该步的 activities 附加到对应消息上，已带走的活动从全局活动列表中移除。

### ReAct 引擎：LLM 驱动的工具调用

CodeMentor 的所有 Agent 均采用 **ReAct（Reasoning + Acting）** 模式。LLM 作为"大脑"自主决定何时调用工具、调用哪个工具、如何利用工具返回的结果。代码只负责提供工具目录和执行 LLM 选择的动作。

#### 架构对比

| 维度 | 旧方案（代码驱动） | 新方案（ReAct / LLM 驱动） |
|---|---|---|
| 谁决定调工具 | 代码正则匹配关键词 | LLM 输出 `Action: ToolName[args]` |
| 调用时机 | 系统检测到关键词就调 | LLM 判断需要时才调 |
| 工具结果去向 | 拼到 system prompt，同一次调用消费 | 作为 Observation 回传，进入下一轮对话 |
| LLM 调用次数 | 1 次 | 多轮（直到 Finish，最多 8 轮） |
| LLM 是否知道工具存在 | 否 | 是，prompt 中声明了所有可用工具 |
| 能否多步推理 | 否，只有一轮工具调用 | 是，可以搜索→分析→再搜索→验证 |

#### ReAct 循环流程

```
用户输入
  ↓
┌─────────────────────────────────────────────┐
│  System Prompt:                             │
│  - Agent 角色描述                            │
│  - 学习者上下文                              │
│  - 工具目录（SearchKnowledge, WebSearch,    │
│    ValidateProblem, AnalyzeCode...）        │
│  - ReAct 回复格式说明                        │
└──────────────────┬──────────────────────────┘
                   ↓
         ┌─── 第 1 轮 ───┐
         │  调用 LLM      │
         │  ↓             │
         │  解析响应:     │
         │  Thought: ...  │  → 思维链活动 (thinking)
         │  Action: SearchKnowledge[数组]  │  → 思维链活动 (tool_call)
         │  ↓             │
         │  执行工具      │  → 思维链活动 (tool_result)
         │  Observation:  │
         │  数组是...     │
         └───┬───────────┘
             ↓ (Observation 加入对话历史)
         ┌─── 第 2 轮 ───┐
         │  调用 LLM      │
         │  (带上一轮的   │
         │   Observation) │
         │  ↓             │
         │  Thought: ...  │  → 思维链活动 (thinking)
         │  Action: Finish[最终回答]  │
         │  ↓             │
         │  流式输出给用户 │  → onToken 回调
         └───────────────┘
```

#### 思维链展示

每轮 ReAct 迭代在思维链中生成 3 类活动：

```
[讲师 · Socratic]
  ├─ 加载技能：苏格拉底教学法
  ├─ 读取知识库（3 个相关知识点）
  ├─ 🤔 第 1 轮推理中…                        ← thinking 活动
  │     Thought: 用户想了解数组，我先查知识库获取准确定义
  ├─ 🎬 行动: SearchKnowledge[数组]            ← tool_call 活动
  │     👀 观察: 数组是一种线性数据结构...      ← tool_result 活动
  ├─ 🤔 第 2 轮推理中…                        ← thinking 活动
  │     Thought: 知识库信息充足，可以给出讲解了
  └─ 🎉 最终回答                               ← onToken 流式输出
```

#### 各 Agent 可用工具

| Agent | 可用工具 | 说明 |
|---|---|---|
| 讲师 (lecturer) | `SearchKnowledge`, `WebSearch` | 查知识库和网络获取准确信息 |
| 出题官 (problem_setter) | `SearchKnowledge`, `SearchProblems`, `WebSearch`, `ValidateProblem` | 查知识点、参考已有题目、验证生成的题目 |
| 考官 (examiner) | `AnalyzeCode`, `SearchKnowledge` | 分析代码复杂度、查相关知识 |
| 规划师 (path_planner) | `SearchKnowledge`, `LearningPath` | 查知识体系、生成学习路径 |

#### 工具列表

| 工具名（LLM 看到的） | 注册名 | 功能 |
|---|---|---|
| `SearchKnowledge` | `search_knowledge` | 搜索本地算法知识库 |
| `SearchProblems` | `search_problems` | 按知识点搜索题库 |
| `WebSearch` | `web_search` | DuckDuckGo 网络搜索 |
| `ValidateProblem` | `validate_problem` | 验证题目 JSON 结构质量 |
| `AnalyzeCode` | `analyze_code` | 静态分析 Python 代码 |
| `LearningPath` | `learning_path` | 生成结构化学习路径 |
| `Finish` | — | 结束循环，输出最终回答 |

#### 核心函数

- **`buildToolDeclaration(toolNames, mode)`**：生成工具目录文本，追加到 system prompt。包含工具列表、回复格式说明、模式特定提示。
- **`parseReActResponse(text)`**：解析 LLM 响应为 `{ thought, toolName, args, isFinish }`。如果未找到 Action 格式，将整个响应视为 Finish。
- **`executeToolForReAct(toolName, args, context)`**：执行单个工具调用，返回 `{ observation, success }`。
- **`callLLMStep(...)`**：非流式 LLM 调用，捕获 `reasoning_content` 并作为 thinking 活动发出。
- **`runReActLoop(...)`**：核心循环。调用 LLM → 解析 → 执行工具 → 添加 Observation → 重复，直到 Finish 或达到最大轮次（8 轮）。

#### 安全网机制

practice 模式下，LLM 可能在 ReAct 循环中已经调用了 `ValidateProblem`。循环结束后，代码仍执行 `quickValidate` 作为安全网：
- 如果通过 → 直接使用
- 如果未通过 → 调用 `validateAndRepairProblem` 尝试一次修复
- 修复仍失败 → 降级到本地题库

#### 优雅降级

- **LLM 不遵循 ReAct 格式**：`parseReActResponse` 将整个响应视为 Finish，直接输出给用户
- **工具不存在**：返回错误 Observation，LLM 可以看到错误并调整策略
- **API 调用失败**：`callLLMStep` 回退到 `callLLMStreaming` 流式调用
- **达到最大轮次**：强制要求 LLM 给出最终回答

## 多智能体顺序编排

当用户请求包含多个意图时（如"先讲解数组，再出一道题"），由总控 Agent 通过 LLM 推理完成意图分解，再启动多步编排流程。

### 总控 Agent 外交：LLM 意图分解（decomposeWithLLM）

多意图识别**不由前端 UI 做关键字匹配**，而是由总控 Agent 调用一次非流式 LLM 完成。这符合"外交（Diplomacy）"设计：总控作为唯一调度中枢，理解复杂请求、判断歧义、生成执行计划。

`decomposeWithLLM()` 的输入与输出：

- **输入**：当前对话历史、学习者状态、上下文
- **输出**：`OrchestratorPlan`
  - `analysis`：对用户请求的分析
  - `requiresClarification`：是否需要澄清
  - `clarificationQuestion`：需要澄清时的问题
  - `intents`：识别出的所有意图及置信度
  - `plan`：`AgentStep[]` 执行计划序列

### 设计原则

1. **总控负责理解**：关键字匹配只能覆盖固定模式，而 LLM 能理解同义、隐含、多意图请求
2. **歧义时主动澄清**：对于"发给他"这类模糊输入，总控不猜测，直接追问
3. **失败回退**：若 LLM 分解失败，系统回退到单步规则路由（`inferMode`）
4. **计划即契约**：每个 `AgentStep` 明确指定 `agent`、`mode`、`task`、`usePrevContext`

### 顺序编排流程（streamBrowserLLMMultiStep）

```
用户输入: "先给我讲解一下数组，再出一道相关的题"
  │
  ├─ decomposeWithLLM() → OrchestratorPlan
  │    ├─ analysis: "用户有两个意图：了解数组概念 + 获得数组练习题"
  │    ├─ requiresClarification: false
  │    └─ plan: [
  │         {agent: 'lecturer', mode: 'chat', task: '讲解数组...', usePrevContext: false},
  │         {agent: 'problem_setter', mode: 'practice', task: '基于数组出题...', usePrevContext: true}
  │       ]
  │
  ├─ 总控: emit onActivity('多步任务计划: 1.讲师(chat) → 2.出题官(practice)')
  │
  ├─ Step 1: 讲师 Agent
  │    ├─ emit agent_start('讲师 · 第1步/2')
  │    ├─ emit skill_load('苏格拉底教学法')
  │    ├─ emit knowledge_read('数组知识点')
  │    ├─ emit thinking('讲师 · Socratic 推理中…')
  │    ├─ LLM 流式调用 → onToken 逐字推送
  │    ├─ emit agent_end('讲师完成第1步')
  │    └─ 输出存为 prevOutput
  │
  ├─ 总控: emit onActivity('第1步完成，传递上下文给第2步')
  │
  ├─ Step 2: 出题官 Agent
  │    ├─ emit agent_start('出题官 · 第2步/2')
  │    ├─ emit skill_load('出题方法论')
  │    ├─ 构建 prompt: task + prevOutput（上游讲解作为参考上下文）
  │    ├─ emit thinking('出题官 · Plan-and-Solve 推理中…')
  │    ├─ LLM 流式调用 → onToken 逐字推送
  │    ├─ emit validate('验证题目结构')
  │    └─ emit agent_end('出题官完成第2步')
  │
  ├─ 总控: emit onActivity('多步任务全部完成')
  │
  └─ 合并所有步骤输出 → 返回 ChatResponse
```

### 上下文传递机制

每个 Agent 使用**隔离上下文**（fresh conversation），上游 Agent 的输出通过 prompt 注入传递给下游：

```typescript
// Step 2 的用户消息构建
let userContent = step.task;
if (step.usePrevContext && prevOutput) {
  userContent += '\n\n---\n\n## 上一个 Agent 的输出（作为参考上下文）\n\n' + prevOutput;
}
```

这确保了：
- 下游 Agent 能看到上游的讲解内容来出相关题目
- 每个 Agent 的系统提示词互不干扰
- Token 效率高（只传必要内容，不传整个对话历史）

### 多步消息独立展示

多步编排的结果**不会合并为一条消息**，而是每个 Agent 的输出作为独立消息气泡展示：

```
用户："先给我讲解一下数组，再出一道相关的题"

┌─────────────────────────────────┐
│ [讲师·Socratic]  14:32          │ ← 独立消息，绿色边框+头像
│ 数组，本质上就是内存里的「一排快递柜」...  │
│ ◇ 思考过程 5步 · 2.3s            │ ← 讲师自己的思维链
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ [出题官·Plan-and-Solve]  14:32  │ ← 独立消息，黄色边框+头像
│ 好的，我为你准备了一道 arrays 练习题： │
│ ### 移除元素                     │
│ ...                              │
│ ◇ 思考过程 4步 · 1.8s            │ ← 出题官自己的思维链
└─────────────────────────────────┘
```

每个消息气泡带有：
- 对应 Agent 的像素头像和彩色边框
- Agent 名称 + 推理范式标签（带颜色背景）
- 该 Agent 独立的思维链（可展开查看推理过程）

### 严格职责边界

系统提示词中明确定义每个 Agent 的职责边界，防止越权：

| Agent | 可以做 | 严禁做 |
|---|---|---|
| 讲师 | 讲解概念、引导提问、解释原理 | 出练习题、出完整算法题（不能有输入输出示例、约束条件） |
| 出题官 | 生成练习题、校验题目质量 | 讲解知识点（应引用上一步讲师的内容） |
| 考官 | 评估代码、给出改进建议 | 直接重写代码给学生抄 |
| 规划师 | 制定学习路径、推荐知识点顺序 | 具体讲解知识点内容 |

## 工具调用方式

所有 Agent 均采用 ReAct 模式（见上方"ReAct 引擎"章节）。代码不再根据模式自动调用工具，而是将工具目录声明在 system prompt 中，由 LLM 自主决定何时调用。

| 模式 | LLM 可用工具 | 说明 |
|---|---|---|
| `chat` | `SearchKnowledge`, `WebSearch` | LLM 自主决定是否查知识库或网络 |
| `practice` | `SearchKnowledge`, `SearchProblems`, `WebSearch`, `ValidateProblem` | LLM 查知识点、参考题目、生成后验证 |
| `review` | `AnalyzeCode`, `SearchKnowledge` | LLM 分析代码、查相关知识 |
| `plan` | `SearchKnowledge`, `LearningPath` | LLM 查知识体系、生成路径 |

旧方案中代码驱动的 `detectAndCallSearchTools()`、模式自动调用 `analyze_code`/`learning_path` 均已移除，由 ReAct 循环统一替代。

## 意图识别（inferMode）

优先级从高到低：

1. **斜杠命令**：`/practice` → practice，`/plan` → plan，`/hint` → review
2. **代码上下文**：`context.code` 存在 → review
3. **自然语言关键词**：
   - `PRACTICE_KEYWORDS`：出题、出一道、来一道、练习题、给我题、刷题、算法题、考考我、挑战、练一练...
   - `PLAN_KEYWORDS`：学习计划、学习路径、学习路线、规划、怎么学、学习建议...
   - `HINT_KEYWORDS`：提示、给个提示、卡住了、不会做、思路、点拨...
4. **默认**：chat（讲师讲解）

## 系统提示词设计要点

- **苏格拉底教学法**：禁止直接给答案，用引导性问题帮助学生发现
- **中文回复**：所有 Agent 统一使用中文
- **格式规范**：Markdown 输出，代码块指定语言
- **降级处理**：API 不可用时返回友好错误提示
- **题目格式**：必须包含 title、description、examples、constraints、starterCode、testCases、hints、solution 字段
