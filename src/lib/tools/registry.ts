// ============================================================
// Tool System - Extensible tools for the AI tutor
// ------------------------------------------------------------
// Each tool has: name, description, parameters schema, and an
// execute function. Tools can be called by the orchestrator or
// directly by the user via slash commands.
// ============================================================

import { KNOWLEDGE_TOPICS, getTopicById } from '@/lib/knowledge/topics';
import { PROBLEM_BANK, getProblemsByTopic } from '@/lib/knowledge/problems';
import { validateProblemStructure, quickValidate } from '@/lib/problem-validator';
import type { AlgorithmProblem } from '@/types';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Formatted text to show the user */
  display?: string;
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  icon: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

// ============================================================
// Tool: Knowledge Base Search
// ============================================================
const knowledgeSearchTool: ToolDefinition = {
  name: 'search_knowledge',
  label: '知识库搜索',
  description: '搜索算法知识库，查询知识点详情、关键要点、常见错误',
  icon: 'book',
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词（如"二分查找"、"动态规划"）', required: true },
  ],
  execute: (args) => {
    const query = String(args.query || '').toLowerCase().trim();
    if (!query) {
      return { success: false, error: '请输入搜索关键词' };
    }

    // Search by id, name, description, keyPoints, commonMistakes
    const results = KNOWLEDGE_TOPICS.filter((t) => {
      const searchText = [
        t.id, t.name, t.description, t.category,
        ...t.keyPoints, ...t.commonMistakes,
      ].join(' ').toLowerCase();
      return searchText.includes(query);
    });

    if (results.length === 0) {
      return {
        success: true,
        display: `未找到与"${args.query}"相关的知识点。可用知识点：\n\n` +
          KNOWLEDGE_TOPICS.map((t) => `- **${t.name}** (${t.category})`).join('\n'),
      };
    }

    const display = results.map((t) => {
      const problems = getProblemsByTopic(t.id);
      const prereqs = t.prerequisites.map((p) => getTopicById(p)?.name || p).join('、') || '无';
      return `## ${t.name} (${t.category}, ${'⭐'.repeat(t.difficulty)})

${t.description}

**前置知识**：${prereqs}
**关键要点**：
${t.keyPoints.map((k) => `- ${k}`).join('\n')}
**常见错误**：
${t.commonMistakes.map((m) => `- ${m}`).join('\n')}
**相关题目**：${problems.length > 0 ? problems.map((p) => p.title).join('、') : '暂无'}`;
    }).join('\n\n---\n\n');

    return { success: true, data: results, display };
  },
};

// ============================================================
// Tool: Problem Search
// ============================================================
const problemSearchTool: ToolDefinition = {
  name: 'search_problems',
  label: '题目搜索',
  description: '搜索题库，按难度、知识点查找练习题',
  icon: 'target',
  parameters: [
    { name: 'topic', type: 'string', description: '知识点ID或名称（如 hash、二分查找）', required: false },
    { name: 'difficulty', type: 'number', description: '难度1-5', required: false },
  ],
  execute: (args) => {
    let results = [...PROBLEM_BANK];
    const topicFilter = String(args.topic || '').toLowerCase().trim();
    const difficultyFilter = Number(args.difficulty);

    if (topicFilter) {
      results = results.filter((p) => {
        const topic = getTopicById(p.topicId);
        return (
          p.topicId.toLowerCase().includes(topicFilter) ||
          topic?.name.toLowerCase().includes(topicFilter) ||
          p.tags.some((tag) => tag.toLowerCase().includes(topicFilter))
        );
      });
    }
    if (difficultyFilter >= 1 && difficultyFilter <= 5) {
      results = results.filter((p) => p.difficulty === difficultyFilter);
    }

    if (results.length === 0) {
      return {
        success: true,
        display: '未找到匹配的题目。当前题库共 ' + PROBLEM_BANK.length + ' 道题。',
      };
    }

    const display = `找到 ${results.length} 道题：\n\n` +
      results.map((p, i) => {
        const topic = getTopicById(p.topicId);
        return `${i + 1}. **${p.title}** (${'⭐'.repeat(p.difficulty)} ${topic?.name || p.topicId})\n   ${p.description.slice(0, 80)}...`;
      }).join('\n\n');

    return { success: true, data: results, display };
  },
};

