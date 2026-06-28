import { Skill } from '@/types';

// ============================================================
// Skills System - Teaching Methodologies
// Inspired by Claude Code's Skills: progressive disclosure,
// trigger matching, and methodology injection
// ============================================================

export const SKILLS: Skill[] = [
  {
    name: 'socratic-teaching',
    description:
      '苏格拉底式教学方法论。当学生提问概念、解题卡住需要提示时触发。通过分层渐进式提示引导学生自己发现答案，而非直接给出解答。',
    triggerKeywords: ['不会', '不懂', '怎么做', '为什么', '提示', '卡住', '想不通', '解释'],
    triggerCommands: ['/hint', '/explain'],
    content: `# 苏格拉底式教学方法论

## 核心原则
绝对不直接给出完整答案。通过提问引导学生自己推理出答案。

## 五级渐进式提示协议
根据学生掌握度(mastery)选择起始提示级别：

### Level 1 - 元认知提示（掌握度 > 0.6）
不涉及具体内容，引导学生反思：
- "你觉得你的代码哪里可能有问题？"
- "你检查过边界情况吗？"
- "这个算法的前提条件是什么？"

### Level 2 - 概念提示（掌握度 0.4-0.6）
关联相关概念，不指向具体代码：
- "二分查找要求数组有什么特性？"
- "递归需要哪两个要素？"
- "动态规划的本质是什么？"

### Level 3 - 策略提示（掌握度 0.2-0.4）
指明思考方向，不给具体代码：
- "检查一下你的循环终止条件"
- "想想中间值的更新逻辑"
- "考虑一下空间优化，能否用滚动数组？"

### Level 4 - 结构提示（掌握度 0.1-0.2）
定位到具体位置，给伪代码方向：
- "第12行的 mid 计算可能导致整数溢出"
- "你在更新 left/right 时少了 +1/-1"
- "这里应该用 dp[i] = max(dp[i-1]+nums[i], nums[i])"

### Level 5 - 定向提示（掌握度 < 0.1 或多次失败后）
给出接近答案的指导：
- "用 mid = left + (right - left) // 2 替代 (left+right)//2"
- "初始化时 dp[0] 应该等于 nums[0] 而不是 0"

## 提示升级规则
- 学生请求更多帮助时，提升一级
- 学生两次在同一级别后仍未理解，自动提升一级
- 学生明确要求答案时，先给思路框架再给关键代码片段

## 反馈规则
- 学生回答正确时，给予肯定并引导深入
- 学生回答错误时，不否定，而是用问题引导发现矛盾
- 始终追问 "为什么" 而非 "是不是"`,
  },
  {
    name: 'problem-generation',
    description:
      '练习题生成与选题方法论。当学生进入练习模式时触发。基于掌握度、学习目标和知识依赖关系选择或生成适合的题目。',
    triggerKeywords: ['练习', '做题', '出题', '挑战', '训练'],
    triggerCommands: ['/practice', '/exercise'],
    content: `# 练习题生成与选题方法论

## 选题策略：40/50/10 法则
题目选择权重分配：
- 40% 复习题：SM-2 间隔重复算法调度的到期题目
- 50% 成长区题目：掌握度在 0.3-0.7 之间的知识点
- 10% 挑战区题目：掌握度低于 0.3 的知识点（拓展边界）

## 约束条件
1. 前置依赖：必须先掌握前置知识点
2. 防重复：同一知识点 3 天内不重复出相同题型
3. 多样性：连续 3 题不来自同一知识点
4. 难度匹配：根据用户目标群体调整
   - 竞赛选手：侧重 4-5 星难度
   - 面试准备：侧重 2-4 星难度
   - 课程学习：按课程进度
   - 自学：按知识依赖顺序

## 出题格式
每道题包含：
- 题目描述（清晰、无歧义）
- 示例输入输出（至少 2 个）
- 约束条件
- 起始代码模板
- 测试用例（含隐藏用例）
- 分级提示（3 级，从抽象到具体）
- 参考解答（不直接展示给学生）
- 复杂度分析

## 难度评估标准
- 1星：单一概念，基础操作
- 2星：1-2个概念组合，标准模板
- 3星：需要变形或优化
- 4星：多概念综合，需要分析
- 5星：创造性思维，非标准方法`,
  },
  {
    name: 'code-assessment',
    description:
      '代码评估方法论。当学生提交代码时触发。采用混合评估：测试用例执行 + 语义代码审查，给出全面反馈。',
    triggerKeywords: ['提交', '运行', '测试', '检查', '评估'],
    triggerCommands: ['/submit', '/run', '/test'],
    content: `# 代码评估方法论

## 混合评估框架

### 第一阶段：测试驱动评估（客观）
执行学生代码，运行所有测试用例：
- 记录通过/失败数量
- 捕获运行时错误（异常、超时、栈溢出）
- 记录执行时间

### 第二阶段：语义代码审查（主观）
即使代码通过测试，仍需审查：

1. **时间复杂度分析**
   - 是否达到最优复杂度？
   - 是否有不必要的嵌套循环？
   - 是否可以利用哈希表/排序优化？

2. **空间复杂度分析**
   - 是否可以原地操作？
   - 是否可以用滚动数组优化？
   - 辅助空间是否必要？

3. **代码可读性**（1-5分）
   - 变量命名是否清晰？
   - 逻辑是否简洁？
   - 是否有冗余代码？
   - 注释是否充分？

4. **边界情况覆盖**（1-5分）
   - 空输入处理
   - 单元素输入
   - 最大/最小值
   - 负数/零处理

### 第三阶段：反馈生成
- 通过所有测试：表扬 + 优化建议
- 部分通过：指出失败用例 + 分析原因 + 引导修复
- 全部失败：分析核心错误 + 给出修复方向
- 编译错误：指出错误行 + 解释原因

## 评分公式
score = (测试通过率 * 50) + (复杂度评分 * 20) + (可读性 * 15) + (边界覆盖 * 15)

## 注意事项
- 测试结果由 Pyodide 在浏览器端执行获得，是客观信号
- 语义审查由考官 Agent 基于 LLM 完成
- 不直接修改学生代码，只给出建议
- 鼓励性反馈优先，建设性批评其次`,
  },
  {
    name: 'learning-path',
    description:
      '学习路径规划方法论。当学生请求制定学习计划、查看进度、或系统进行间隔重复调度时触发。基于 BKT 掌握度模型和 SM-2 间隔重复算法。',
    triggerKeywords: ['计划', '路径', '规划', '进度', '复习', '安排'],
    triggerCommands: ['/plan', '/progress', '/review'],
    content: `# 学习路径规划方法论

## BKT 掌握度模型 (Bayesian Knowledge Tracing)
每次答题后更新掌握度：

P(known) = P(known|observation)

### 更新规则
- 答对：P(known|correct) = P(known)*P(correct|known) / P(correct)
  - P(correct|known) = 1 - slip (失误率, 默认 0.1)
  - P(correct|!known) = guess (猜测率, 默认 0.25)
- 答错：P(known|incorrect) = P(known)*P(incorrect|known) / P(incorrect)
- 遗忘：每次更新后 P(known) *= (1 - forget_rate)
  - forget_rate 默认 0.05

### 初始化
- 新学习者：P(known) = 0.5 (Beta先验 α=1, β=1)
- 2-3次提交后完成预热

## SM-2 间隔重复算法
根据答题质量调整复习间隔：

quality: 0-5 (0=完全不会, 5=完美)
- quality < 3: 重置间隔为 1 天
- interval == 1: 下次间隔 = 1 天
- interval == 2: 下次间隔 = 6 天
- interval > 2: 下次间隔 = interval * easeFactor

easeFactor 更新：
EF = EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
EF = max(1.3, EF)

## 路径规划原则
1. **依赖优先**：按知识依赖图拓扑排序
2. **最近发展区**：优先推荐掌握度 0.3-0.7 的知识点
3. **间隔复习**：到期复习项优先级最高
4. **目标导向**：
   - 竞赛：高级数据结构 + 算法优化
   - 面试：高频考点 + 系统设计基础
   - 课程：按教学大纲
   - 自学：按兴趣 + 依赖顺序

## 学习计划结构
分阶段里程碑：
- 每个里程碑包含 2-4 个知识点
- 每个知识点配 2-3 道练习题
- 里程碑间设置回顾周
- 根据实际进度动态调整

## 进度可视化
- 知识点掌握度雷达图
- 学习路径完成百分比
- 间隔复习日历
- 错题本与薄弱点分析`,
  },
];

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    for (const skill of SKILLS) {
      this.skills.set(skill.name, skill);
    }
  }

  // Level 1: Get metadata (name + description) - always loaded
  getMetadata(): { name: string; description: string }[] {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  // Level 2: Get full skill content - loaded on trigger
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  // Trigger matching: check if any skill should be activated
  matchTriggers(input: string): Skill[] {
    const matched: Skill[] = [];
    const lowerInput = input.toLowerCase();

    for (const skill of this.skills.values()) {
      // Check command triggers (exact match)
      if (skill.triggerCommands) {
        for (const cmd of skill.triggerCommands) {
          if (input.trim().startsWith(cmd)) {
            matched.push(skill);
            break;
          }
        }
        if (matched.includes(skill)) continue;
      }

      // Check keyword triggers (fuzzy match)
      if (skill.triggerKeywords) {
        for (const kw of skill.triggerKeywords) {
          if (lowerInput.includes(kw.toLowerCase())) {
            matched.push(skill);
            break;
          }
        }
      }
    }

    return matched;
  }

  // Get skill content for system prompt injection
  getSkillContent(name: string): string | null {
    const skill = this.skills.get(name);
    return skill ? skill.content : null;
  }

  // Get all skill contents (for when we want to load all)
  getAllSkillContents(): string {
    return Array.from(this.skills.values())
      .map((s) => s.content)
      .join('\n\n---\n\n');
  }
}

export const skillRegistry = new SkillRegistry();
