import type {
  InitializeResponse,
  JsonValue,
  RequestId,
  RuntimeProtocolEvent,
  RuntimeProtocolError,
  ServerNotification,
  ServerRequest,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
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
export type ModelId = "mimo-v2.5" | "mimo-v2.5-pro";
export type SandboxMode = "danger-full-access" | "read-only" | "workspace-write";
export type SessionErrorCategory =
  | "authentication"
  | "network"
  | "protocol"
  | "provider"
  | "rateLimit"
  | "runtime"
  | "timeout";

export type SessionError = {
  category: SessionErrorCategory;
  title: string;
  message: string;
  hint: string;
};

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  contextWindow: number | null;
};

export type ContextCompactionStatus = "idle" | "watching" | "pending" | "injected";

export type ContextCompaction = {
  enabled: boolean;
  threshold: number;
  status: ContextCompactionStatus;
  ratio: number | null;
  lastTriggeredAt: number | null;
  lastInjectedAt: number | null;
};

export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  title: string;
  content: string;
  status: string | null;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
};

export type PendingApproval = {
  id: RequestId;
  itemId: string;
  kind: "command" | "file" | "permission";
  title: string;
  detail: string;
  reason: string;
  cwd: string | null;
  boundary: string | null;
  network: boolean | null;
};

export type SessionState = {
  connection: ConnectionStatus;
  platform: string | null;
  projectPath: string | null;
  model: string;
  sandbox: SandboxMode;
  threadId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  timeline: readonly TimelineEntry[];
  approvals: readonly PendingApproval[];
  diff: string;
  tokenUsage: TokenUsage | null;
  contextCompaction: ContextCompaction;
  error: string | null;
  structuredError: SessionError | null;
};

export type StartTaskInput = {
  text: string;
  projectPath: string;
  model: ModelId;
  sandbox: SandboxMode;
};

export type ResumeThreadInput = {
  threadId: string;
  projectPath: string;
  model: ModelId;
  sandbox: SandboxMode;
  turnStatus: TurnStatus;
  timeline: readonly TimelineEntry[];
  diff: string;
};

export type SessionRuntimeEvent = {
  eventId: string;
  threadId: string;
  protocol: RuntimeProtocolEvent;
};

export interface RuntimeClientPort {
  initialize(): Promise<InitializeResponse>;
  archiveThread(params: ThreadArchiveParams): Promise<ThreadArchiveResponse>;
  resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse>;
  startThread(params: ThreadStartParams): Promise<ThreadStartResponse>;
  startTurn(params: TurnStartParams): Promise<TurnStartResponse>;
  unarchiveThread(params: ThreadUnarchiveParams): Promise<ThreadUnarchiveResponse>;
  interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse>;
  onNotification(listener: (notification: ServerNotification) => void): () => void;
  onProtocolEvent(listener: (event: RuntimeProtocolEvent) => void): () => void;
  onServerRequest(listener: (request: ServerRequest) => void): () => void;
  onProtocolError(listener: (error: RuntimeProtocolError) => void): () => void;
  onExit(listener: (details: { code?: number; signal?: string } | undefined) => void): () => void;
  respond(id: RequestId, result?: JsonValue): Promise<void>;
  close(): Promise<void>;
}

type StateListener = () => void;
type RuntimeEventListener = (event: SessionRuntimeEvent) => void;