// ============================================================
// Tool: Web Search (DuckDuckGo Instant Answer API)
// ============================================================
const webSearchTool: ToolDefinition = {
  name: 'web_search',
  label: '网络搜索',
  description: '搜索网络获取最新算法资料、官方文档、LeetCode题解等',
  icon: 'search',
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词', required: true },
  ],
  execute: async (args) => {
    const query = String(args.query || '').trim();
    if (!query) {
      return { success: false, error: '请输入搜索关键词' };
    }

    try {
      // Use DuckDuckGo Instant Answer API (no key required, CORS-enabled)
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`搜索请求失败: ${res.status}`);
      }
      const data = await res.json();

      const results: { title: string; snippet: string; url?: string }[] = [];

      if (data.Abstract) {
        results.push({
          title: data.Heading || query,
          snippet: data.Abstract,
          url: data.AbstractURL,
        });
      }

      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.slice(0, 60),
              snippet: topic.Text,
              url: topic.FirstURL,
            });
          }
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          display: `未找到"${query}"的即时答案。建议：\n- 访问 [LeetCode](https://leetcode.cn) 查找题目\n- 访问 [OI Wiki](https://oi-wiki.org) 学习算法知识\n- 使用更精确的关键词重试`,
        };
      }

      const display = `## 搜索结果：${query}\n\n` +
        results.map((r, i) => {
          return `${i + 1}. **${r.title}**\n   ${r.snippet?.slice(0, 200) || ''}${r.url ? `\n   [查看详情](${r.url})` : ''}`;
        }).join('\n\n');

      return { success: true, data: results, display };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : '搜索失败，请检查网络连接',
        display: '网络搜索暂时不可用。你可以直接访问：\n- [LeetCode 中国](https://leetcode.cn)\n- [OI Wiki](https://oi-wiki.org)\n- [Python 官方文档](https://docs.python.org/zh-cn/3/)',
      };
    }
  },
};

