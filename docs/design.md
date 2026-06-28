# CodeMentor 设计文档

## 1. 产品概述

### 1.1 定位
多智能体 AI 算法导师系统

### 1.2 核心价值
- **多智能体协作辅导**：4 个专业 Agent 分工协作，像拥有一个教学团队
- **苏格拉底式教学**：分层渐进式提示，引导学生自己发现答案
- **个性化学习路径**：基于 BKT 掌握度模型 + SM-2 间隔重复算法
- **浏览器端代码执行**：Pyodide 实现 Python 代码即时运行，零后端依赖

### 1.3 目标用户
- 算法竞赛选手（NOI/CSP/ACM/ICPC）
- 计算机专业学生（数据结构与算法课程）
- 求职者/转码者（LeetCode/面试准备）
- 编程爱好者/自学者

### 1.4 技术栈
| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | Next.js 16 + React 19 + TailwindCSS v4 | iga-pages 原生支持 |
| 代码执行 | Pyodide (WASM) | 浏览器端 Python，零后端 |
| Agent 编排 | Vercel AI SDK + 工具调用 | Agent Loop + 子 Agent 工具 |
| LLM | OpenAI / Anthropic | 多模型支持，用户自选 |
| 持久化 | localStorage | 学习者状态客户端持久化 |
| 部署 | iga-pages | 一键部署 |

## 2. 架构设计

### 2.1 核心架构模式（借鉴 Claude Code）

```
用户交互 → 主协调 Agent（Agent Loop）
              ├─ 讲师 Agent（苏格拉底式引导）
              ├─ 出题 Agent（依赖感知选题）
              ├─ 考官审查 Agent（混合评估）
              ├─ 路径规划 Agent（BKT + SM-2）
              ├─ Skills 教学技能库（渐进式披露）
              ├─ 集中式学习者状态（单一写入者）
              └─ 持久化记忆（localStorage）
```

### 2.2 四层分离（Claude Code 架构精髓）

| 层 | 职责 | 实现 |
|---|---|---|
| Agent Loop | 推理决策，驱动教学流程 | `orchestrator.ts` 的 `generateText` + tools |
| 子 Agent 层 | 隔离上下文，专业化执行 | 4 个子 Agent 通过工具调用 |
| 工具/能力层 | 代码执行、知识查询、状态读写 | Pyodide、知识库、记忆系统 |
| Skills/记忆层 | 教学方法论 + 学习者状态 | Skills 注册表 + learner-state |

### 2.3 Agent Loop 工作流

```
1. 接收输入：用户消息 + 学习者状态 + 上下文
2. 意图识别：判断意图（答疑/练习/规划/复习）
3. 执行调度：通过工具调用子 Agent
4. 结果综合：收集子 Agent 自然语言返回
5. 状态更新：原子更新学习者状态（单一写入者）
6. 返回回复：面向学生的最终回复
```

## 3. 多智能体详细设计

### 3.1 主协调 Agent（Orchestrator）
- **角色**：教学策略协调者，不直接教学
- **工具**：4 个子 Agent 调用工具
- **约束**：单一写入者，唯一状态更新者
- **maxSteps**：6（防止无限循环）

### 3.2 讲师 Agent（Lecturer）
- **角色**：苏格拉底式引导者
- **五级渐进提示**：元认知 → 概念 → 策略 → 结构 → 定向
- **掌握度适配**：根据 mastery 值选择起始提示级别
- **核心 Skill**：`socratic-teaching`

### 3.3 出题 Agent（Problem Setter）
- **角色**：依赖感知选题者
- **选题策略**：40/50/10 法则（复习/成长区/挑战区）
- **约束**：前置依赖、防重复、多样性
- **核心 Skill**：`problem-generation`

### 3.4 考官审查 Agent（Examiner）
- **角色**：代码评估者
- **混合评估**：测试用例执行（客观）+ 语义审查（主观）
- **评估维度**：正确性、时间/空间复杂度、可读性、边界覆盖
- **核心 Skill**：`code-assessment`

### 3.5 路径规划 Agent（Path Planner）
- **角色**：学习路径设计者
- **算法**：BKT 掌握度模型 + SM-2 间隔重复
- **路径原则**：依赖优先、最近发展区、间隔复习
- **核心 Skill**：`learning-path`

### 3.6 Agent 间通信规则
1. 子 Agent 之间不能直接通信
2. 唯一信息通道：主 Agent → 子 Agent 的 prompt 字符串
3. 子 Agent 返回自然语言摘要
4. 子 Agent 不能更新学习者状态

