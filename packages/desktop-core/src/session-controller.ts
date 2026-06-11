import type {
  InitializeResponse,
  JsonValue,
  RequestId,
  RuntimeProtocolError,
  ServerNotification,
  ServerRequest,
  ThreadStartParams,
  ThreadStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
} from "@mimodex/runtime-client";

export type ConnectionStatus = "error" | "idle" | "ready" | "connecting";
export type TurnStatus = "completed" | "failed" | "idle" | "inProgress" | "interrupted";
export type TimelineKind =
  | "approval"
  | "assistant"
  | "command"
  | "error"
  | "file"
  | "reasoning"
  | "status"
  | "user";
export type ApprovalDecision = "accept" | "acceptForSession" | "cancel" | "decline";

export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  title: string;
  content: string;
  status: string | null;
};

export type PendingApproval = {
  id: RequestId;
  itemId: string;
  kind: "command" | "file" | "permission";
  title: string;
  detail: string;
  reason: string;
};

export type SessionState = {
  connection: ConnectionStatus;
  platform: string | null;
  projectPath: string | null;
  model: string;
  threadId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  timeline: readonly TimelineEntry[];
  approvals: readonly PendingApproval[];
  diff: string;
  error: string | null;
};

export type StartTaskInput = {
  text: string;
  projectPath: string;
  model: "mimo-v2.5" | "mimo-v2.5-pro";
  sandbox: "danger-full-access" | "read-only" | "workspace-write";
};

export interface RuntimeClientPort {
  initialize(): Promise<InitializeResponse>;
  startThread(params: ThreadStartParams): Promise<ThreadStartResponse>;
  startTurn(params: TurnStartParams): Promise<TurnStartResponse>;
  interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse>;
  onNotification(listener: (notification: ServerNotification) => void): () => void;
  onServerRequest(listener: (request: ServerRequest) => void): () => void;
  onProtocolError(listener: (error: RuntimeProtocolError) => void): () => void;
  onExit(listener: (details: { code?: number; signal?: string } | undefined) => void): () => void;
  respond(id: RequestId, result?: JsonValue): Promise<void>;
  close(): Promise<void>;
}

type StateListener = () => void;

const initialState: SessionState = {
  connection: "idle",
  platform: null,
  projectPath: null,
  model: "mimo-v2.5",
  threadId: null,
  turnId: null,
  turnStatus: "idle",
  timeline: [],
  approvals: [],
  diff: "",
  error: null,
};

export class DesktopSessionController {
  readonly #runtime: RuntimeClientPort;
  readonly #listeners = new Set<StateListener>();
  readonly #unsubscribers: Array<() => void>;
  #state: SessionState = initialState;
  #entrySequence = 0;

