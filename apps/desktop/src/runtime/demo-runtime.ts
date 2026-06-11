import type {
  InitializeResponse,
  JsonValue,
  RequestId,
  RuntimeProtocolError,
  ServerNotification,
  ServerRequest,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
} from "@mimodex/runtime-client";
import type { RuntimeClientPort } from "@mimodex/desktop-core";

type Listener<T> = (value: T) => void;

export class DemoRuntimeClient implements RuntimeClientPort {
  readonly #notifications = new Set<Listener<ServerNotification>>();
  readonly #requests = new Set<Listener<ServerRequest>>();
  readonly #protocolErrors = new Set<Listener<RuntimeProtocolError>>();
  readonly #exits = new Set<Listener<{ code?: number; signal?: string } | undefined>>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #threadId = "demo-thread";
  #turnId = "demo-turn";
  #approvalId: RequestId | null = null;
  #closed = false;

  async initialize(): Promise<InitializeResponse> {
    await this.#delay(180);
    return {
      userAgent: "mimodex-demo",
      codexHome: "C:\\Users\\demo\\.mimodex",
      platformFamily: "windows",
      platformOs: "windows",
    };
  }

  async startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    this.#threadId = `demo-thread-${Date.now()}`;
    return {
      thread: { id: this.#threadId },
      model: params.model ?? "mimo-v2.5",
      modelProvider: "mimo",
      cwd: params.cwd ?? "D:\\project",
    };
  }

  async resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    this.#threadId = params.threadId;
    return {
      thread: { id: this.#threadId },
      model: "mimo-v2.5",
      modelProvider: "mimo",
      cwd: "D:\\0WORKSPACE\\mimodex",
    };
  }

  async startTurn(_params: TurnStartParams): Promise<TurnStartResponse> {
    this.#turnId = `demo-turn-${Date.now()}`;
    const turn = { id: this.#turnId, status: "inProgress" as const };
    this.#schedule(120, () => this.#emitNotification("turn/started", { threadId: this.#threadId, turn }));
    this.#schedule(360, () =>
      this.#emitNotification("item/reasoning/textDelta", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        itemId: "demo-reasoning",
        contentIndex: 0,
        delta: "我会先检查项目状态和相关测试，再定位最小修改范围。",
      }),
    );
    this.#schedule(760, () =>
      this.#emitNotification("item/started", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        item: {
          id: "demo-command",
          type: "commandExecution",
          command: "npm run verify",
          cwd: "D:\\0WORKSPACE\\mimodex",
          status: "inProgress",
        },
      }),
    );
    this.#schedule(1_050, () => {
      this.#approvalId = "demo-approval";
      this.#emitRequest({
        id: this.#approvalId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: this.#threadId,
          turnId: this.#turnId,
          itemId: "demo-command",
          command: "npm run verify",
          cwd: "D:\\0WORKSPACE\\mimodex",
          reason: "运行项目验证命令",
        },
      });
    });
    return { turn };
  }

  async interruptTurn(_params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    this.#clearTimers();
    this.#emitNotification("turn/completed", {
      threadId: this.#threadId,
      turn: { id: this.#turnId, status: "interrupted" },
    });
    return {};
  }

  onNotification(listener: Listener<ServerNotification>): () => void {
    return this.#listen(this.#notifications, listener);
  }

  onServerRequest(listener: Listener<ServerRequest>): () => void {
    return this.#listen(this.#requests, listener);
  }

  onProtocolError(listener: Listener<RuntimeProtocolError>): () => void {
    return this.#listen(this.#protocolErrors, listener);
  }

  onExit(listener: Listener<{ code?: number; signal?: string } | undefined>): () => void {
    return this.#listen(this.#exits, listener);
  }

  async respond(id: RequestId, result: JsonValue = {}): Promise<void> {
    if (id !== this.#approvalId) {
      return;
    }
    this.#approvalId = null;
    this.#emitNotification("serverRequest/resolved", {
      threadId: this.#threadId,
      requestId: id,
    });
    const decision =
      result !== null && typeof result === "object" && !Array.isArray(result)
        ? result.decision
        : undefined;
    if (decision === "accept" || decision === "acceptForSession") {
      this.#continueAcceptedFlow();
    } else {
      this.#continueDeclinedFlow();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#clearTimers();
  }

  #continueAcceptedFlow(): void {
    this.#schedule(180, () =>
      this.#emitNotification("item/commandExecution/outputDelta", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        itemId: "demo-command",
        delta: "14 tests passed\n",
      }),
    );
    this.#schedule(420, () =>
      this.#emitNotification("item/completed", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        item: {
          id: "demo-command",
          type: "commandExecution",
          command: "npm run verify",
          aggregatedOutput: "14 tests passed",
          status: "completed",
        },
      }),
    );
    this.#schedule(620, () =>
      this.#emitNotification("turn/diff/updated", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        diff: [
          "diff --git a/src/math.ts b/src/math.ts",
          "--- a/src/math.ts",
          "+++ b/src/math.ts",
          "@@ -1 +1 @@",
          "- return left - right;",
          "+ return left + right;",
        ].join("\n"),
      }),
    );
    this.#schedule(820, () =>
      this.#emitNotification("item/agentMessage/delta", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        itemId: "demo-message",
        delta: "已经定位并修复问题，",
      }),
    );
    this.#schedule(1_020, () =>
      this.#emitNotification("item/agentMessage/delta", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        itemId: "demo-message",
        delta: "验证命令全部通过。",
      }),
    );
    this.#schedule(1_260, () =>
      this.#emitNotification("turn/completed", {
        threadId: this.#threadId,
        turn: { id: this.#turnId, status: "completed" },
      }),
    );
  }

  #continueDeclinedFlow(): void {
    this.#schedule(180, () =>
      this.#emitNotification("item/completed", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        item: {
          id: "demo-command",
          type: "commandExecution",
          command: "npm run verify",
          status: "declined",
        },
      }),
    );
    this.#schedule(420, () =>
      this.#emitNotification("item/agentMessage/delta", {
        threadId: this.#threadId,
        turnId: this.#turnId,
        itemId: "demo-message",
        delta: "已按你的决定跳过验证命令。",
      }),
    );
    this.#schedule(680, () =>
      this.#emitNotification("turn/completed", {
        threadId: this.#threadId,
        turn: { id: this.#turnId, status: "completed" },
      }),
    );
  }

  #emitNotification(method: string, params: JsonValue): void {
    if (this.#closed) {
      return;
    }
    for (const listener of this.#notifications) {
      listener({ method, params });
    }
  }

  #emitRequest(request: ServerRequest): void {
    if (this.#closed) {
      return;
    }
    for (const listener of this.#requests) {
      listener(request);
    }
  }

  #schedule(delay: number, callback: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      callback();
    }, delay);
    this.#timers.add(timer);
  }

  async #delay(delay: number): Promise<void> {
    await new Promise<void>((resolve) => this.#schedule(delay, resolve));
  }

  #clearTimers(): void {
    for (const timer of this.#timers) {
      clearTimeout(timer);
    }
    this.#timers.clear();
  }

  #listen<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}
