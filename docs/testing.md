# 测试用例与验证

本文档记录 CodeMentor 的测试验证方案和已验证通过的测试用例。

## 测试层次

### 1. 单元测试：PyodideRunner 代码执行
验证 Python 代码在浏览器中正确执行，覆盖各种数据结构和边界情况。

### 2. 集成测试：练习模式流程
验证从出题→编码→运行→提交→评估的完整流程。

### 3. UI 测试：组件渲染
验证 ChatPanel、ThinkingChain、PracticeWorkbench 等组件正确渲染。

## PyodideRunner 单元测试用例

以下测试用例通过 Node.js + Pyodide 直接运行验证，全部 13 个场景通过。

### 测试 1：用户报告的 TreeNode + print Bug
```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def solution(root):
    print(111)
    return 0
```
- 输入：`[1,2,3]`
- 期望输出：`111\n>>> 返回值: 0`
- 测试用例：`[1,2,3]` → `0`
- 状态：**通过**
- 修复点：null→None 转换 + TreeNode 自动构建

### 测试 2：翻转二叉树
```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def invert_tree(root):
    if not root:
        return None
    root.left, root.right = root.right, root.left
    invert_tree(root.left)
    invert_tree(root.right)
    return root
```
- 测试用例：
  - `[4,2,7,1,3,6,9]` → `[4,7,2,9,6,3,1]`
  - `[2,1,3]` → `[2,3,1]`
  - `[]` → `[]`（空树边界）
- 状态：**全部通过**

### 测试 3：二叉树最大深度（含 null 节点）
```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def max_depth(root):
    if not root:
        return 0
    return max(max_depth(root.left), max_depth(root.right)) + 1
```
- 测试用例：
  - `[3,9,20,null,null,15,7]` → `3`
  - `[1,null,2]` → `2`
  - `[]` → `0`
  - `[1]` → `1`
- 状态：**全部通过**（null 正确处理）

### 测试 4：两数之和（基础数组题）
```python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []
```
- 测试用例：
  - `[2,7,11,15], 9` → `[0, 1]`
  - `[3,2,4], 6` → `[1, 2]`
  - `[3,3], 6` → `[0, 1]`
- 状态：**全部通过**

### 测试 5：反转链表
```python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def reverse_list(head):
    prev = None
    curr = head
    while curr:
        next_temp = curr.next
        curr.next = prev
        prev = curr
        curr = next_temp
    return prev
```
- 测试用例：
  - `[1,2,3,4,5]` → `[5,4,3,2,1]`
  - `[1,2]` → `[2,1]`
  - `[]` → `[]`
  - `[1]` → `[1]`
- 状态：**全部通过**（空链表返回 None 归一化为 []）

### 测试 6：合并两个有序链表（双 ListNode 参数）
```python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def merge_two_lists(l1, l2):
    dummy = ListNode()
    curr = dummy
    while l1 and l2:
        if l1.val <= l2.val:
            curr.next = l1; l1 = l1.next
        else:
            curr.next = l2; l2 = l2.next
        curr = curr.next
    curr.next = l1 if l1 else l2
    return dummy.next
```
- 测试用例：
  - `[1,2,4], [1,3,4]` → `[1,1,2,3,4,4]`
  - `[], []` → `[]`
  - `[], [0]` → `[0]`
  - `[5], [1,2,4]` → `[1,2,4,5]`
- 状态：**全部通过**

### 测试 7：有效括号（字符串参数）
```python
def is_valid(s):
    stack = []
    mapping = {')': '(', '}': '{', ']': '['}
    for char in s:
        if char in mapping:
            if not stack or stack[-1] != mapping[char]:
                return False
            stack.pop()
        else:
            stack.append(char)
    return len(stack) == 0
```
- 测试用例：
  - `"()"` → `True`
  - `"()[]{}"` → `True`
  - `"(]"` → `False`
  - `"{[]}"` → `True`
  - `""` → `True`
- 状态：**全部通过**

### 测试 8：Flood Fill（二维数组，不应被误转为树/链表）
```python
def flood_fill(image, sr, sc, newColor):
    old = image[sr][sc]
    if old == newColor: return image
    rows, cols = len(image), len(image[0])
    def dfs(r, c):
        if r<0 or r>=rows or c<0 or c>=cols or image[r][c]!=old: return
        image[r][c] = newColor
        dfs(r+1,c); dfs(r-1,c); dfs(r,c+1); dfs(r,c-1)
    dfs(sr, sc)
    return image
```
- 测试用例：
  - `[[1,1,1],[1,1,0],[1,0,1]], 1, 1, 2` → `[[2,2,2],[2,2,0],[2,0,1]]`
  - `[[0,0,0],[0,0,0]], 0, 0, 2` → `[[2,2,2],[2,2,2]]`
- 状态：**全部通过**（嵌套列表不被转换）