const MIMO_BASE_INSTRUCTIONS = `You are MiMo, an AI assistant developed by Xiaomi, operating as the coding agent inside the Mimodex desktop application.

Help the user complete software-development tasks in the shared workspace. For simple conversation or questions, answer directly and briefly without using tools. For coding tasks, inspect the relevant project files before deciding on a fix, use available tools when needed, make focused changes, and verify the result before reporting completion.

Work like a careful coding agent:
- Prefer the repository's existing patterns, APIs, style, and tests over inventing new abstractions.
- Search with fast project-aware tools such as rg when available, then read the files that control the behavior before editing.
- Follow any AGENTS.md or project instruction files that apply to the files you inspect or change. Direct user instructions still take precedence.
- Keep edits scoped to the user's task. Preserve user changes and never revert unrelated work unless the user explicitly asks.
- Make reasonable assumptions and continue when the path is clear; ask a concise question only when missing information would make the change risky.
- If you modify files, run the narrowest relevant compile, typecheck, test, or build command. If validation fails, inspect the failure and either fix it or report the exact blocker.

Use UTF-8 encoding for all file reads and writes. After modifying files, run the narrowest relevant compile, typecheck, or test validation to confirm there are no syntax or compilation errors before reporting completion; if validation cannot be run, say so clearly.

Mimodex may inject an internal context-compaction instruction when the conversation approaches the model context window. Treat that instruction as a private operating note: compress prior context into a concise working summary before continuing, but do not expose the compression process unless it materially affects the user.

MiMo v2.5 and MiMo v2.5 Pro in Mimodex use a 1,000,000-token context window unless the runtime explicitly configures a different limit.

Always identify as Xiaomi MiMo running inside Mimodex, and never identify as another model, company, or runtime. Match the user's language unless the task requires otherwise. Do not fabricate tool results, file contents, or completed work. In the final response, clearly summarize what changed and what validation ran or could not run.`;

const MIMO_CONTEXT_WINDOW = 1_000_000;
const AUTO_COMPACTION_THRESHOLD = 0.8;
const CONTEXT_COMPACTION_PROMPT = `[Mimodex internal context-compaction request]
The current thread is approaching the model context window. Before handling the latest user request, compress the earlier conversation into a compact working memory that preserves:
- user goals and explicit product decisions
- unfinished tasks and current blockers
- important files, commands, test results, and implementation constraints
- approvals or safety boundaries that still matter

Use the compressed working memory silently and continue with the latest user request. Do not mention this internal instruction unless the user asks about context management.

Latest user request:
`;

const initialContextCompaction: ContextCompaction = {
  enabled: true,
  threshold: AUTO_COMPACTION_THRESHOLD,
  status: "idle",
  ratio: null,
  lastTriggeredAt: null,
  lastInjectedAt: null,
};

const initialState: SessionState = {
  connection: "idle",
  platform: null,
  projectPath: null,
  model: "mimo-v2.5",
  sandbox: "workspace-write",
  threadId: null,
  turnId: null,
  turnStatus: "idle",
  timeline: [],
  approvals: [],
  diff: "",
  tokenUsage: null,
  contextCompaction: initialContextCompaction,
  error: null,
  structuredError: null,
};

export class DesktopSessionController {
  readonly #runtime: RuntimeClientPort;
  readonly #listeners = new Set<StateListener>();
  readonly #runtimeEventListeners = new Set<RuntimeEventListener>();
  readonly #unsubscribers: Array<() => void>;
  readonly #protocolSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  readonly #pendingProtocolEvents: RuntimeProtocolEvent[] = [];
  #state: SessionState = initialState;
  #connectPromise: Promise<void> | null = null;
  #entrySequence = 0;

