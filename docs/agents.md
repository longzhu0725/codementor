# Agent 系统

## 多智能体架构

CodeMentor 采用**总控-专家**模式的多 Agent 架构，由一个总控（Orchestrator）根据用户意图派遣不同的专家 Agent 处理任务。

```
                    ┌─────────────┐
                    │     用户    │
                    └──────┬──────┘
                           │ 消息
                           ↓
                    ┌─────────────┐
                    │  Orchestrator│  ← 总控：意图识别 + 调度
                    │   (总控)     │
                    └──┬───┬───┬──┘
                       │   │   │
          ┌────────────┘   │   └────────────┐
          ↓                ↓                 ↓
   ┌────────────┐  ┌────────────┐   ┌────────────┐   ┌────────────┐
   │  Lecturer  │  │ Problem    │   │  Examiner  │   │   Path     │
   │  (讲师)    │  │ Setter     │   │  (考官)    │   │  Planner   │
   │            │  │ (出题官)   │   │            │   │ (规划师)   │
   └────────────┘  └────────────┘   └────────────┘   └────────────┘
```

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
interface AgentActivity {
  id: string;           // 唯一 ID
  agent: AgentRole;     // 哪个 Agent
  type: AgentActivityType;
  label: string;        // 简短描述，如"加载苏格拉底教学法"
  detail?: string;      // 详细信息（可展开查看）
  status?: 'running' | 'success' | 'warning' | 'error';
  durationMs?: number;  // 耗时（完成后）
  timestamp: number;
}
```

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
  │    └─ emit onToken(delta)  → UI 逐字渲染
  │
  ├─ emit onActivity({type: 'validate', label: '校验题目结构'})
  ├─ emit onActivity({type: 'agent_end'})
  │
  └─ resolve(ChatResponse)
```

## 工具自动调用

在 Agent 调用 LLM 之前，系统会根据模式自动调用相关工具，将结果注入到提示词中：

| 模式 | 自动调用工具 | 注入内容 |
|---|---|---|
| `practice` | `find_topic` + `validate` | 知识点详情 + 题目校验结果 |
| `review` | `analyze_code` | 代码静态分析结果（复杂度、潜在问题） |
| `plan` | `learning_path` | 结构化学习路径（里程碑、知识点序列） |
| `chat` | `find_topic`（按需） | 相关知识点内容 |

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
