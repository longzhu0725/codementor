# Agent 系统

## 多智能体架构

CodeMentor 采用 **Hierarchical Delegation（层级委派）** 模式的多 Agent 架构。由一个总控（Orchestrator）根据用户意图派遣不同的专家 Agent 处理任务，总控在执行过程中持续参与，可基于中间结果动态调整计划。每个 Agent 采用适合其角色的推理范式，让思维过程透明可见。

```
                    ┌─────────────┐
                    │     用户    │
                    └──────┬──────┘
                           │ 消息
                           ↓
                    ┌─────────────┐
                    │  Orchestrator│  ← 总控：Plan-and-Execute 范式
                    │   (总控)     │    规划→执行→再规划→综合
                    └──┬───┬───┬──┘
                       │   │   │     ↑ 每步完成后评估是否调整计划
          ┌────────────┘   │   └────────────┐
          ↓                ↓                 ↓
   ┌────────────┐  ┌────────────┐   ┌────────────┐   ┌────────────┐
   │  Lecturer  │  │ Problem    │   │  Examiner  │   │   Path     │
   │ (ReAct+CoT)│  │ Setter     │   │(Reflexion) │   │ Planner    │
   │  (讲师)    │  │(Plan+Refl) │   │  (考官)    │   │(Plan-Exec) │
   │            │  │ (出题官)   │   │            │   │ (规划师)   │
   └────────────┘  └────────────┘   └────────────┘   └────────────┘
```

## 智能体推理范式

每个 Agent 采用最适合其角色的推理范式，system prompt 中描述的范式与代码中实际执行的逻辑完全一致。用户可在对话框中展开查看每个 Agent 的思考过程。

| 智能体 | 范式 | 核心思想 | 思维链展示内容 |
|---|---|---|---|
| **Orchestrator（总控）** | **Plan-and-Execute** | 规划→执行→再规划→综合的层级委派 | 分析意图→生成计划→每步完成后评估→必要时调整剩余计划→综合结果 |
| **Lecturer（讲师）** | **ReAct+CoT** | 工具调用循环+结构化教学推理 | 判断是否需要查知识库→调用工具获取信息→CoT组织教学→苏格拉底式提问输出 |
| **Problem Setter（出题官）** | **Plan-and-Execute+Reflexion** | 规划出题→生成→验证→反思修复 | 分析需求→查参考题目→规划题目结构→生成→验证→失败时反思修复 |
| **Examiner（考官）** | **Reflexion** | 评估→反思→改进的迭代优化 | 初步评估→反思遗漏点→改进建议针对性→最终评分与建议 |
| **Path Planner（规划师）** | **Plan-and-Execute** | 评估现状→确定目标→拓扑排序→输出 | 查知识体系→评估掌握度→拓扑排序→里程碑划分→输出路径 |

### 范式选型依据

| 范式 | 为什么适合这个角色 |
|---|---|
| **Plan-and-Execute（总控）** | 总控的核心是宏观编排：先规划全局，执行中根据结果动态调整。比 ReAct 更适合，因为总控的任务是编排而非逐步反应 |
| **ReAct+CoT（讲师）** | 讲师需要用 ReAct 调工具获取准确信息，再用 CoT 组织结构化教学推理。苏格拉底法是教学方法论层，ReAct+CoT 是执行引擎层 |
| **Plan-and-Execute+Reflexion（出题官）** | 出题需要先规划结构再生成（Plan-and-Execute），验证失败后反思并修复（Reflexion）。validateAndRepairProblem 已实现 Reflexion 雏形 |
| **Reflexion（考官）** | 考官的核心就是评估→反思→改进的迭代循环。先初步评估，再反思遗漏，最后改进输出 |
| **Plan-and-Execute（规划师）** | 规划师就是评估现状→确定目标→拓扑排序→里程碑划分→输出路径，纯粹的规划-执行流程 |

## Agent 角色定义

### Orchestrator（总控）
- **职责**：意图识别、任务调度、执行间再规划、结果综合
- **范式**：Plan-and-Execute（层级委派）
- **触发**：所有用户消息首先经过总控
- **活动类型**：`agent_start/end`、`thinking`
- **三阶段流程**：
  1. **Phase 1 — 规划（Plan）**：`decomposeWithLLM` 分析意图，生成执行计划
  2. **Phase 2 — 执行与再规划（Execute & Re-plan）**：逐步执行，每步完成后调用 `orchestratorRePlan` 评估是否需要调整剩余计划
  3. **Phase 3 — 综合（Synthesize）**：收集所有结果，综合输出