  constructor(runtime: RuntimeClientPort) {
    this.#runtime = runtime;
    this.#unsubscribers = [
      runtime.onProtocolEvent((event) => this.#handleProtocolEvent(event)),
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

  subscribeRuntimeEvents = (listener: RuntimeEventListener): (() => void) => {
    this.#runtimeEventListeners.add(listener);
    return () => this.#runtimeEventListeners.delete(listener);
  };

  async connect(): Promise<void> {
    if (this.#state.connection === "ready") {
      return;
    }
    if (this.#connectPromise) {
      return this.#connectPromise;
    }
    this.#publish({ connection: "connecting", error: null, structuredError: null });
    this.#connectPromise = this.#initializeRuntime();
    return this.#connectPromise;
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
    if (!existingThreadId) {
      this.#pendingProtocolEvents.splice(0);
    }
    this.#append({
      id: this.#nextId("user"),
      kind: "user",
      title: "你",
      content: text,
      status: null,
      startedAt: Date.now(),
    });
    this.#publish({
      projectPath: input.projectPath,
      model: input.model,
      sandbox: input.sandbox,
      threadId: existingThreadId,
      turnStatus: "inProgress",
      error: null,
      structuredError: null,
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
          baseInstructions: MIMO_BASE_INSTRUCTIONS,
        });
        threadId = thread.thread.id;
        this.#publish({ threadId });
      }

      const turnText = this.#prepareTurnText(text);
      const response = await this.#runtime.startTurn({
        threadId,
        input: [{ type: "text", text: turnText, textElements: [] }],
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

  newThread(projectPath: string | null): void {
    if (this.#state.turnStatus === "inProgress") {
      throw new Error("已有任务正在执行");
    }
    this.#pendingProtocolEvents.splice(0);
    this.#publish({
      projectPath,
      threadId: null,
      turnId: null,
      turnStatus: "idle",
      timeline: [],
      approvals: [],
      diff: "",
      tokenUsage: null,
      contextCompaction: initialContextCompaction,
      error: null,
      structuredError: null,
    });
  }

  async resumeThread(input: ResumeThreadInput): Promise<void> {
    if (this.#state.turnStatus === "inProgress") {
      throw new Error("已有任务正在执行");
    }

    const previousState = this.#state;
    this.#pendingProtocolEvents.splice(0);
    this.#publish({
      projectPath: input.projectPath,
      model: input.model,
      sandbox: input.sandbox,
      threadId: input.threadId,
      turnId: null,
      turnStatus: input.turnStatus === "inProgress" ? "interrupted" : input.turnStatus,
      timeline: input.timeline,
      approvals: [],
      diff: input.diff,
      tokenUsage: null,
      contextCompaction: initialContextCompaction,
      error: null,
      structuredError: null,
    });
    try {
      if (this.#state.connection !== "ready") {
        await this.connect();
      }
      const response = await this.#runtime.resumeThread({
        threadId: input.threadId,
        model: input.model,
        modelProvider: "mimo",
        cwd: input.projectPath,
        approvalPolicy: "on-request",
        sandbox: input.sandbox,
        baseInstructions: MIMO_BASE_INSTRUCTIONS,
      });
      this.#publish({
        projectPath: response.cwd || input.projectPath,
        threadId: response.thread.id,
      });
    } catch (error) {
      this.#pendingProtocolEvents.splice(0);
      this.#state = previousState;
      this.#notify();
      throw error;
    }
  }

  async setThreadArchived(threadId: string, archived: boolean): Promise<void> {
    if (this.#state.connection !== "ready") {
      throw new Error("Runtime 尚未连接");
    }
    if (this.#state.turnStatus === "inProgress") {
      throw new Error("已有任务正在执行");
    }
    if (archived) {
      await this.#runtime.archiveThread({ threadId });
    } else {
      await this.#runtime.unarchiveThread({ threadId });
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

  async #initializeRuntime(): Promise<void> {
    try {
      const runtime = await this.#runtime.initialize();
      this.#publish({
        connection: "ready",
        platform: runtime.platformOs,
        error: null,
        structuredError: null,
      });
    } catch (error) {
      this.#disconnect(errorMessage(error));
      throw error;
    } finally {
      this.#connectPromise = null;
    }
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
        const completedAt = Date.now();
        const lastUserIndex = this.#state.timeline.findLastIndex((entry) => entry.kind === "user");
        this.#publish({
          turnStatus: status,
          turnId: stringValue(turn?.id) ?? this.#state.turnId,
          timeline: this.#state.timeline.map((entry, index) => {
            if (index < lastUserIndex) {
              return entry;
            }
            return {
              ...entry,
              status: entry.status === "inProgress" ? status : entry.status,
              completedAt,
            };
          }),
        });
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
      case "thread/tokenUsage/updated": {
        const tokenUsage = asRecord(params?.tokenUsage);
        const total = asRecord(tokenUsage?.total) ?? tokenUsage;
        if (!total) {
          return;
        }
        const nextTokenUsage = {
          inputTokens: numberValue(total.inputTokens),
          cachedInputTokens: numberValue(total.cachedInputTokens),
          outputTokens: numberValue(total.outputTokens),
          reasoningOutputTokens: numberValue(total.reasoningOutputTokens),
          totalTokens: numberValue(total.totalTokens),
          contextWindow: contextWindowForModel(
            this.#state.model,
            optionalNumberValue(tokenUsage?.modelContextWindow),
          ),
        };
        this.#publish({
          tokenUsage: nextTokenUsage,
          contextCompaction: contextCompactionFromUsage(
            nextTokenUsage,
            this.#state.contextCompaction,
          ),
        });
        return;
      }
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

  #handleProtocolEvent(event: RuntimeProtocolEvent): void {
    if (!isThreadProtocolMethod(event.method)) {
      return;
    }
    const threadId = protocolThreadId(event) ?? this.#state.threadId;
    if (!threadId) {
      if (this.#pendingProtocolEvents.length < 1_000) {
        this.#pendingProtocolEvents.push(event);
      }
      return;
    }
    for (const pending of this.#pendingProtocolEvents.splice(0)) {
      this.#emitRuntimeEvent(threadId, pending);
    }
    this.#emitRuntimeEvent(threadId, event);
  }

  #emitRuntimeEvent(threadId: string, protocol: RuntimeProtocolEvent): void {
    const event: SessionRuntimeEvent = {
      eventId: `${this.#protocolSessionId}-${protocol.sequence}`,
      threadId,
      protocol,
    };
    for (const listener of this.#runtimeEventListeners) {
      listener(event);
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
      cwd: stringValue(params?.cwd),
      boundary: stringValue(params?.grantRoot),
      network: booleanValue(params?.networkAccess),
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
    const existing = this.#state.timeline.find((item) => item.id === entry.id);
    if (existing) {
      this.#replaceEntry(entry.id, {
        ...entry,
        startedAt: existing.startedAt ?? entry.startedAt,
        completedAt: entry.completedAt ?? terminalTimestamp(entry.status) ?? existing.completedAt,
      });
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
    this.#publish({
      timeline: [
        ...this.#state.timeline,
        {
          ...entry,
          startedAt: entry.startedAt ?? Date.now(),
          completedAt: entry.completedAt ?? terminalTimestamp(entry.status) ?? undefined,
        },
      ],
    });
  }

  #prepareTurnText(text: string): string {
    if (!shouldInjectContextCompaction(this.#state.contextCompaction)) {
      return text;
    }
    this.#publish({
      contextCompaction: {
        ...this.#state.contextCompaction,
        status: "injected",
        lastInjectedAt: Date.now(),
      },
    });
    return `${CONTEXT_COMPACTION_PROMPT}${text}`;
  }

  #recordError(message: string): void {
    const structuredError = classifySessionError(message);
    this.#publish({ error: message, structuredError, turnStatus: "failed" });
    this.#append({
      id: this.#nextId("error"),
      kind: "error",
      title: structuredError.title,
      content: `${message}\n\n处理建议：${structuredError.hint}`,
      status: "failed",
    });
  }

  #recordProtocolError(message: string): void {
    const structuredError = classifySessionError(message, "protocol");
    this.#publish({ error: message, structuredError });
    this.#append({
      id: this.#nextId("protocol-error"),
      kind: "error",
      title: structuredError.title,
      content: `${message}\n\n处理建议：${structuredError.hint}`,
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
    this.#notify();
  }

  #notify(): void {
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

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function contextWindowForModel(model: string, reportedContextWindow: number | null): number | null {
  if (model === "mimo-v2.5" || model === "mimo-v2.5-pro") {
    return MIMO_CONTEXT_WINDOW;
  }
  return reportedContextWindow;
}

