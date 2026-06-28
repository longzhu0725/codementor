import { AlgorithmProblem } from '@/types';

// Problem Bank - curated algorithm problems for practice
export const PROBLEM_BANK: AlgorithmProblem[] = [
  {
    id: 'two-sum',
    title: '两数之和',
    topicId: 'hash',
    difficulty: 1,
    description:
      '给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值的那两个整数，并返回它们的数组下标。你可以假设每种输入只会对应一个答案。',
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: '因为 nums[0] + nums[1] == 9' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
    ],
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', '只会存在一个有效答案'],
    starterCode: `def two_sum(nums, target):
    # 在这里写你的代码
    pass`,
    testCases: [
      { input: '[2,7,11,15], 9', expectedOutput: '[0, 1]' },
      { input: '[3,2,4], 6', expectedOutput: '[1, 2]' },
      { input: '[3,3], 6', expectedOutput: '[0, 1]' },
      { input: '[1,5,8,12,13], 14', expectedOutput: '[1, 2]', isHidden: true },
    ],
    hints: [
      '想想能不能用哈希表记录已经遍历过的数字？',
      '对于每个数 nums[i]，我们需要找 target - nums[i] 是否在之前出现过',
      '用 dict 存储 {值: 索引}，一次遍历即可',
    ],
    solution: `def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []`,
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    tags: ['哈希表', '数组'],
  },
  {
    id: 'binary-search-basic',
    title: '二分查找',
    topicId: 'binary-search',
    difficulty: 2,
    description:
      '给定一个 n 个元素有序的（升序）整型数组 nums 和一个目标值 target，写一个函数搜索 nums 中的 target，如果目标值存在返回下标，否则返回 -1。',
    examples: [
      { input: 'nums = [-1,0,3,5,9,12], target = 9', output: '4' },
      { input: 'nums = [-1,0,3,5,9,12], target = 2', output: '-1' },
    ],
    constraints: ['nums 中的所有元素互不相同', '1 <= nums.length <= 10^4'],
    starterCode: `def search(nums, target):
    # 在这里写你的代码
    pass`,
    testCases: [
      { input: '[-1,0,3,5,9,12], 9', expectedOutput: '4' },
      { input: '[-1,0,3,5,9,12], 2', expectedOutput: '-1' },
      { input: '[5], 5', expectedOutput: '0' },
      { input: '[1,2,3,4,5,6,7,8,9,10], 1', expectedOutput: '0', isHidden: true },
      { input: '[1,2,3,4,5,6,7,8,9,10], 10', expectedOutput: '9', isHidden: true },
    ],
    hints: [
      '定义左右指针 left 和 right，每次取中间值比较',
      '注意循环条件是 left <= right 还是 left < right？',
      'mid = left + (right - left) // 2 可以避免整数溢出',
    ],
    solution: `def search(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = left + (right - left) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1`,
    timeComplexity: 'O(log n)',
    spaceComplexity: 'O(1)',
    tags: ['二分查找', '数组'],
  },
  {
    id: 'reverse-linked-list',
    title: '反转链表',
    topicId: 'linked-list',
    difficulty: 3,
    description:
      '给你单链表的头节点 head，请你反转链表，并返回反转后的链表。',
    examples: [
      { input: 'head = [1,2,3,4,5]', output: '[5,4,3,2,1]' },
      { input: 'head = [1,2]', output: '[2,1]' },
      { input: 'head = []', output: '[]' },
    ],
    starterCode: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def reverse_list(head):
    # 在这里写你的代码
    pass`,
    testCases: [
      { input: '[1,2,3,4,5]', expectedOutput: '[5,4,3,2,1]' },
      { input: '[1,2]', expectedOutput: '[2,1]' },
      { input: '[]', expectedOutput: '[]' },
      { input: '[1]', expectedOutput: '[1]', isHidden: true },
    ],
    hints: [
      '用迭代法：维护 prev, curr 两个指针',
      '每次把 curr.next 指向 prev，然后三个指针都前进一步',
      '别忘了保存原来的 next 再修改！',
    ],
    solution: `def reverse_list(head):
    prev = None
    curr = head
    while curr:
        next_temp = curr.next
        curr.next = prev
        prev = curr
        curr = next_temp
    return prev`,
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    tags: ['链表', '指针操作'],
  },
  {
    id: 'max-subarray',
    title: '最大子数组和',
    topicId: 'dp',
    difficulty: 4,
    description:
      '给你一个整数数组 nums，请你找出一个具有最大和的连续子数组（子数组最少包含一个元素），返回其最大和。',
    examples: [
      { input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]', output: '6', explanation: '连续子数组 [4,-1,2,1] 的和最大，为 6' },
      { input: 'nums = [1]', output: '1' },
      { input: 'nums = [5,4,-1,7,8]', output: '23' },
    ],
    constraints: ['1 <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4'],
    starterCode: `def max_sub_array(nums):
    # 在这里写你的代码
    pass`,
    testCases: [
      { input: '[-2,1,-3,4,-1,2,1,-5,4]', expectedOutput: '6' },
      { input: '[1]', expectedOutput: '1' },
      { input: '[5,4,-1,7,8]', expectedOutput: '23' },
      { input: '[-1]', expectedOutput: '-1', isHidden: true },
      { input: '[-2,-1]', expectedOutput: '-1', isHidden: true },
    ],
    hints: [
      '定义 dp[i] 为以 nums[i] 结尾的最大子数组和',
      'dp[i] = max(dp[i-1] + nums[i], nums[i])',
      '可以只用一个变量优化空间到 O(1)',
    ],
    solution: `def max_sub_array(nums):
    max_sum = nums[0]
    current_sum = nums[0]
    for i in range(1, len(nums)):
        current_sum = max(current_sum + nums[i], nums[i])
        max_sum = max(max_sum, current_sum)
    return max_sum`,
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    tags: ['动态规划', 'Kadane算法'],
  },
  {
    id: 'valid-parentheses',
    title: '有效的括号',
    topicId: 'stack-queue',
    difficulty: 2,
    description:
      '给定一个只包括 (, ), {, }, [, ] 的字符串 s，判断字符串是否有效。有效字符串需满足：左括号必须用相同类型的右括号闭合，左括号必须以正确的顺序闭合。',
    examples: [
      { input: 's = "()"', output: 'True' },
      { input: 's = "()[]{}"', output: 'True' },
      { input: 's = "(]"', output: 'False' },
    ],
    starterCode: `def is_valid(s):
    # 在这里写你的代码
    pass`,
    testCases: [
      { input: '"()"', expectedOutput: 'True' },
      { input: '"()[]{}"', expectedOutput: 'True' },
      { input: '"(]"', expectedOutput: 'False' },
      { input: '"([)]"', expectedOutput: 'False', isHidden: true },
      { input: '"{[]}"', expectedOutput: 'True', isHidden: true },
      { input: '""', expectedOutput: 'True', isHidden: true },
    ],
    hints: [
      '用栈来匹配括号',
      '遇到左括号入栈，遇到右括号检查栈顶是否匹配',
      '最后检查栈是否为空',
    ],
    solution: `def is_valid(s):
    stack = []
    mapping = {')': '(', '}': '{', ']': '['}
    for char in s:
        if char in mapping:
            if not stack or stack[-1] != mapping[char]:
                return False
            stack.pop()
        else:
            stack.append(char)
    return len(stack) == 0`,
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    tags: ['栈', '字符串'],
  },
  {
    id: 'climbing-stairs',
    title: '爬楼梯',
    topicId: 'dp',
    difficulty: 2,
    description:
      '假设你正在爬楼梯。需要 n 阶你才能到达楼顶。每次你可以爬 1 或 2 个台阶。你有多少种不同的方法可以爬到楼顶呢？',
    examples: [
      { input: 'n = 2', output: '2', explanation: '1+1 或 2' },
      { input: 'n = 3', output: '3', explanation: '1+1+1, 1+2, 2+1' },
    ],
    constraints: ['1 <= n <= 45'],
    starterCode: `def climb_stairs(n):
    # 在这里写你的代码
    pass`,
    testCases: [
      { input: '2', expectedOutput: '2' },
      { input: '3', expectedOutput: '3' },
      { input: '1', expectedOutput: '1', isHidden: true },
      { input: '4', expectedOutput: '5', isHidden: true },
      { input: '5', expectedOutput: '8', isHidden: true },
    ],
    hints: [
      '这其实是斐波那契数列的变形',
      'f(n) = f(n-1) + f(n-2)，到达第n阶可以从n-1阶爬1步或从n-2阶爬2步',
      '用两个变量滚动即可，不需要数组',
    ],
    solution: `def climb_stairs(n):
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b`,
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    tags: ['动态规划', '斐波那契'],
  },
];

export function getProblemById(id: string): AlgorithmProblem | undefined {
  return PROBLEM_BANK.find((p) => p.id === id);
}

export function getProblemsByTopic(topicId: string): AlgorithmProblem[] {
  return PROBLEM_BANK.filter((p) => p.topicId === topicId);
}

export function getProblemsByDifficulty(difficulty: number): AlgorithmProblem[] {
  return PROBLEM_BANK.filter((p) => p.difficulty === difficulty);
}

export function getRandomProblem(topicId?: string): AlgorithmProblem {
  const pool = topicId ? getProblemsByTopic(topicId) : PROBLEM_BANK;
  return pool[Math.floor(Math.random() * pool.length)] || PROBLEM_BANK[0];
}
