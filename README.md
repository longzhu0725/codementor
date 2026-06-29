# CodeMentor

多智能体 AI 算法导师系统 —— 像拥有一支专属教学团队。

## 核心特性

- **多智能体协作辅导**：讲师、出题官、考官、规划师 4 个专业 Agent 分工协作，总控调度
- **透明化思维链**：每个 Agent 的思考过程、技能加载、工具调用、验证步骤实时可见（类似 Claude Code / Trae 的活动追踪），完成后可折叠回顾
- **流式输出**：AI 回答逐字流式渲染，带光标效果，无需等待完整响应
- **苏格拉底式教学**：五级渐进式提示，引导学生自己发现答案而非直接给解
- **浏览器端代码执行**：Pyodide (WASM) 实现 Python 即时运行，支持二叉树/链表等复杂数据结构，零后端依赖
- **自动数据结构适配**：测试输入自动转换为 ListNode / TreeNode，返回值自动序列化回列表，支持 LeetCode 层序表示法（含 `null`）
- **题目质量校验**：出题官生成题目后自动校验结构完整性与测试用例正确性，不合格则降级到本地题库
- **个性化学习路径**：基于 BKT 掌握度模型 + SM-2 间隔重复算法
- **工具系统**：代码静态分析、学习路径生成、知识库查询
- **Skill 扩展机制**：内置教学技能 + 自定义技能，支持关键词与命令触发
- **多会话管理**：创建、切换、删除会话，学习状态本地持久化
- **像素风 UI**：复古游戏风格界面，Press Start 2P 字体 + CRT 扫描线效果
- **自然语言意图识别**：支持中文关键词识别（如"出一道二叉树题"自动进入练习模式）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + React 19 + TypeScript + TailwindCSS v4 |
| UI 组件 | 像素风自定义组件（ChatPanel、PracticeWorkbench、Dashboard 等） |
| 代码执行 | Pyodide v0.27.2 (WebAssembly Python 3.12) |
| Agent 编排 | 自研多 Agent 循环 + 流式 SSE |
| LLM | 火山引擎 Ark / OpenAI / Anthropic / 自定义端点（用户自选） |
| 持久化 | localStorage（客户端本地存储） |
| 部署 | Vercel（支持 API 路由） |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 使用说明

### 演示模式
无需配置 API Key，提供基于预设模板的演示响应，可测试 UI 与基础流程。

### 完整模式
在设置中配置火山引擎 / OpenAI / Anthropic API Key，获得完整 AI 导师体验：
- 流式输出 + 透明思维链
- 个性化苏格拉底式引导
- 基于掌握度的自适应练习题生成
- 深度代码评估（含静态分析工具调用）
- 动态学习路径规划
- 题目自动质量校验

### 斜杠命令

| 命令 | 说明 | 触发 Agent |
|---|---|---|
| `/practice` | 开始算法练习 | 出题官 |
| `/plan` | 生成学习计划 | 规划师 |
| `/hint` | 请求提示 | 讲师（苏格拉底式） |
| `/find <知识点>` | 搜索知识库 | 总控 |
| `/problems <主题>` | 搜索相关题目 | 出题官 |
| `/path <目标>` | 生成学习路径 | 规划师 |

### 自然语言触发
无需斜杠命令，直接输入自然语言即可：
- "出一道二叉树的题目" → 练习模式
- "帮我制定一个面试算法学习计划" → 规划模式
- "我卡住了，给个提示" → 提示模式
- "什么是动态规划" → 讲师讲解

### 练习台操作
1. 进入练习模式后，右侧会出现代码编辑器
2. 题目以 Markdown 格式展示，包含描述、示例、约束、提示
3. 在编辑器中编写 Python 代码（类定义如 `TreeNode`/`ListNode` 已预置在 starter code 中）
4. 点击「运行」执行第一个示例输入，查看输出
5. 点击「提交」运行所有测试用例（含隐藏用例），自动判题

## 项目结构

```
src/
├── types/index.ts                     # TypeScript 类型定义（AgentMessage、ChatResponse、AgentActivity 等）
├── lib/
│   ├── agents/
│   │   ├── definitions.ts             # 4 个子 Agent 的系统提示词、工具、模型配置
│   │   └── orchestrator.ts            # 总控编排循环（意图识别 → Agent调度 → 状态更新）
│   ├── knowledge/
│   │   ├── topics.ts                  # 15 个算法知识点定义
│   │   └── problems.ts                # 15 道精选本地题目（含测试用例）
│   ├── skills/
│   │   ├── registry.ts                # 内置教学技能注册表
│   │   └── manager.ts                 # 自定义技能 CRUD + localStorage 持久化
│   ├── tools/
│   │   └── registry.ts                # 工具注册表（analyze_code、learning_path 等）
│   ├── memory/
│   │   └── learner-state.ts           # 学习者状态 + BKT/SM-2 算法
│   ├── sessions/
│   │   └── manager.ts                 # 多会话管理
│   ├── problem-validator/
│   │   └── index.ts                   # 题目结构校验（必填字段、测试用例数量等）
│   ├── problem-history/
│   │   └── manager.ts                 # 做题历史记录
│   ├── llm/
│   │   ├── browser-client.ts          # 浏览器端流式 LLM 调用（SSE）+ 活动追踪
│   │   └── client.ts                  # 服务端 LLM 客户端
│   └── hooks/
│       ├── useChat.ts                 # 聊天状态管理（消息、流式、活动、思维链）
│       └── useLearnerState.ts         # 学习者状态 Hook
├── components/
│   ├── ChatPanel.tsx                  # 聊天面板（含 ThinkingChain 思维链组件）
│   ├── PracticeWorkbench.tsx          # 练习台（代码编辑器 + 测试结果）
│   ├── PyodideRunner.ts              # Pyodide Worker 封装（代码执行 + 测试运行）
│   ├── PixelAvatar.tsx                # 像素头像（5 个角色）
│   ├── Sidebar.tsx                    # 侧边栏导航
│   ├── Dashboard.tsx                  # 学习仪表盘
│   ├── ResourceManager.tsx            # 技能/题目资源管理
│   └── SettingsModal.tsx              # API Key 设置弹窗
└── app/
    ├── page.tsx                       # 主页面（视图切换 + 状态编排）
    ├── layout.tsx                     # 全局布局
    ├── globals.css                    # 全局样式（像素风 + 动画）
    └── api/chat/route.ts              # 服务端 Chat API（演示模式 fallback）
```