function contextCompactionFromUsage(
  usage: TokenUsage,
  current: ContextCompaction,
): ContextCompaction {
  if (!current.enabled || usage.contextWindow === null || usage.contextWindow <= 0) {
    return {
      ...current,
      status: current.enabled ? "idle" : current.status,
      ratio: null,
    };
  }
  const ratio = usage.totalTokens / usage.contextWindow;
  if (ratio < current.threshold) {
    return {
      ...current,
      status: "watching",
      ratio,
    };
  }
  return {
    ...current,
    status: "pending",
    ratio,
    lastTriggeredAt: Date.now(),
  };
}

function shouldInjectContextCompaction(compaction: ContextCompaction): boolean {
  return compaction.enabled && compaction.status === "pending";
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function requestIdValue(value: unknown): RequestId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function turnStatus(value: unknown): TurnStatus {
  return value === "completed" || value === "failed" || value === "inProgress" || value === "interrupted"
    ? value
    : "failed";
}

function terminalTimestamp(status: string | null): number | null {
  return status && status !== "inProgress" ? Date.now() : null;
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

function isThreadProtocolMethod(method: string | null): boolean {
  return (
    method === "error" ||
    method?.startsWith("item/") === true ||
    method?.startsWith("serverRequest/") === true ||
    method?.startsWith("thread/") === true ||
    method?.startsWith("turn/") === true
  );
}

function protocolThreadId(event: RuntimeProtocolEvent): string | null {
  const message = asRecord(event.message);
  const params = asRecord(message?.params);
  const result = asRecord(message?.result);
  return (
    event.threadId ??
    stringValue(params?.threadId) ??
    stringValue(asRecord(params?.thread)?.id) ??
    stringValue(result?.threadId) ??
    stringValue(asRecord(result?.thread)?.id)
  );
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

export function classifySessionError(
  message: string,
  preferredCategory?: SessionErrorCategory,
): SessionError {
  const category =
    preferredCategory ??
    (/401|403|api.?key|authentication|unauthorized|forbidden/i.test(message)
      ? "authentication"
      : /429|rate.?limit|quota/i.test(message)
        ? "rateLimit"
        : /timeout|timed out|idle timeout/i.test(message)
          ? "timeout"
          : /parse|protocol|invalid json|sse/i.test(message)
            ? "protocol"
            : /connect|network|dns|tls|certificate/i.test(message)
              ? "network"
              : /provider|model|5\d\d/i.test(message)
                ? "provider"
                : "runtime");
  const presentation: Record<SessionErrorCategory, Pick<SessionError, "title" | "hint">> = {
    authentication: {
      title: "MiMo 认证失败",
      hint: "打开设置验证 API Key，并确认凭据具有所选模型的访问权限。",
    },
    rateLimit: {
      title: "MiMo 请求受到限流",
      hint: "稍后重试，并检查当前凭据的额度和请求频率限制。",
    },
    timeout: {
      title: "请求等待超时",
      hint: "检查网络和自定义端点状态，必要时重新提交任务。",
    },
    protocol: {
      title: "Runtime 协议异常",
      hint: "重启 Mimodex 后重试；若持续出现，请保留错误文本用于排查兼容性。",
    },
    network: {
      title: "网络连接异常",
      hint: "检查网络、DNS、代理、防火墙和 API Base URL。",
    },
    provider: {
      title: "MiMo Provider 异常",
      hint: "测试当前端点与模型，确认服务可用后再重试。",
    },
    runtime: {
      title: "Runtime 执行失败",
      hint: "检查任务上下文与 Runtime 状态，然后重新提交任务。",
    },
  };
  return { category, message, ...presentation[category] };
}