  constructor(runtime: RuntimeClientPort) {
    this.#runtime = runtime;
    this.#unsubscribers = [
      runtime.onNotification((notification) => this.#handleNotification(notification)),
      runtime.onServerRequest((request) => this.#handleServerRequest(request)),
      runtime.onProtocolError((error) => this.#recordProtocolError(error.message)),
      runtime.onExit((details) => {
        const suffix = details?.code === undefined ? "" : `，退出码 ${details.code}`;
        this.#disconnect(`Runtime 已断开${suffix}`);
      }),
    ];
  }

  getSnapshot = (): SessionState => this.#state;

  subscribe = (listener: StateListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async connect(): Promise<void> {
    if (this.#state.connection === "ready" || this.#state.connection === "connecting") {
      return;
    }
    this.#publish({ connection: "connecting", error: null });
    try {
      const runtime = await this.#runtime.initialize();
      this.#publish({ connection: "ready", platform: runtime.platformOs, error: null });
    } catch (error) {
      this.#disconnect(errorMessage(error));
      throw error;
    }
  }

  async startTask(input: StartTaskInput): Promise<void> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("任务内容不能为空");
    }
    if (this.#state.connection !== "ready") {
      throw new Error("Runtime 尚未连接");
    }
    if (this.#state.turnStatus === "inProgress") {
      throw new Error("已有任务正在执行");
    }

    const existingThreadId =
      this.#state.projectPath === input.projectPath ? this.#state.threadId : null;
    this.#append({
      id: this.#nextId("user"),
      kind: "user",
      title: "你",
      content: text,
      status: null,
    });
    this.#publish({
      projectPath: input.projectPath,
      model: input.model,
      threadId: existingThreadId,
      turnStatus: "inProgress",
      error: null,
    });

    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const thread = await this.#runtime.startThread({
          cwd: input.projectPath,
          model: input.model,
          modelProvider: "mimo",
          approvalPolicy: "on-request",
          sandbox: input.sandbox,
        });
        threadId = thread.thread.id;
        this.#publish({ threadId });
      }

      const response = await this.#runtime.startTurn({
        threadId,
        input: [{ type: "text", text, textElements: [] }],
        model: input.model,
      });
      this.#publish({
        turnId: response.turn.id,
        turnStatus: response.turn.status,
      });
    } catch (error) {
      this.#recordError(errorMessage(error));
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#state.threadId || !this.#state.turnId || this.#state.turnStatus !== "inProgress") {
      return;
    }
    this.#append({
      id: this.#nextId("status"),
      kind: "status",
      title: "正在停止",
      content: "已向 Runtime 发送中断请求。",
      status: "inProgress",
    });
    await this.#runtime.interruptTurn({
      threadId: this.#state.threadId,
      turnId: this.#state.turnId,
    });
  }

  async resolveApproval(id: RequestId, decision: ApprovalDecision): Promise<void> {
    const approval = this.#state.approvals.find((item) => item.id === id);
    if (!approval) {
      return;
    }
    await this.#runtime.respond(id, { decision });
    this.#publish({
      approvals: this.#state.approvals.filter((item) => item.id !== id),
    });
    this.#append({
      id: this.#nextId("approval"),
      kind: "approval",
      title: decision === "decline" || decision === "cancel" ? "已拒绝操作" : "已批准操作",
      content: approval.detail,
      status: decision,
    });
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      unsubscribe();
    }
    await this.#runtime.close();
  }

  #handleNotification(notification: ServerNotification): void {
    const params = asRecord(notification.params);
    switch (notification.method) {
      case "turn/started": {
        const turn = asRecord(params?.turn);
        this.#publish({
          turnId: stringValue(turn?.id) ?? this.#state.turnId,
          turnStatus: "inProgress",
        });
        return;
      }
      case "turn/completed": {
        const turn = asRecord(params?.turn);
        const status = turnStatus(turn?.status);
        this.#publish({ turnStatus: status, turnId: stringValue(turn?.id) ?? this.#state.turnId });
        if (status !== "completed") {
          this.#append({
            id: this.#nextId("status"),
            kind: status === "failed" ? "error" : "status",
            title: status === "interrupted" ? "任务已停止" : "任务未完成",
            content: nestedErrorMessage(turn) ?? `轮次状态：${status}`,
            status,
          });
        }
        return;
      }
      case "item/agentMessage/delta":
        this.#appendDelta(params, "assistant", "MiMo");
        return;
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        this.#appendDelta(params, "reasoning", "推理过程");
        return;
      case "item/commandExecution/outputDelta":
        this.#appendDelta(params, "command", "命令输出");
        return;
      case "turn/diff/updated":
        this.#publish({ diff: stringValue(params?.diff) ?? "" });
        return;
      case "item/started":
      case "item/completed":
        this.#projectItem(params, notification.method === "item/completed");
        return;
      case "serverRequest/resolved": {
        const requestId = requestIdValue(params?.requestId);
        if (requestId !== null) {
          this.#publish({
            approvals: this.#state.approvals.filter((approval) => approval.id !== requestId),
          });
        }
        return;
      }
      case "error":
        this.#recordError(nestedErrorMessage(params) ?? "Runtime 报告了未知错误");
        return;
      default:
        return;
    }
  }

  #handleServerRequest(request: ServerRequest): void {
    const params = asRecord(request.params);
    const kind = approvalKind(request.method);
    if (!kind) {
      return;
    }
    const detail =
      stringValue(params?.command) ??
      stringValue(params?.grantRoot) ??
      stringValue(params?.itemId) ??
      request.method;
    const approval: PendingApproval = {
      id: request.id,
      itemId: stringValue(params?.itemId) ?? String(request.id),
      kind,
      title:
        kind === "command" ? "命令需要审批" : kind === "file" ? "文件修改需要审批" : "权限请求",
      detail,
      reason: stringValue(params?.reason) ?? "Runtime 要求确认后继续。",
    };
    this.#publish({
      approvals: [...this.#state.approvals.filter((item) => item.id !== request.id), approval],
    });
  }

  #appendDelta(
    params: Record<string, unknown> | null,
    kind: Extract<TimelineKind, "assistant" | "command" | "reasoning">,
    title: string,
  ): void {
    const itemId = stringValue(params?.itemId);
    const delta = stringValue(params?.delta);
    if (!itemId || !delta) {
      return;
    }
    const existing = this.#state.timeline.find((entry) => entry.id === itemId);
    if (existing) {
      this.#replaceEntry(itemId, { ...existing, content: `${existing.content}${delta}` });
    } else {
      this.#append({ id: itemId, kind, title, content: delta, status: "inProgress" });
    }
  }

  #projectItem(params: Record<string, unknown> | null, completed: boolean): void {
    const item = asRecord(params?.item);
    const id = stringValue(item?.id);
    const type = stringValue(item?.type);
    if (!id || !type) {
      return;
    }
    if (type === "commandExecution") {
      this.#replaceOrAppend({
        id,
        kind: "command",
        title: stringValue(item?.command) ?? "命令执行",
        content: stringValue(item?.aggregatedOutput) ?? "",
        status: stringValue(item?.status) ?? (completed ? "completed" : "inProgress"),
      });
    } else if (type === "fileChange") {
      this.#replaceOrAppend({
        id,
        kind: "file",
        title: "文件变更",
        content: fileChangeSummary(item?.changes),
        status: stringValue(item?.status) ?? (completed ? "completed" : "inProgress"),
      });
    }
  }

  #replaceOrAppend(entry: TimelineEntry): void {
    if (this.#state.timeline.some((item) => item.id === entry.id)) {
      this.#replaceEntry(entry.id, entry);
    } else {
      this.#append(entry);
    }
  }

  #replaceEntry(id: string, entry: TimelineEntry): void {
    this.#publish({
      timeline: this.#state.timeline.map((item) => (item.id === id ? entry : item)),
    });
  }

  #append(entry: TimelineEntry): void {
    this.#publish({ timeline: [...this.#state.timeline, entry] });
  }

  #recordError(message: string): void {
    this.#publish({ error: message, turnStatus: "failed" });
    this.#append({
      id: this.#nextId("error"),
      kind: "error",
      title: "发生错误",
      content: message,
      status: "failed",
    });
  }

  #recordProtocolError(message: string): void {
    this.#publish({ error: message });
    this.#append({
      id: this.#nextId("protocol-error"),
      kind: "error",
      title: "Runtime 协议异常",
      content: message,
      status: "diagnostic",
    });
  }

  #disconnect(message: string): void {
    this.#publish({ connection: "error" });
    this.#recordError(message);
  }

  #nextId(prefix: string): string {
    this.#entrySequence += 1;
    return `${prefix}-${this.#entrySequence}`;
  }

  #publish(changes: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...changes };
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requestIdValue(value: unknown): RequestId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function turnStatus(value: unknown): TurnStatus {
  return value === "completed" || value === "failed" || value === "inProgress" || value === "interrupted"
    ? value
    : "failed";
}

function approvalKind(method: string): PendingApproval["kind"] | null {
  if (method === "item/commandExecution/requestApproval") {
    return "command";
  }
  if (method === "item/fileChange/requestApproval") {
    return "file";
  }
  if (method === "item/permissions/requestApproval") {
    return "permission";
  }
  return null;
}

function nestedErrorMessage(value: Record<string, unknown> | null): string | null {
  return stringValue(asRecord(value?.error)?.message);
}

function fileChangeSummary(value: unknown): string {
  if (!Array.isArray(value)) {
    return "文件变更详情等待 Runtime 更新。";
  }
  const paths = value
    .map((change) => stringValue(asRecord(change)?.path))
    .filter((path): path is string => path !== null);
  return paths.length > 0 ? paths.join("\n") : "文件变更详情等待 Runtime 更新。";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