- **再规划机制**：`orchestratorRePlan()` 在每步完成后调用 LLM 评估：
  - 结果符合预期 → 继续原计划
  - 需要调整 → 替换剩余步骤（如讲解方向变了，出题任务描述需要更新）
  - 评估失败 → 保持原计划（优雅降级）

### Lecturer（讲师）
- **职责**：知识点讲解、苏格拉底式引导、答疑
- **范式**：ReAct+CoT（工具调用循环 + 结构化教学推理）
- **触发模式**：`chat`、`review`（hint 请求）
- **加载技能**：苏格拉底教学法（socratic-teaching）
- **ReAct 层**：通过 `SearchKnowledge`、`WebSearch` 工具获取准确信息
- **CoT 层**：获得信息后用思维链组织教学（诊断→设计→呈现）
- **教学方法论**：苏格拉底式五级渐进式提示
  1. 方向性提示 → 2. 关键思路 → 3. 关键步骤 → 4. 伪代码 → 5. 完整解答

### Problem Setter（出题官）
- **职责**：生成练习题、题目质量校验、验证失败时反思修复
- **范式**：Plan-and-Execute+Reflexion
- **触发模式**：`practice`
- **加载技能**：problem-generation（出题方法论）
- **可用工具**：`SearchKnowledge`、`SearchProblems`、`WebSearch`、`ValidateProblem`
- **工作流程**：
  1. **Plan**：查参考题目 → 规划题目结构
  2. **Execute**：生成完整题目 JSON
  3. **Reflexion**：`ValidateProblem` 验证 → 失败时反思 → `validateAndRepairProblem` 自动修复 → 再验证
  4. 安全网：代码层 `quickValidate` 最终检查，失败降级到本地题库

### Examiner（考官）
- **职责**：代码评估、错误分析、改进建议
- **范式**：Reflexion（评估→反思→改进的迭代优化）
- **触发模式**：`review`（代码提交后）
- **加载技能**：code-review（代码评审方法论）
- **可用工具**：`AnalyzeCode`、`SearchKnowledge`
- **Reflexion 三轮循环**：
  1. **第一轮（初步评估）**：`AnalyzeCode` 分析 → 四维度打分
  2. **第二轮（反思）**：反思遗漏的边界情况、复杂度准确性、建议可操作性
  3. **第三轮（改进输出）**：基于反思更新评估，给出具体改进方案
  - 边界情况覆盖
  - 改进建议

### Path Planner（规划师）
- **职责**：制定个性化学习路径
- **触发模式**：`plan`
- **加载技能**：learning-path（路径规划方法论）
- **使用工具**：`learning_path`（结构化路径生成，支持面试/竞赛/入门/课程目标参数）
- **考虑因素**：
  - 学习者当前水平（掌握度向量）
  - 目标群体（竞赛/面试/自学/学生）
  - 知识点依赖关系（拓扑排序）
  - SM-2 间隔重复调度
- **输出格式**：结构化 Markdown（当前状态评估 → 里程碑组织路径 → 优先复习项 → 下一步建议）
- **结构化持久化**：LLM 输出经 `parseLearningPlan()` 解析为 `LearningPlan` 结构，持久化到 `LearnerState.learningPlan`
- **进度跟踪**：用户提交代码后自动调用 `updateMilestoneProgress()` 更新里程碑完成状态
- **仪表盘展示**：Dashboard 展示 AI 学习计划，含总进度条、里程碑卡片、知识点掌握标签（✅已掌握/🔧需巩固/📖待学习）

## Agent 活动类型（AgentActivity）

每个 Agent 在执行过程中产生的活动通过 `AgentActivity` 结构记录，实时推送到 UI。活动类型按范式分组：

### 通用活动

