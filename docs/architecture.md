# 架构设计

## 整体架构

CodeMentor 采用**浏览器端优先**的架构设计，所有核心逻辑（Agent 编排、代码执行、状态管理）均在客户端运行，最小化后端依赖。

```
┌─────────────────────────────────────────────────────────┐
│                      浏览器客户端                         │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   UI 层  │  │   状态层      │  │    Agent 层        │  │
│  │          │  │              │  │                   │  │
│  │ ChatPanel│←→│ useChat      │←→│ browser-client    │  │
│  │ Practice │  │ useLearner   │  │  (Agent Loop +    │  │
│  │ Dashboard│  │   State      │  │   Stream SSE)     │  │
│  │ Sidebar  │  │              │  │                   │  │
│  └──────────┘  └──────────────┘  └────────┬──────────┘  │
│                                           │             │
│  ┌──────────┐  ┌──────────────┐           │ LLM API     │
│  │ Pyodide  │  │  localStorage│  ┌────────▼──────────┐  │
│  │ (WASM    │  │  - sessions  │  │ 火山引擎/OpenAI/  │  │
│  │  Python) │  │  - skills    │  │ Anthropic         │  │
│  │          │  │  - learner   │  └───────────────────┘  │
│  └──────────┘  └──────────────┘                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
                         │
                  ┌──────▼──────┐
                  │ Next.js API │  (仅演示模式 fallback)
                  │   Route     │
                  └─────────────┘
```

## 核心模块关系

### 数据流

```
用户输入
  ↓
useChat.sendMessage(text, context)
  ↓
inferMode() 识别意图 (chat/practice/plan/review)
  ↓
browser-client.streamBrowserLLM()
  ├─ onActivity → liveActivities (实时活动更新)
  ├─ onToken    → streamingContent (流式文本)
  └─ onProblem  → currentProblem (题目解析)
  ↓
完成后:
  - assistant message 附加 activities → messages[]
  - 清空 liveActivities / streamingContent
  - 更新 learnerState
  ↓
ChatPanel 渲染:
  - MessageBubble (用户/助手消息)
  - ThinkingChain (内联思维链，消息下方)
  - StreamingBubble (流式输出时)
```

### 练习模式数据流

```
用户输入 /practice
  ↓
problem_setter Agent 生成题目
  ├─ skill_load: 加载出题方法论
  ├─ knowledge_read: 读取相关知识点
  ├─ thinking: 生成题目
  └─ validate: 校验题目质量
  ↓
题目通过 quickValidate() → 展示到 PracticeWorkbench
  ↓ (题目不通过则降级到本地题库)
用户在编辑器写代码
  ↓
点击"运行" → runCode(code, {functionName, sampleInput})
  → Pyodide Worker (RUN_HARNESS)
  → _parse_input → _adapt_arg (ListNode/TreeNode 转换)
  → 调用函数 → _serialize 返回值
  ↓
点击"提交" → runTestCases(code, testCases, functionName)
  → Pyodide Worker (TEST_HARNESS)
  → 遍历所有测试用例 → 判题 → 返回通过/失败详情
```

## 关键设计决策

### 1. 浏览器端 Agent 编排
选择在浏览器端直接调用 LLM API（而非通过后端代理），原因：
- API Key 本地存储，不经过第三方服务器
- 流式响应延迟更低（直连 LLM）
- 便于 Pyodide 在同一 Worker 线程中与 Agent 交互
- 部署简单，可静态托管

### 2. Web Worker 隔离 Pyodide
Pyodide 初始化（~15MB WASM + Python 标准库）和代码执行都在 Web Worker 中：
- 不阻塞主线程 UI
- 超时可通过 terminate Worker 强制中断
- 每次执行有独立的 Python 命名空间

### 3. 思维链内联设计
思维链（ThinkingChain）作为消息流的一部分内嵌在对话中，而非顶部横条：
- 每条消息独立携带自己的 activities，历史可追溯
- 生成时实时展开，完成后默认折叠（减少干扰）
- 视觉上用连接线+缩进，类似 Claude Code 的 thought trace
- 左侧圆点+竖线连接器，与头像列对齐

### 4. 数据结构自动适配
LeetCode 风格的题目用列表表示树/链表，但用户代码期望对象。采用**启发式自动检测**：
- 扫描用户代码中是否定义了 `TreeNode` 类（有 val/left/right）
- 扫描是否定义了 `ListNode` 类（有 val/next）
- 仅将扁平列表转换，嵌套列表（2D 数组）保持原样
- TreeNode 优先于 ListNode 匹配（因为 TreeNode 是 ListNode 的超集属性）
- 转换失败时自动回退到原始参数

### 5. 题目质量校验
AI 生成的题目可能存在各种问题（缺少测试用例、starter code 错误等），因此：
- 生成后立即执行结构校验
- 区分 error（致命）和 warning（可接受）
- 致命错误自动降级到本地精选题库，保证用户始终有题可练

## 目录职责

| 目录/文件 | 职责 | 关键导出 |
|---|---|---|
| `types/index.ts` | 全局类型定义 | `AgentMessage`, `AgentActivity`, `AlgorithmProblem`, `CodeExecutionResult` |
| `lib/agents/` | Agent 定义与编排 | `SUB_AGENTS`, orchestrator 逻辑 |
| `lib/llm/browser-client.ts` | 浏览器端流式 LLM | `streamBrowserLLM()`, 活动追踪 |
| `lib/hooks/useChat.ts` | 聊天状态管理 | `useChat()` hook |
| `lib/knowledge/` | 知识库与题库 | `PROBLEM_BANK`, `KNOWLEDGE_TOPICS` |
| `lib/tools/registry.ts` | 工具注册表 | 工具定义与调用 |
| `lib/skills/` | 技能系统 | 教学技能加载与管理 |
| `lib/memory/learner-state.ts` | 学习状态 | BKT + SM-2 算法 |
| `lib/problem-validator/` | 题目校验 | `quickValidate()` |
| `components/PyodideRunner.ts` | 代码执行引擎 | `runCode()`, `runTestCases()` |
| `components/ChatPanel.tsx` | 聊天 UI | `ChatPanel`, `ThinkingChain` |
| `components/PracticeWorkbench.tsx` | 练习台 | 代码编辑器 + 测试结果 |
