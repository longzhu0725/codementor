import { CodeExecutionResult } from '@/types';

// ============================================================
// PyodideRunner
// ------------------------------------------------------------
// Runs Python code in the browser via Pyodide (loaded from CDN).
//
// To make timeouts reliable (including infinite loops in student
// code), Pyodide runs inside a Web Worker spawned from an inline
// Blob. On timeout the main thread terminates the worker, which
// interrupts any blocking execution. Pyodide is reloaded lazily
// on the next call after a termination.
//
// Exported API:
//   loadPyodide()                                  -> Promise<void>
//   runCode(code, timeoutMs?)                       -> Promise<CodeExecutionResult>
//   runTestCases(code, testCases, functionName, timeoutMs?)
//                                                   -> Promise<CodeExecutionResult>
// ============================================================

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/';

// The test-case shape coming from the problem bank.
export interface ProblemTestCase {
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
}

interface WorkerRequest {
  id: number;
  type: 'load' | 'run' | 'runTests';
  code?: string;
  functionName?: string;
  testCases?: { input: string; expected: string }[];
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: RunResult;
  error?: string;
}

interface RunResult {
  success?: boolean;
  output?: string;
  error?: string;
  testResults?: {
    passed: number;
    total: number;
    failures: { input: string; expected: string; actual: string; error?: string }[];
  };
}

// ------------------------------------------------------------
// Worker source. Built as a template literal; the only
// interpolation is the CDN URL. Python harnesses are embedded as
// escaped-backtick template literals — they contain no `${` and no
// backslash escapes inside Python string literals, so the outer
// template literal leaves them untouched.
// ------------------------------------------------------------
const WORKER_SOURCE = `
const PYODIDE_CDN = ${JSON.stringify(PYODIDE_CDN)};
importScripts(PYODIDE_CDN + 'pyodide.js');

let pyodidePromise = null;
function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = self.loadPyodide({ indexURL: PYODIDE_CDN });
  }
  return pyodidePromise;
}

// Harness: run arbitrary student code, capture stdout + errors.
const RUN_HARNESS = \`import sys, io, json, traceback as _tb
_result = {"output": "", "error": ""}
_ns = {}
_buf = io.StringIO()
sys.stdout = _buf
try:
    exec(userCode, _ns)
except Exception:
    _result["error"] = _tb.format_exc()
finally:
    sys.stdout = sys.__stdout__
_result["output"] = _buf.getvalue()
json.dumps(_result, ensure_ascii=False)\`;

// Harness: run student code against a list of test cases.
const TEST_HARNESS = \`import json, ast, traceback as _tb

def _serialize(obj):
    if obj is None:
        return "None"
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, list):
        return [_serialize(x) for x in obj]
    if isinstance(obj, tuple):
        return [_serialize(x) for x in obj]
    if hasattr(obj, "val") and hasattr(obj, "next"):
        out = []
        cur = obj
        while cur:
            out.append(cur.val)
            cur = cur.next
        return out
    return obj

def _to_listnode(values, cls):
    dummy = cls()
    cur = dummy
    for v in values:
        cur.next = cls(v)
        cur = cur.next
    return dummy.next

def _adapt_args(args, ns):
    listnode = ns.get("ListNode")
    if listnode is None:
        return args, False
    new_args = []
    adapted = False
    for a in args:
        if isinstance(a, list):
            new_args.append(_to_listnode(a, listnode))
            adapted = True
        else:
            new_args.append(a)
    return new_args, adapted

_result = {"success": True, "output": "", "error": "", "testResults": None}
_ns = {}
_loaded = True
try:
    exec(userCode, _ns)
except Exception:
    _result["success"] = False
    _result["error"] = "代码加载失败: " + _tb.format_exc()
    _loaded = False

if _loaded:
    _fn = _ns.get(funcName)
    if _fn is None:
        _result["success"] = False
        _result["error"] = "未找到函数: " + str(funcName)
    else:
        _tests = json.loads(testCasesJson)
        _passed = 0
        _total = len(_tests)
        _failures = []
        for _t in _tests:
            _inp = _t.get("input", "")
            _exp = _t.get("expected", "")
            try:
                _parsed = ast.literal_eval(_inp)
                if isinstance(_parsed, tuple):
                    _args = list(_parsed)
                else:
                    _args = [_parsed]
                try:
                    _res = _fn(*_args)
                except AttributeError:
                    _new, _adapted = _adapt_args(_args, _ns)
                    if _adapted:
                        _res = _fn(*_new)
                    else:
                        raise
                _actual = _serialize(_res)
                try:
                    _exp_val = ast.literal_eval(_exp)
                    _ok = _actual == _exp_val
                except Exception:
                    _ok = str(_actual).strip() == str(_exp).strip()
                if _ok:
                    _passed = _passed + 1
                else:
                    _failures.append({"input": _inp, "expected": _exp, "actual": str(_actual)})
            except Exception as _e:
                _failures.append({"input": _inp, "expected": _exp, "actual": "", "error": str(_e)})
        _result["testResults"] = {"passed": _passed, "total": _total, "failures": _failures}
        _result["output"] = "通过 " + str(_passed) + "/" + str(_total) + " 个测试用例"

json.dumps(_result, ensure_ascii=False)\`;

self.onmessage = async (e) => {
  const data = e.data;
  try {
    if (data.type === 'load') {
      await getPyodide();
      self.postMessage({ id: data.id, ok: true, result: null });
      return;
    }
    const pyodide = await getPyodide();

    if (data.type === 'run') {
      pyodide.globals.set('userCode', data.code);
      const resStr = pyodide.runPython(RUN_HARNESS);
      let res;
      try {
        res = JSON.parse(resStr);
      } catch (_) {
        res = { output: String(resStr), error: '' };
      }
      self.postMessage({ id: data.id, ok: true, result: res });
      return;
    }

    if (data.type === 'runTests') {
      pyodide.globals.set('userCode', data.code);
      pyodide.globals.set('funcName', data.functionName);
      pyodide.globals.set('testCasesJson', JSON.stringify(data.testCases || []));
      const resStr = pyodide.runPython(TEST_HARNESS);
      let res;
      try {
        res = JSON.parse(resStr);
      } catch (_) {
        res = { success: false, output: String(resStr), error: '结果解析失败' };
      }
      self.postMessage({ id: data.id, ok: true, result: res });
      return;
    }

    self.postMessage({ id: data.id, ok: false, error: '未知请求类型: ' + data.type });
  } catch (err) {
    self.postMessage({
      id: data.id,
      ok: false,
      error: String((err && err.message) || err),
    });
  }
};
`;