| type | 含义 | 触发时机 |
|---|---|---|
| `agent_start` | Agent 启动 | Agent 开始处理任务 |
| `agent_end` | Agent 完成 | Agent 任务结束 |
| `skill_load` | 加载教学技能 | Agent 加载对应的方法论技能 |
| `knowledge_read` | 读取知识库 | 查询 topics.ts 中的知识点 |
| `tool_call` | 调用工具 | 直接工具调用（非ReAct路径） |
| `tool_result` | 工具返回 | 工具执行完成 |
| `thinking` | 通用思考 | 未归类到范式活动的推理过程 |
| `error` | 错误/降级 | 发生错误或触发降级 |

### Plan-and-Execute 编排活动（总控/规划师）

| type | 含义 |
|---|---|
| `plan_created` | 总控生成执行计划 |
| `plan_assess` | 评估学习者现状 |
| `plan_structure` | 组织输出结构 |
| `plan_step_start` | 计划步骤开始执行 |
| `plan_step_done` | 计划步骤完成 |
| `plan_replan` | 总控重新规划 |

### ReAct 推理-行动活动（讲师工具调用）

| type | 含义 |
|---|---|
| `react_thought` | Thought：推理思考 |
| `react_action` | Action：决定调用工具（含 toolName/toolArgs） |
| `react_observation` | Observation：工具返回结果 |

### CoT 教学思维链活动（讲师）

| type | 含义 |
|---|---|
| `cot_diagnose` | 诊断学生卡点和理解水平 |
| `cot_design` | 设计苏格拉底式引导路径 |
| `cot_present` | 组织教学呈现内容 |

### Reflexion 反思评估活动（考官）

| type | 含义 |
|---|---|
| `reflexion_evaluate` | 评估提交代码正确性 |
| `reflexion_critique` | 自我批判/反思评估质量 |
| `reflexion_verdict` | 给出判定/分数（含 score 0-100） |
| `reflexion_feedback` | 输出改进建议 |

### Plan-and-Execute+Reflexion 出题活动（出题官）

| type | 含义 |
|---|---|
| `pe_plan` | 规划题目参数（难度、类型、约束） |
| `pe_generate` | 生成题目内容 |
| `pe_validate` | 验证题目质量 |
| `pe_reflect` | 反思验证失败原因 |
| `pe_repair` | 修复题目缺陷 |
| `pe_complete` | 题目通过验证 |

活动结构：
```typescript
type AgentParadigm = 'Plan-and-Execute' | 'ReAct+CoT' | 'Plan-and-Execute+Reflexion' | 'Reflexion';

interface AgentActivity {
  id: string;
  agent: AgentRole;
  type: AgentActivityType;
  label: string;
  detail?: string;
  status?: 'running' | 'success' | 'warning' | 'error';
  durationMs?: number;
  timestamp: number;
  paradigm?: AgentParadigm;
  reactTurn?: number;        // ReAct 轮次
  reflexionTurn?: number;    // Reflexion 轮次
  cotStep?: 'diagnose' | 'design' | 'present';  // CoT 步骤
  peIteration?: number;      // PE+R 迭代次数
  score?: number;            // 评分 0-100
  planStep?: number;         // 计划步骤序号
  planTotal?: number;        // 计划总步数
  toolName?: string;         // 工具名
  toolArgs?: string;         // 工具参数摘要
}
```

### ThinkingChain 思维链UI组件（像素游戏风格）

思维链以内联方式展示在对话消息中，采用**像素游戏风格**设计：

- **范式专属可视化**：每个 Agent 使用对应范式的专属思维链组件，不再全部显示为 ReAct：
  - **总控/规划师**：`PlanTimeline` 像素时间线，显示评估→规划→执行进度条
  - **讲师**：`CoTChain`（诊断→设计→呈现三步像素管道）+ `ReActIteration`（工具调用轮次，可展开查看 Thought/Action/Observation）
  - **考官**：`ReflexionChain`（评估→反思→判定→反馈四步像素流程，含像素分数条）
  - **出题官**：`PEChain`（规划→生成→验证→反思→修复→完成像素管道，支持多轮修复迭代）