## 架构要点

### 多 Agent 编排
`browser-client.ts` 中实现了浏览器端的 Agent Loop：
1. 总控（orchestrator）接收用户消息，识别意图
2. 根据意图派遣对应子 Agent（lecturer/problem_setter/examiner/path_planner）
3. 每个 Agent 开始前发出 `agent_start` 活动，结束后发出 `agent_end`
4. Agent 执行过程中记录所有活动：加载技能、读取知识库、调用工具、验证题目
5. 所有活动通过 `onActivity` 回调实时推送给 UI
6. 流式输出通过 `onToken` 回调逐字推送
7. 完成后将 activities 附加到 assistant 消息，支持历史回顾

### 透明思维链（ThinkingChain）
每条 AI 回复下方都带有一个可折叠的「思考过程」块：
- **生成中**：自动展开，显示旋转图标 + 当前执行步骤（如"验证题目结构与质量"）
- **完成后**：折叠为一行摘要 `◇ 思考过程 N步 · Xs`，点击展开查看详细步骤
- **步骤详情**：每步显示 Agent 标签（彩色）、步骤类型、操作描述、耗时；有 detail 的步骤可再次点击展开
- **历史消息**：每条回复独立保存自己的思维链，可随时回顾

### 代码执行引擎（PyodideRunner）
Web Worker 中运行 Pyodide，两套执行 Harness：

**RUN_HARNESS**（单步运行）：用于"运行"按钮，执行第一个示例
**TEST_HARNESS**（批量测试）：用于"提交"按钮，运行所有测试用例并判题

核心能力：
- 输入解析：`null` 自动替换为 `None`；支持单字面量、元组、逗号分隔多参数
- 自动类型适配：检测用户代码中是否定义了 `TreeNode`/`ListNode` 类，自动将扁平列表输入转换为对应对象
- 嵌套列表保护：二维数组（如 Flood Fill）不会被误转为树/链表
- 返回值序列化：TreeNode 序列化为层序列表（去除尾部 None）；ListNode 遍历为列表
- 空值归一化：数据结构题返回 `None` 视为空结构 `[]`
- 容错回退：TypeError/AttributeError 时自动用原始参数重试
- 链表安全：遍历增加 10000 步计数器防环

### 支持的数据结构

| 类型 | 输入格式 | 自动构建 | 返回序列化 |
|---|---|---|---|
| 基本类型 | `42`, `"hello"`, `True` | 直接传递 | 原值 |
| 列表/数组 | `[1,2,3]` | 直接传递（无数据结构类时） | JSON 列表 |
| 多参数 | `[2,7,11,15], 9` | 拆包为位置参数 | - |
| 链表 | `[1,2,3,4,5]` | ListNode 链式结构 | 遍历为列表 |
| 二叉树 | `[4,2,7,1,3,6,9]`（层序） | BFS 构建 TreeNode | BFS 序列化为层序列表 |
| 二叉树（含空节点） | `[3,9,20,null,null,15,7]` | null → None → 空节点 | 自动去除尾部 None |
| 二维数组 | `[[1,1,1],[1,1,0]]` | 直接传递（嵌套列表不转） | JSON 嵌套列表 |
| 空树/空链表 | `[]` | None | [] |

### 题目质量校验
`problem-validator/index.ts` 在出题官生成题目后执行校验：
- 必填字段检查（title、description、testCases、starterCode、solution 等）
- 测试用例数量检查（至少 2 个）
- starterCode 中必须包含函数定义
- 错误分级：error（致命，拒绝使用）/ warning（警告，可使用）
- 校验失败自动降级到本地题库，并通知用户

### 意图识别
`useChat.ts` 中的 `inferMode` 函数：
1. 斜杠命令优先（`/practice`、`/plan`、`/hint`）
2. 代码提交上下文（有 code 参数 → review 模式）
3. 自然语言关键词匹配（中文 + 英文）
   - PRACTICE_KEYWORDS：出题、出一道、来一道、练习题、刷题...
   - PLAN_KEYWORDS：学习计划、学习路径、规划、怎么学...
   - HINT_KEYWORDS：提示、卡住了、不会做、思路...

## 文档

详细技术文档见 [`docs/`](./docs/) 目录：
- [架构设计](./docs/architecture.md)
- [代码执行引擎](./docs/pyodide-runner.md)
- [Agent 系统](./docs/agents.md)
- [测试用例与验证](./docs/testing.md)

## 隐私说明

- API Key 仅保存在浏览器 localStorage，不会上传到任何服务器
- 学习者状态全部存储在本地，不上传后端
- 代码在浏览器端 Pyodide (WebAssembly) 中执行，不发送到外部服务器
- 完整模式下消息仅发送到用户配置的 LLM 端点

## 许可证

MIT