type PendingHandler = {
  resolve: (value: RunResult | null) => void;
  reject: (error: Error) => void;
};

class PyodideRunner {
  private worker: Worker | null = null;
  private msgId = 0;
  private pending = new Map<number, PendingHandler>();
  private readyPromise: Promise<void> | null = null;

  private createWorker(): Worker {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    // The blob URL can be revoked once the worker has loaded.
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      const handler = this.pending.get(data.id);
      if (!handler) return;
      this.pending.delete(data.id);
      if (data.ok) {
        handler.resolve(data.result ?? null);
      } else {
        handler.reject(new Error(data.error || 'Pyodide 执行失败'));
      }
    };

    worker.onerror = (event) => {
      const message = event.message || 'Pyodide Worker 发生错误';
      for (const handler of this.pending.values()) {
        handler.reject(new Error(message));
      }
      this.pending.clear();
      this.worker = null;
      this.readyPromise = null;
    };

    return worker;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = this.createWorker();
    }
    return this.worker;
  }

  /** Load (or reuse) the Pyodide runtime inside the worker. */
  async load(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.ensureWorker();
    this.readyPromise = this.request({ type: 'load' }, 90000).then(() => undefined);
    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      throw error;
    }
  }

  /** Whether the Pyodide runtime has been loaded already. */
  get isLoaded(): boolean {
    return this.readyPromise !== null;
  }

  private request(
    payload: Omit<WorkerRequest, 'id'>,
    timeoutMs: number
  ): Promise<RunResult | null> {
    const worker = this.ensureWorker();
    const id = ++this.msgId;
    return new Promise<RunResult | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          // Terminate to break any blocking / infinite-loop execution.
          this.terminate();
          reject(new Error(`代码执行超时（${timeoutMs / 1000} 秒）`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      worker.postMessage({ id, ...payload } satisfies WorkerRequest);
    });
  }

  /** Abort the current worker and reject any pending requests. */
  private terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const handler of this.pending.values()) {
      handler.reject(new Error('Worker 已终止'));
    }
    this.pending.clear();
    this.readyPromise = null;
  }

  /** Run arbitrary Python code and capture its stdout / errors. */
  async runCode(code: string, timeoutMs = 10000): Promise<CodeExecutionResult> {
    await this.load();
    const result = await this.request({ type: 'run', code }, timeoutMs);
    const res = result ?? {};
    return {
      success: !res.error,
      output: res.output ?? '',
      error: res.error || undefined,
    };
  }

  /** Run student code against a set of test cases. */
  async runTestCases(
    code: string,
    testCases: ProblemTestCase[],
    functionName: string,
    timeoutMs = 15000
  ): Promise<CodeExecutionResult> {
    await this.load();
    const mapped = testCases.map((t) => ({ input: t.input, expected: t.expectedOutput }));
    const result = await this.request(
      { type: 'runTests', code, functionName, testCases: mapped },
      timeoutMs
    );
    const res = result ?? {};
    return {
      success: Boolean(res.success) && !res.error,
      output: res.output ?? '',
      error: res.error || undefined,
      testResults: res.testResults ?? undefined,
    };
  }
}

// Module-level singleton. Construction is cheap (no browser APIs).
const runner = new PyodideRunner();

/** Preload the Pyodide runtime so the first run is fast. */
export async function loadPyodide(): Promise<void> {
  return runner.load();
}

/** Run arbitrary Python code, returning captured stdout and errors. */
export async function runCode(
  code: string,
  timeoutMs = 10000
): Promise<CodeExecutionResult> {
  return runner.runCode(code, timeoutMs);
}

/** Run student code against test cases for a given function. */
export async function runTestCases(
  code: string,
  testCases: ProblemTestCase[],
  functionName: string,
  timeoutMs = 15000
): Promise<CodeExecutionResult> {
  return runner.runTestCases(code, testCases, functionName, timeoutMs);
}

export { PyodideRunner };
