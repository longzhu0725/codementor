# 代码执行引擎（PyodideRunner）

## 概述

`PyodideRunner` 基于 Pyodide v0.27.2（WebAssembly 版 Python 3.12）在浏览器中执行用户提交的 Python 代码。通过 Web Worker 隔离执行环境，支持超时控制，自动处理 LeetCode 风格的数据结构转换。

## 架构

```
主线程 (React)
  │
  │  postMessage({type: 'run'|'runTests', code, ...})
  ↓
Web Worker
  │
  ├─ 加载 Pyodide（首次，~几秒）
  ├─ 设置全局变量 (userCode, funcName, sampleInput/testCasesJson)
  └─ runPython(HARNESS)
       │
       ├─ exec(userCode, _ns)     ← 执行用户代码
       ├─ 解析输入参数
       ├─ 自动适配数据结构
       ├─ 调用目标函数
       ├─ 序列化返回值
       └─ 返回 JSON 结果
```

## 两套执行 Harness

### RUN_HARNESS（单步运行）
对应「运行」按钮，使用第一个示例输入执行函数：

```python
# 流程
1. exec(userCode, _ns)                    # 执行用户代码
2. _fn = _ns.get(funcName)                # 获取目标函数
3. _parsed = _parse_input(sampleInput)    # 解析输入
4. _adapted = [_adapt_arg(a, _ns) ...]    # 自动转换数据结构
5. _ret = _fn(*_adapted)                  # 调用函数
6. _result["returnValue"] = str(_ret)     # 记录返回值
```

### TEST_HARNESS（批量测试）
对应「提交」按钮，遍历所有测试用例并判题：

```python
# 流程
1. exec(userCode, _ns)
2. for each test case:
     a. _args = _parse_input(input)
     b. _args_adapted = _adapt_args(_args, _ns)
     c. _res = _fn(*_args_adapted)       # 失败时回退到原始参数
     d. _actual = _serialize(_res)       # 序列化返回值
     e. _exp_serialized = _serialize(literal_eval(expected))
     f. 比较 _actual == _exp_serialized
3. 返回 {passed, total, failures[]}
```

## 输入解析（_parse_input）

支持的输入格式：

| 输入示例 | 解析结果 | 说明 |
|---|---|---|
| `"[2,7,11,15], 9"` | `[[2,7,11,15], 9]` | 多参数（自动包元组拆包） |
| `"[1,2,3]"` | `[[1,2,3]]` | 单列表参数 |
| `"42"` | `[42]` | 单数字 |
| `"[3,9,20,null,null,15,7]"` | `[[3,9,20,None,None,15,7]]` | null 自动转为 None |
| `"[[1,1,1],[1,1,0]], 1, 1, 2"` | `[[[1,1,1],[1,1,0]], 1, 1, 2]` | 嵌套列表 + 多参数 |
| `"()"` | `["()"]` | 字符串参数（带引号保留） |

解析策略：
1. 正则替换 `\bnull\b` → `None`（LeetCode 兼容）
2. 尝试 `literal_eval("(" + s + ",)")` 解析为元组
3. 失败则尝试 `literal_eval(s)` 解析为单值
4. 仍失败且含逗号则逐段解析后拼接
5. 全部失败则抛出 ValueError

## 数据结构自动适配

### TreeNode 构建（_to_treenode）
将层序（BFS）列表转换为二叉树：

```python
# 输入: [4,2,7,1,3,6,9]
# 构建:
#       4
#      / \
#     2   7
#    / \ / \
#   1  3 6  9
#
# 使用 BFS 队列构建：
# root = TreeNode(4)
# queue = [4]
# i=1: 4.left = TreeNode(2), queue=[2,7]
# i=3: 2.left = TreeNode(1), 2.right = TreeNode(3)
# ...
```

空节点处理：`None` 值在列表中表示空位置，不会创建节点，但会占用 BFS 队列位置。

### ListNode 构建（_to_listnode）
将列表转换为单链表：

```python
# 输入: [1,2,3,4,5]
# 构建: 1 → 2 → 3 → 4 → 5 → None
# 使用 dummy 头节点简化边界处理
```

### 类检测（_is_treenode_cls / _is_listnode_cls）
通过**鸭子类型**检测用户代码中是否定义了对应类：
- TreeNode：实例化后有 `val`、`left`、`right` 属性
- ListNode：实例化后有 `val`、`next` 属性（且没有 left/right，避免与 TreeNode 混淆）

### 转换规则
- **仅转换扁平列表**：不含嵌套 list/tuple/dict 元素的列表
- **TreeNode 优先**：当 TreeNode 和 ListNode 同时存在时，扁平列表转为 TreeNode
- **空列表 `[]`**：转为 `None`（空树/空链表）
- **转换失败回退**：调用函数抛出 TypeError/AttributeError 时，自动用原始列表参数重试

## 返回值序列化（_serialize）

| 返回类型 | 序列化结果 |
|---|---|
| `None` | `null`（JSON） |
| `int/float/str/bool` | 原值 |
| `list/tuple` | 递归序列化每个元素 |
| TreeNode | BFS 层序列表（自动去除尾部 None） |
| ListNode | 遍历 next 指针的列表（带 10000 步安全限制） |
| 其他对象 | `str(obj)` |

### TreeNode 序列化示例
```python
# 树:
#     1
#      \
#       2
# 层序遍历: [1, None, 2]
# 去除尾部 None: [1, None, 2]  （中间 None 保留）

# 空树: []
```

### 空值归一化
当函数返回 `None` 且输入参数被适配为数据结构时，将 `None` 视为空结构 `[]`，与测试期望的 `[]` 匹配。

## 超时处理

- 默认超时：RUN_HARNESS 10秒，TEST_HARNESS 15秒
- 超时后调用 `worker.terminate()` 强制终止 Pyodide 执行
- Worker 被终止后自动重建（下次请求时 createWorker）

## 错误处理

| 错误场景 | 处理方式 |
|---|---|
| 用户代码语法错误 | `_result["error"]` 返回完整 traceback |
| 目标函数不存在 | 返回 "未找到函数: {funcName}" |
| 输入解析失败 | 该测试用例标记为失败，error 字段记录原因 |
| 函数运行时异常 | 捕获异常，记录到 failures[].error |
| Pyodide 加载失败 | Worker onerror 重建，reject Promise |
| 序列化/比较失败 | 降级为字符串比较 `str(actual).strip() == str(expected).strip()` |

## 支持的题型验证状态

已验证通过的题型（共 13 个测试场景）：

| 题型 | 数据结构 | 测试用例数 | 状态 |
|---|---|---|---|
| 两数之和 | 数组 + 数字 | 3 | ✓ |
| 二分查找 | 有序数组 + 目标值 | 3 | ✓ |
| 反转链表 | ListNode | 4 | ✓ |
| 合并有序链表 | 双 ListNode | 4 | ✓ |
| 翻转二叉树 | TreeNode | 3 | ✓ |
| 二叉树最大深度 | TreeNode（含 null） | 4 | ✓ |
| 有效括号 | 字符串 | 5 | ✓ |
| 最大子数组和 | 数组 | 4 | ✓ |
| 爬楼梯 | 整数 | 3 | ✓ |
| 买卖股票最佳时机 | 数组 | 2 | ✓ |
| Flood Fill | 二维数组 + 坐标 | 2 | ✓ |
| 全排列 | 数组（嵌套列表结果） | 3 | ✓ |
| 用户报告的 TreeNode print bug | TreeNode | 1 | ✓ |