- **像素图标系统**：`PixelIcon` 组件为每种活动类型绘制 8x8 像素艺术图标（放大镜、齿轮、天平、菱形、扳手、星星等）
- **像素卡片样式**：`.pixel-card` 类提供硬阴影像素风格面板，`.pixel-mini-icon` 提供锐利像素渲染
- **工具调用标注**：工具调用显示像素齿轮图标 + 蓝色工具名标签 + 参数预览
- **实时流式更新**：运行中的步骤显示脉冲动画和 ▶ 播放指示器
- **可展开/折叠**：范式链默认折叠显示摘要进度，点击展开查看详细步骤
- **按 Agent 分组**：不同 Agent 用不同颜色的像素方块标签区分

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

CodeMentor 的所有 Agent 使用 **ReAct（Reasoning + Acting）** 作为底层工具调用引擎。LLM 作为"大脑"自主决定何时调用工具、调用哪个工具、如何利用工具返回的结果。代码只负责提供工具目录和执行 LLM 选择的动作。

**注意**：ReAct 是工具调用层（engine），而非唯一的认知范式。各 Agent 在 ReAct 引擎之上运行自己的推理范式，并在 UI 中展示对应的范式专属思维链：
- 讲师在 ReAct 循环结束后展示 CoT 教学思维链
- 考官在 ReAct 循环（分析代码）后展示 Reflexion 反思评估链
- 出题官在 ReAct 循环后展示 PE+R 生成验证修复链
- 非ReAct范式的Agent在UI中**不显示独立的ReAct卡片**，工具调用以内联像素标签形式展示在系统活动中

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

## 多智能体层级委派编排

当用户请求包含多个意图时（如"先讲解数组，再出一道题"），由总控 Agent 通过 Plan-and-Execute 范式完成意图分解、逐步执行、执行间再规划。

### Phase 1：规划（decomposeWithLLM）

多意图识别**不由前端 UI 做关键字匹配**，而是由总控 Agent 调用一次非流式 LLM 完成。

`decomposeWithLLM()` 的输入与输出：

- **输入**：当前对话历史、学习者状态、上下文
- **输出**：`OrchestratorPlan`
  - `analysis`：对用户请求的分析
  - `requiresClarification`：是否需要澄清
  - `clarificationQuestion`：需要澄清时的问题
  - `intents`：识别出的所有意图及置信度
  - `plan`：`AgentStep[]` 执行计划序列

### Phase 2：执行与再规划（streamBrowserLLMMultiStep）

```
用户输入: "先给我讲解一下数组，再出一道相关的题"
  │
  ├─ decomposeWithLLM() → OrchestratorPlan (Phase 1: 规划)
  │    ├─ analysis: "用户有两个意图：了解数组概念 + 获得数组练习题"
  │    └─ plan: [
  │         {agent: 'lecturer', mode: 'chat', task: '讲解数组...', usePrevContext: false},
  │         {agent: 'problem_setter', mode: 'practice', task: '基于数组出题...', usePrevContext: true}
  │       ]
  │
  ├─ 总控: emit onActivity('多步任务计划: 1.讲师(chat) → 2.出题官(practice)')
  │
  ├─ Step 1: 讲师 Agent (ReAct+CoT)
  │    ├─ emit agent_start('讲师 · 第1步/2')
  │    ├─ emit skill_load('苏格拉底教学法')
  │    ├─ runReActLoop:
  │    │    ├─ Thought: 需要查知识库 → Action: SearchKnowledge[数组]
  │    │    ├─ Observation: 数组是一种线性数据结构...
  │    │    └─ Thought: 信息充分 → Action: Finish[讲解内容]
  │    ├─ emit agent_end('讲师完成第1步')
  │    └─ 输出存为 prevOutput
  │
  ├─ 总控: orchestratorRePlan() (Phase 2: 再规划)
  │    ├─ 评估: "讲解内容覆盖了数组定义和基本操作，出题应聚焦数组遍历"
  │    ├─ shouldReplan: false（保持原计划，但确认了方向）
  │    └─ emit onActivity('总控评估通过，继续执行原计划')
  │
  ├─ Step 2: 出题官 Agent (Plan-and-Execute+Reflexion)
  │    ├─ emit agent_start('出题官 · 第2步/2')
  │    ├─ runReActLoop:
  │    │    ├─ Thought: 先查参考题目 → Action: SearchProblems[数组]
  │    │    ├─ Observation: 题库有5道数组题...
  │    │    ├─ Thought: 生成题目 → Action: Finish[题目JSON]
  │    │    └─ （安全网）quickValidate → validateAndRepairProblem
  │    ├─ emit agent_end('出题官完成第2步')
  │
  ├─ 总控: emit onActivity('多步任务全部完成') (Phase 3: 综合)
  │
  └─ 合并所有步骤输出 → 返回 ChatResponse
```