// ============================================================
// Tool: Code Complexity Analyzer (static analysis)
// ============================================================
const codeAnalyzerTool: ToolDefinition = {
  name: 'analyze_code',
  label: '代码分析',
  description: '静态分析 Python 代码的时间/空间复杂度、潜在问题',
  icon: 'code',
  parameters: [
    { name: 'code', type: 'string', description: '要分析的Python代码', required: true },
  ],
  execute: (args) => {
    const code = String(args.code || '');
    if (!code.trim()) {
      return { success: false, error: '请提供要分析的代码' };
    }

    const issues: string[] = [];
    let timeComplexity = 'O(?)';
    let spaceComplexity = 'O(?)';

    // Detect nested loops
    const loopMatches = code.match(/for\s+\w+\s+in|while\s+/g);
    const loopCount = loopMatches ? loopMatches.length : 0;

    // Detect recursion
    const funcMatch = code.match(/^def\s+(\w+)/m);
    const funcName = funcMatch ? funcMatch[1] : '';
    const isRecursive = funcName && new RegExp(`\\b${funcName}\\s*\\(`).test(code.replace(/^def\s+\w+/m, ''));

    // Detect nested loops (approximate by indentation)
    const lines = code.split('\n');
    let maxNesting = 0;
    const loopStack: number[] = [];
    for (const line of lines) {
      const indent = line.search(/\S/);
      if (indent === -1) continue;
      while (loopStack.length > 0 && indent <= loopStack[loopStack.length - 1]) {
        loopStack.pop();
      }
      if (/^\s*(for|while)\s+/.test(line)) {
        loopStack.push(indent);
        maxNesting = Math.max(maxNesting, loopStack.length);
      }
    }

    // Heuristic complexity estimation
    if (isRecursive) {
      if (/bisect|binary.*search|mid\s*=/.test(code.toLowerCase())) {
        timeComplexity = 'O(log n)';
      } else if (/merge.*sort|quick.*sort|divide.*conquer/i.test(code)) {
        timeComplexity = 'O(n log n)';
      } else {
        timeComplexity = 'O(2^n) ~ O(n!) — 递归算法，请确认是否有记忆化优化';
      }
    } else if (maxNesting === 0) {
      timeComplexity = 'O(1) — 无循环';
    } else if (maxNesting === 1) {
      if (/\bsort\(|\.sort\(|\bsorted\(/.test(code)) {
        timeComplexity = 'O(n log n)';
      } else {
        timeComplexity = 'O(n)';
      }
    } else if (maxNesting === 2) {
      timeComplexity = 'O(n²)';
    } else if (maxNesting >= 3) {
      timeComplexity = `O(n^${maxNesting}) — 注意优化嵌套循环`;
    }

    // Space complexity heuristic
    if (/\[.*for.*in|\.append\(|dict\(|set\(|\{\s*}/.test(code)) {
      if (maxNesting >= 1) {
        spaceComplexity = 'O(n)';
      } else {
        spaceComplexity = 'O(1)';
      }
    } else {
      spaceComplexity = 'O(1)';
    }
    if (/=\s*\[\s*0\s*for\s+.*for/.test(code) || /=\s*\[\[.*\]/.test(code)) {
      spaceComplexity = 'O(n²) — 使用了二维数组';
    }

    // Common issues detection
    if (/=\s*==\s*|==\s*=/.test(code)) {
      issues.push('⚠️ 可能误用了 = 和 == （赋值与相等比较混淆）');
    }
    if (/except\s*:/.test(code) && !/except\s+\w+/.test(code)) {
      issues.push('⚠️ 使用了裸 except，建议捕获具体异常类型');
    }
    if (/\.append\(.*\)\s*return/.test(code)) {
      // Check for missing return after append - heuristic
    }
    if (/range\(len\(/.test(code)) {
      issues.push('💡 range(len(...)) 可以考虑用 enumerate() 更 Pythonic');
    }
    if (isRecursive && !memoizationCheck(code)) {
      issues.push('💡 递归函数未发现记忆化(lru_cache)，可能存在重复计算');
    }

    const display = `## 代码静态分析结果\n\n` +
      `**预估时间复杂度**：${timeComplexity}\n` +
      `**预估空间复杂度**：${spaceComplexity}\n` +
      `**循环嵌套深度**：${maxNesting} 层\n` +
      `**递归检测**：${isRecursive ? '是（函数调用自身）' : '否'}\n\n` +
      (issues.length > 0 ? `**潜在问题与建议**：\n${issues.join('\n')}` : '**未发现明显问题** ✅');

    return {
      success: true,
      data: { timeComplexity, spaceComplexity, maxNesting, isRecursive, issues },
      display,
    };
  },
};

function memoizationCheck(code: string): boolean {
  return /@lru_cache|@cache|memo|memoize|dp\[|dp\s*=/.test(code);
}

// ============================================================
// Tool: Get Learning Path Recommendation
// ============================================================
const learningPathTool: ToolDefinition = {
  name: 'learning_path',
  label: '学习路径',
  description: '根据当前知识点掌握情况和学习目标推荐个性化学习路径',
  icon: 'map',
  parameters: [
    { name: 'goal', type: 'string', description: '学习目标（如"面试"、"竞赛"、"入门"、"自学"、"课程"），不同目标推荐不同知识点组合', required: false },
  ],
  execute: (args) => {
    const goal = String(args.goal || '入门').toLowerCase();

    let pathTopics = KNOWLEDGE_TOPICS;
    let goalLabel = '入门';

    if (goal.includes('面试') || goal.includes('interview')) {
      pathTopics = KNOWLEDGE_TOPICS.filter((t) =>
        ['arrays', 'hash', 'sorting', 'binary-search', 'two-pointers', 'linked-list', 'stack-queue', 'tree', 'dp', 'greedy'].includes(t.id)
      );
      goalLabel = '面试';
    } else if (goal.includes('竞赛') || goal.includes('competition') || goal.includes('oi')) {
      pathTopics = KNOWLEDGE_TOPICS; // all topics for competition
      goalLabel = '竞赛';
    } else if (goal.includes('课程') || goal.includes('course') || goal.includes('student')) {
      pathTopics = KNOWLEDGE_TOPICS.filter((t) => t.difficulty <= 4);
      goalLabel = '课程';
    } else {
      pathTopics = KNOWLEDGE_TOPICS.filter((t) => t.difficulty <= 3);
      goalLabel = '入门';
    }

    // Group by category and sort within each group
    const grouped = pathTopics.reduce<Record<string, typeof pathTopics>>((acc, t) => {
      (acc[t.category] = acc[t.category] || []).push(t);
      return acc;
    }, {});

    let display = `## ${goalLabel}学习路径\n\n`;
    display += `**目标**：${goalLabel}导向 | **知识点数**：${pathTopics.length} 个\n`;
    display += '按学习顺序排列，建议每个知识点完成 2-3 道练习题后再进入下一个。\n\n';

    let step = 1;
    for (const cat of Object.keys(grouped)) {
      display += `### ${cat}\n`;
      for (const t of grouped[cat].sort((a, b) => a.learningOrder - b.learningOrder)) {
        const problemCount = getProblemsByTopic(t.id).length;
        const prereqs = t.prerequisites.length > 0
          ? ` (前置: ${t.prerequisites.map((p) => getTopicById(p)?.name || p).join('、')})`
          : '';
        const difficulty = '⭐'.repeat(t.difficulty);
        display += `${step}. **${t.name}** ${difficulty}\n   ${t.description.slice(0, 60)}${prereqs} [${problemCount}题]\n`;
        step++;
      }
      display += '\n';
    }

    // Add milestone suggestions
    display += `### 推荐里程碑\n`;
    const milestones = [
      { range: [1, Math.ceil(pathTopics.length * 0.3)], label: '基础入门' },
      { range: [Math.ceil(pathTopics.length * 0.3) + 1, Math.ceil(pathTopics.length * 0.6)], label: '进阶提升' },
      { range: [Math.ceil(pathTopics.length * 0.6) + 1, pathTopics.length], label: '冲刺精通' },
    ];
    for (const m of milestones) {
      display += `- **${m.label}**（第${m.range[0]}-${m.range[1]}个知识点）：巩固基础，建立算法思维\n`;
    }

    return { success: true, data: pathTopics, display };
  },
};

// ============================================================
// Tool: Validate Problem
// ------------------------------------------------------------
// Deterministically validates an algorithm problem's structure,
// test case format, and quality. Does NOT rely on the LLM.
// ============================================================
const validateProblemTool: ToolDefinition = {
  name: 'validate_problem',
  label: '题目验证',
  description: '验证题目结构完整性、测试用例格式正确性，检查字段是否齐全（不依赖AI判断）',
  icon: 'shield',
  parameters: [
    { name: 'problem', type: 'string', description: '题目 JSON 字符串（包含 id,title,topicId,difficulty,description,examples,constraints,starterCode,hints,solution,testCases 等）', required: true },
    { name: 'run_tests', type: 'boolean', description: '是否运行参考解答验证测试用例（需要 Pyodide）', required: false },
  ],
  execute: (args) => {
    const problemJson = String(args.problem || '');
    const runTests = args.run_tests !== false;

    if (!problemJson.trim()) {
      return { success: false, error: '请提供题目 JSON' };
    }

    let problem: AlgorithmProblem;
    try {
      problem = JSON.parse(problemJson);
    } catch {
      // Try to extract JSON from markdown code block
      const match = problemJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          problem = JSON.parse(match[1]);
        } catch {
          return { success: false, error: 'JSON 解析失败，请检查格式' };
        }
      } else {
        return { success: false, error: 'JSON 解析失败，请检查格式' };
      }
    }

    // Run static validation (always)
    const issues = validateProblemStructure(problem);
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const quickOk = errors.length === 0;

    // Build display
    const lines: string[] = ['## 题目验证结果', ''];
    lines.push(`**结构验证**：${quickOk ? '✅ 通过' : '❌ 有错误'}`);
    lines.push(`**快速检查**：${quickValidate(problem) ? '✅ 通过' : '❌ 未通过'}`);
    lines.push('');

    if (errors.length > 0) {
      lines.push('### ❌ 错误');
      for (const e of errors) {
        lines.push(`- [${e.field}] ${e.message}`);
      }
      lines.push('');
    }

    if (warnings.length > 0) {
      lines.push('### ⚠️ 警告');
      for (const w of warnings) {
        lines.push(`- [${w.field}] ${w.message}`);
      }
      lines.push('');
    }

    const infos = issues.filter((i) => i.severity === 'info');
    if (infos.length > 0) {
      lines.push('### ℹ️ 提示');
      for (const info of infos) {
        lines.push(`- [${info.field}] ${info.message}`);
      }
      lines.push('');
    }

    if (quickOk && warnings.length === 0) {
      lines.push('题目质量良好，可以展示给学生 ✅');
    }

    return {
      success: quickOk,
      data: {
        valid: quickOk,
        errorCount: errors.length,
        warningCount: warnings.length,
        issues,
      },
      display: lines.join('\n'),
    };
  },
};

// ============================================================
// Tool Registry
// ============================================================
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    this.register(knowledgeSearchTool);
    this.register(problemSearchTool);
    this.register(webSearchTool);
    this.register(codeAnalyzerTool);
    this.register(learningPathTool);
    this.register(validateProblemTool);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  list(): { name: string; label: string; description: string; icon: string }[] {
    return this.getAll().map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      icon: t.icon,
    }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `未知工具: ${name}` };
    }
    try {
      return await tool.execute(args);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : '工具执行失败',
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();

// Slash command mapping for quick access
export const SLASH_COMMANDS: Record<string, { tool: string; args?: Record<string, unknown>; description: string }> = {
  '/search': { tool: 'web_search', description: '网络搜索' },
  '/find': { tool: 'search_knowledge', description: '搜索知识库' },
  '/problems': { tool: 'search_problems', description: '搜索题目' },
  '/analyze': { tool: 'analyze_code', description: '分析代码' },
  '/path': { tool: 'learning_path', description: '学习路径' },
  '/validate': { tool: 'validate_problem', description: '验证题目质量' },
  '/help': { tool: '', description: '显示帮助' },
};