## 4. Skills 系统

### 4.1 渐进式披露（借鉴 Claude Code）
- **Level 1**：元数据（name + description）始终加载
- **Level 2**：完整内容按需加载
- **Level 3**：参考资源深入加载

### 4.2 四个教学技能
| 技能 | 触发条件 | 注入内容 |
|---|---|---|
| socratic-teaching | 学生提问/卡住 | 五级渐进提示协议 |
| problem-generation | 练习模式 | 40/50/10 选题策略 |
| code-assessment | 代码提交 | 混合评估框架 |
| learning-path | 规划/复习 | BKT + SM-2 算法 |

## 5. 记忆系统

### 5.1 学习者状态（持久化）
- **掌握度向量**：BKT 算法更新
- **间隔重复调度**：SM-2 算法
- **错题记录**：错误类型、时间、是否已纠正
- **行为画像**：解题时长、提示使用率、连续学习天数
- **会话检查点**：最近 5 轮交互摘要

### 5.2 BKT 掌握度更新
```
P(known|correct) = P(known)*(1-slip) / [P(known)*(1-slip) + (1-P(known))*guess]
P(known|incorrect) = P(known)*slip / [P(known)*slip + (1-P(known))*(1-guess)]
```
- slip = 0.1, guess = 0.25, forgetRate = 0.05

### 5.3 SM-2 间隔重复
```
quality < 3: interval = 1
interval == 1: next = 1 day
interval == 2: next = 6 days
interval > 2: next = interval * EF
EF = max(1.3, EF + 0.1 - (5-q)*(0.08+(5-q)*0.02))
```

## 6. 知识库

### 6.1 算法知识图谱
14 个知识点，按依赖关系排序：
```
数组 → 哈希表 → 排序 → 二分查找 → 双指针
                             ↘ 递归 → 链表 → 栈与队列 → 树 → 图 → BFS/DFS → 回溯
                                                                   ↘ 贪心 → 动态规划
```

### 6.2 题库
6 道精选算法题，覆盖哈希表、二分查找、链表、动态规划、栈等知识点。

## 7. 代码执行

### 7.1 Pyodide 集成
- 通过 Web Worker 加载 Pyodide v0.27.2
- 支持 Python 代码执行和测试用例运行
- 超时保护（防止死循环）
- 测试结果包含通过/失败数量和详细信息

## 8. 文件结构

```
src/
├── types/index.ts                    # 全部 TypeScript 类型定义
├── lib/
│   ├── agents/
│   │   ├── definitions.ts            # 4 个子 Agent 定义 + 系统提示
│   │   └── orchestrator.ts           # 主 Agent Loop + 工具定义
│   ├── knowledge/
│   │   ├── topics.ts                 # 算法知识图谱（14 个知识点）
│   │   └── problems.ts              # 题库（6 道题）
│   ├── skills/registry.ts            # Skills 注册表 + 触发匹配
│   ├── memory/learner-state.ts       # 学习者状态 + BKT/SM-2 算法
│   ├── llm/client.ts                 # LLM 多模型客户端
│   └── hooks/
│       ├── useLearnerState.ts        # 学习者状态 React Hook
│       └── useChat.ts                # 聊天管理 React Hook
├── components/
│   ├── ChatPanel.tsx                 # 对话面板（含 Markdown 渲染）
│   ├── PracticeWorkbench.tsx         # 练习工作台（代码编辑器 + Pyodide）
│   ├── Dashboard.tsx                 # 学习仪表盘
│   ├── Sidebar.tsx                   # 侧边导航
│   ├── SettingsModal.tsx             # 设置弹窗
│   └── PyodideRunner.ts             # Pyodide 执行工具
└── app/
    ├── layout.tsx                    # 根布局
    ├── page.tsx                      # 主页面（整合所有组件）
    ├── globals.css                   # 全局样式
    └── api/chat/route.ts             # 聊天 API 路由
```

## 9. 使用说明

### 9.1 演示模式
无需配置 API Key 即可使用，提供基于预设模板的演示响应。

### 9.2 完整模式
在设置中配置 OpenAI 或 Anthropic API Key，获得完整的 AI 导师体验：
- 个性化苏格拉底式引导
- 基于掌握度的自适应练习题生成
- 深度代码评估
- 动态学习路径规划

### 9.3 快捷命令
- `/practice` - 开始练习
- `/plan` - 生成学习计划
- `/hint` - 请求提示
