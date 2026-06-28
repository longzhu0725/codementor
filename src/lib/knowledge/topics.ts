import { KnowledgeTopic } from '@/types';

// Algorithm Knowledge Graph
// Ordered by learning dependency (learningOrder)
export const KNOWLEDGE_TOPICS: KnowledgeTopic[] = [
  {
    id: 'arrays',
    name: '数组与字符串',
    category: '基础数据结构',
    difficulty: 1,
    prerequisites: [],
    description: '数组是最基础的数据结构，掌握遍历、查找、插入删除等基本操作。',
    keyPoints: ['线性遍历', '双指针技巧', '滑动窗口', '前缀和数组'],
    commonMistakes: ['数组越界', '空数组未处理', '负数索引混淆'],
    learningOrder: 1,
  },
  {
    id: 'hash',
    name: '哈希表',
    category: '基础数据结构',
    difficulty: 2,
    prerequisites: ['arrays'],
    description: '哈希表提供 O(1) 平均时间复杂度的查找，是空间换时间的经典应用。',
    keyPoints: ['哈希函数设计', '冲突处理', 'Python dict/set 的使用', '两数之和模式'],
    commonMistakes: ['忽略哈希冲突', '可变对象作为键', '未考虑重复元素'],
    learningOrder: 2,
  },
  {
    id: 'sorting',
    name: '排序算法',
    category: '基础算法',
    difficulty: 2,
    prerequisites: ['arrays'],
    description: '掌握常见排序算法及其时间空间复杂度，理解稳定性。',
    keyPoints: ['快速排序', '归并排序', '堆排序', 'Python sorted() 内部实现'],
    commonMistakes: ['忽略最坏情况', '不稳定排序误用', '比较函数写错'],
    learningOrder: 3,
  },
  {
    id: 'binary-search',
    name: '二分查找',
    category: '基础算法',
    difficulty: 3,
    prerequisites: ['arrays', 'sorting'],
    description: '二分查找是面试高频考点，核心在于边界处理和搜索空间定义。',
    keyPoints: ['左闭右闭区间', '左闭右开区间', '整数溢出 mid = left + (right-left)//2', '二分答案'],
    commonMistakes: ['死循环（边界更新错误）', '整数溢出', '未排序就二分', 'left<=right vs left<right 混淆'],
    learningOrder: 4,
  },
  {
    id: 'two-pointers',
    name: '双指针',
    category: '基础算法',
    difficulty: 2,
    prerequisites: ['arrays', 'sorting'],
    description: '双指针技巧用于优化 O(n²) 到 O(n)，分为对撞指针和快慢指针。',
    keyPoints: ['对撞指针', '快慢指针', '有序数组去重', '三数之和模式'],
    commonMistakes: ['指针更新方向错误', '遗漏边界检查', '未考虑重复元素'],
    learningOrder: 5,
  },
  {
    id: 'recursion',
    name: '递归',
    category: '核心思想',
    difficulty: 3,
    prerequisites: ['arrays'],
    description: '递归是算法思维的基石，理解递归是掌握树、图、DP 的前提。',
    keyPoints: ['基线条件', '递推关系', '递归调用栈', '递归转迭代'],
    commonMistakes: ['缺少基线条件导致栈溢出', '重复计算', '返回值未正确传递'],
    learningOrder: 6,
  },
  {
    id: 'linked-list',
    name: '链表',
    category: '基础数据结构',
    difficulty: 3,
    prerequisites: ['recursion'],
    description: '链表考察指针操作能力，是理解更复杂数据结构的基础。',
    keyPoints: ['虚拟头节点', '快慢指针找中点', '链表反转', '环检测'],
    commonMistakes: ['指针丢失', '未处理空链表', '环检测忘记终止条件'],
    learningOrder: 7,
  },
  {
    id: 'stack-queue',
    name: '栈与队列',
    category: '基础数据结构',
    difficulty: 2,
    prerequisites: ['arrays', 'linked-list'],
    description: '栈和队列是 LIFO/FIFO 结构，在表达式求值、BFS 中有核心应用。',
    keyPoints: ['单调栈', '括号匹配', '队列实现栈', '滑动窗口最大值'],
    commonMistakes: ['栈空时弹出', '单调栈方向错误', '队列边界处理'],
    learningOrder: 8,
  },
  {
    id: 'tree',
    name: '树与二叉树',
    category: '核心数据结构',
    difficulty: 4,
    prerequisites: ['recursion', 'stack-queue'],
    description: '树是递归思想的最佳实践场景，掌握遍历和递归思维。',
    keyPoints: ['前中后序遍历', '层序遍历 BFS', '递归视角', 'BST 性质'],
    commonMistakes: ['空节点未处理', '递归终止条件错误', 'BST 性质误用'],
    learningOrder: 9,
  },
  {
    id: 'graph',
    name: '图',
    category: '核心数据结构',
    difficulty: 4,
    prerequisites: ['tree', 'hash'],
    description: '图的遍历和最短路径是面试和竞赛的核心内容。',
    keyPoints: ['邻接表表示', 'DFS/BFS 遍历', '拓扑排序', '并查集'],
    commonMistakes: [' visited 数组遗漏', '有向图/无向图混淆', '环检测错误'],
    learningOrder: 10,
  },
  {
    id: 'bfs-dfs',
    name: 'BFS 与 DFS',
    category: '核心算法',
    difficulty: 4,
    prerequisites: ['graph', 'stack-queue'],
    description: 'BFS 和 DFS 是图/树遍历的两大基本策略，各有适用场景。',
    keyPoints: ['BFS 求最短路径', 'DFS 求连通分量', '层序遍历', '回溯剪枝'],
    commonMistakes: ['BFS 忘记标记已访问', 'DFS 栈溢出', '方向数组写错'],
    learningOrder: 11,
  },
  {
    id: 'backtracking',
    name: '回溯算法',
    category: '核心算法',
    difficulty: 4,
    prerequisites: ['recursion', 'bfs-dfs'],
    description: '回溯是 DFS 的应用，用于穷举所有可能解，关键是剪枝优化。',
    keyPoints: ['选择-递归-撤销', '排列/组合/子集', '剪枝优化', 'N皇后问题'],
    commonMistakes: ['忘记撤销选择', '剪枝条件错误', '重复解未去重'],
    learningOrder: 12,
  },
  {
    id: 'greedy',
    name: '贪心算法',
    category: '核心算法',
    difficulty: 4,
    prerequisites: ['sorting', 'two-pointers'],
    description: '贪心算法在每步选择局部最优，适用于有贪心选择性质的问题。',
    keyPoints: ['贪心选择性质', '最优子结构', '区间调度', '霍夫曼编码'],
    commonMistakes: ['错误假设贪心成立', '未证明贪心正确性', '排序方向错误'],
    learningOrder: 13,
  },
  {
    id: 'dp',
    name: '动态规划',
    category: '核心算法',
    difficulty: 5,
    prerequisites: ['recursion', 'greedy'],
    description: '动态规划是面试和竞赛的重中之重，掌握状态定义和转移方程。',
    keyPoints: ['状态定义', '状态转移方程', '初始化', '空间优化（滚动数组）', '背包问题'],
    commonMistakes: ['状态定义不当', '转移遗漏', '初始化错误', '边界处理'],
    learningOrder: 14,
  },
];

export function getTopicById(id: string): KnowledgeTopic | undefined {
  return KNOWLEDGE_TOPICS.find((t) => t.id === id);
}

export function getTopicsByCategory(category: string): KnowledgeTopic[] {
  return KNOWLEDGE_TOPICS.filter((t) => t.category === category);
}

export function getPrerequisiteChain(topicId: string): KnowledgeTopic[] {
  const topic = getTopicById(topicId);
  if (!topic) return [];
  const chain: KnowledgeTopic[] = [];
  for (const prereqId of topic.prerequisites) {
    const prereq = getTopicById(prereqId);
    if (prereq) {
      chain.push(prereq, ...getPrerequisiteChain(prereqId));
    }
  }
  return chain;
}

export function getNextTopics(topicId: string): KnowledgeTopic[] {
  return KNOWLEDGE_TOPICS.filter((t) => t.prerequisites.includes(topicId));
}