### 再规划机制（orchestratorRePlan）

每步完成后，总控调用 `orchestratorRePlan()` 评估是否需要调整剩余计划：

| 场景 | shouldReplan | 行为 |
|---|---|---|
| 结果符合预期 | false | 继续执行原计划 |
| 讲解方向偏了，出题需要调整 | true | 替换剩余步骤的任务描述 |
| 需要增加或删除步骤 | true | 修改剩余步骤列表 |
| 评估请求失败 | false | 优雅降级，保持原计划 |

再规划时总控 LLM 收到：已完成步骤的结果摘要 + 剩余计划。返回 JSON 指示是否调整。

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

所有 Agent 使用 ReAct 作为底层工具调用引擎（见上方"ReAct 引擎"章节），但各 Agent 在 ReAct 之上运行自己的认知范式。代码不再根据模式自动调用工具，而是将工具目录声明在 system prompt 中，由 LLM 自主决定何时调用。

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

## 学习计划功能

### 数据流

```
用户输入"学习计划" → inferMode 识别 'plan'
  → path_planner (Plan-and-Execute 范式)
    → plan_assess: 评估学习者现状
    → plan_structure: 组织路径结构
    → ReAct 循环: 调用 LearningPath[目标] 获取参考路径
    → 输出结构化 Markdown (里程碑组织)
  → parseLearningPlan(): 解析 Markdown → LearningPlan 结构
  → updateMilestoneProgress(): 根据掌握度更新里程碑状态
  → 持久化到 LearnerState.learningPlan (localStorage)
  → Dashboard 展示: 进度条 + 里程碑卡片 + 知识点标签
```

### LearningPlan 结构

```typescript
interface LearningPlan {
  goal: string;                    // 学习目标 (面试/竞赛/入门/课程/自学)
  targetGroup: 'competition' | 'student' | 'interview' | 'self_learner';
  duration: string;                // 预计周期 (如 "6 周")
  milestones: {                    // 里程碑列表 (3-4 个)
    title: string;                 // 里程碑标题
    topics: string[];              // 包含的知识点 ID
    estimatedTime: string;         // 预计时间 (如 "1-2 周")
    completed: boolean;            // 是否已完成 (所有知识点掌握度≥70%)
  }[];
  createdAt: number;               // 创建时间戳
  currentMilestone: number;        // 当前进行中的里程碑序号
}
```

### 关键文件

| 文件 | 职责 |
|---|---|
| `src/lib/memory/learning-plan-parser.ts` | Markdown → LearningPlan 解析器、里程碑进度更新、进度统计 |
| `src/lib/hooks/useChat.ts` | plan 模式完成后调用解析器并持久化到 LearnerState |
| `src/app/page.tsx` | 代码提交后自动更新里程碑进度 |
| `src/components/Dashboard.tsx` | AI 学习计划可视化（进度条、里程碑卡片、知识点标签） |
| `src/lib/tools/registry.ts` | learning_path 工具（支持 goal 参数筛选知识点） |
| `src/lib/agents/definitions.ts` | 规划师系统提示词（Plan-and-Execute 范式） |
| `src/lib/llm/browser-client.ts` | ReAct 循环中解析 LLM 传入的 goal 参数 |

### 进度跟踪机制

1. **创建计划**：用户请求学习计划 → LLM 生成 Markdown → `parseLearningPlan()` 解析为结构化数据 → 持久化
2. **自动更新**：用户提交代码 → `recordAttempt()` 更新掌握度 → `updateMilestoneProgress()` 更新里程碑状态
3. **里程碑完成判定**：里程碑内所有知识点掌握度 ≥ 70% → 标记为已完成
4. **仪表盘展示**：
   - 总进度百分比（已完成里程碑/总里程碑）
   - 里程碑卡片（已完成✅/当前进行🔵/待开始⚪）
   - 知识点标签（✅已掌握 ≥70% / 🔧需巩固 30-70% / 📖待学习 <30%）
   - 每个里程碑的知识点掌握进度条