### 测试 9：二分查找
```python
def search(nums, target):
    left, right = 0, len(nums)-1
    while left <= right:
        mid = left + (right-left)//2
        if nums[mid] == target: return mid
        elif nums[mid] < target: left = mid+1
        else: right = mid-1
    return -1
```
- 测试用例：
  - `[-1,0,3,5,9,12], 9` → `4`
  - `[-1,0,3,5,9,12], 2` → `-1`
  - `[5], 5` → `0`
- 状态：**全部通过**

### 测试 10：爬楼梯（单整数参数）
```python
def climb_stairs(n):
    if n <= 2: return n
    a, b = 1, 2
    for _ in range(3, n+1):
        a, b = b, a+b
    return b
```
- 测试用例：`2→2`、`3→3`、`5→8`
- 状态：**全部通过**

### 测试 11：最大子数组和（Kadane 算法）
```python
def max_sub_array(nums):
    max_sum = current_sum = nums[0]
    for i in range(1, len(nums)):
        current_sum = max(current_sum+nums[i], nums[i])
        max_sum = max(max_sum, current_sum)
    return max_sum
```
- 测试用例：含负数、单元素、全负数边界
- 状态：**全部通过**

### 测试 12：全排列（嵌套列表返回值）
```python
def permute(nums):
    result = []
    def backtrack(path, used):
        if len(path)==len(nums):
            result.append(path[:]); return
        for i in range(len(nums)):
            if used[i]: continue
            used[i]=True; path.append(nums[i])
            backtrack(path, used)
            path.pop(); used[i]=False
    backtrack([], [False]*len(nums))
    return result
```
- 测试用例：`[1,2,3]` → 6 个排列的列表
- 状态：**全部通过**（嵌套列表正确序列化比较）

### 测试 13：买卖股票最佳时机
```python
def max_profit(prices):
    min_price = float('inf')
    max_p = 0
    for p in prices:
        if p < min_price: min_price = p
        elif p - min_price > max_p: max_p = p - min_price
    return max_p
```
- 测试用例：正常场景、单调递减（返回 0）
- 状态：**全部通过**

## UI 功能测试清单

### 聊天面板
- [x] 欢迎消息正确显示
- [x] 用户消息右对齐，助手消息左对齐带像素头像
- [x] 快捷操作按钮（/practice、/plan、/hint）可点击
- [x] 输入框 Enter 发送，Shift+Enter 换行
- [x] 发送按钮在输入为空时禁用

### 思维链（ThinkingChain）
- [x] 生成中自动展开，显示旋转图标和当前步骤
- [x] 完成后折叠为「◇ 思考过程 N步 · Xs」一行
- [x] 点击展开/折叠
- [x] Agent 彩色标签正确显示
- [x] 步骤耗时显示
- [x] 有 detail 的步骤可点击展开详情
- [x] 历史消息的思维链可独立展开

### 流式输出
- [x] 流式输出时显示光标动画
- [x] 逐字渲染 Markdown
- [x] 空内容时显示打字动画（三点）
- [x] 流式中头像旁显示「正在输出…」状态

### 练习台
- [x] 题目 Markdown 正确渲染（标题、示例、约束）
- [x] 代码编辑器行号显示
- [x] Tab 键插入空格
- [x] 「运行」按钮执行第一个示例
- [x] 「提交」按钮运行所有测试用例
- [x] 测试结果通过/失败统计显示
- [x] 失败用例显示期望 vs 实际
- [x] Pyodide 加载中显示 loading 状态
- [x] 提示折叠/展开
- [x] 切换题目时重置代码和结果

### 意图识别
- [x] `/practice` → 练习模式
- [x] `/plan` → 规划模式
- [x] `/hint` → 提示模式
- [x] "出一道二叉树的题目" → 练习模式（自然语言）
- [x] "帮我制定学习计划" → 规划模式
- [x] "我卡住了" → 提示模式
- [x] 代码提交后 → review 模式

## 手动测试提示词

配置 API Key 后，可使用以下提示词验证各功能：

### 聊天/讲解
```
什么是动态规划？和贪心算法有什么区别？
讲一下二叉树的三种遍历方式
```

### 练习
```
/practice
出一道二叉树的题目
来一道动态规划的练习题
```

### 学习路径
```
/plan
帮我制定一个面试算法学习计划
```

### 代码评估
在练习台提交代码后自动触发，或：
```
/hint
我卡住了，给个提示
```

### 工具命令
```
/find 二分查找
/problems 动态规划
/path 面试
```

## 已知限制

1. **AI 出题格式**：依赖 LLM 正确输出 JSON 格式的题目，偶尔可能格式错误，已通过 validator + 本地题库降级处理
2. **Python 标准库**：Pyodide 包含完整 Python 标准库，但无法安装 pip 包（纯教学场景已足够）
3. **递归深度**：Python 默认递归深度限制为 1000，极大规模测试可能栈溢出
4. **循环链表**：ListNode 序列化有 10000 步安全限制，遇到循环链表会截断
5. **TreeNode 启发式检测**：如果用户定义了名为 TreeNode 但结构不同的类，可能被误识别（教学场景概率极低）
