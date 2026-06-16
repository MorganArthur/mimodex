import { RuntimeProtocolError } from "@mimodex/runtime-client";
import type {
  InitializeResponse,
  JsonValue,
  RequestId,
  RuntimeProtocolEvent,
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
import type { RuntimeClientPort } from "../src/index.js";

export class FakeRuntimeClient implements RuntimeClientPort {
  initializeBarrier: Promise<void> | null = null;
  resumeError: Error | null = null;
  readonly threadStarts: ThreadStartParams[] = [];
  readonly threadResumes: ThreadResumeParams[] = [];
  readonly threadArchives: ThreadArchiveParams[] = [];
  readonly threadUnarchives: ThreadUnarchiveParams[] = [];
  readonly turnStarts: TurnStartParams[] = [];
  readonly interrupts: TurnInterruptParams[] = [];
  readonly responses: Array<{ id: RequestId; result: JsonValue | undefined }> = [];
  readonly #notificationListeners = new Set<(notification: ServerNotification) => void>();
  readonly #protocolEventListeners = new Set<(event: RuntimeProtocolEvent) => void>();
  readonly #requestListeners = new Set<(request: ServerRequest) => void>();
  readonly #protocolErrorListeners = new Set<(error: RuntimeProtocolError) => void>();
  readonly #exitListeners = new Set<
    (details: { code?: number; signal?: string } | undefined) => void
  >();

  async initialize(): Promise<InitializeResponse> {
    await this.initializeBarrier;
    return {
      userAgent: "mimodex-test",
      codexHome: "C:\\mimodex",
      platformFamily: "windows",
      platformOs: "windows",
    };
  }

  async startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    this.threadStarts.push(params);
    return {
      thread: { id: "thread-1" },
      model: params.model ?? "mimo-v2.5",
      modelProvider: "mimo",
      cwd: params.cwd ?? "D:\\project",
    };
  }

  async resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    this.threadResumes.push(params);
    if (this.resumeError) {
      throw this.resumeError;
    }
    return {
      thread: { id: params.threadId },
      model: "mimo-v2.5-pro",
      modelProvider: "mimo",
      cwd: "D:\\project",
    };
  }

  async archiveThread(params: ThreadArchiveParams): Promise<ThreadArchiveResponse> {
    this.threadArchives.push(params);
    return {};
  }

  async unarchiveThread(params: ThreadUnarchiveParams): Promise<ThreadUnarchiveResponse> {
    this.threadUnarchives.push(params);
    return {};
  }

  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    this.turnStarts.push(params);
    return { turn: { id: "turn-1", status: "inProgress" } };
  }

  async interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    this.interrupts.push(params);
    return {};
  }

  onNotification(listener: (notification: ServerNotification) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onServerRequest(listener: (request: ServerRequest) => void): () => void {
    this.#requestListeners.add(listener);
    return () => this.#requestListeners.delete(listener);
  }

  onProtocolEvent(listener: (event: RuntimeProtocolEvent) => void): () => void {
    this.#protocolEventListeners.add(listener);
    return () => this.#protocolEventListeners.delete(listener);
  }

  onProtocolError(listener: (error: RuntimeProtocolError) => void): () => void {
    this.#protocolErrorListeners.add(listener);
    return () => this.#protocolErrorListeners.delete(listener);
  }

  onExit(listener: (details: { code?: number; signal?: string } | undefined) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  async respond(id: RequestId, result?: JsonValue): Promise<void> {
    this.responses.push({ id, result });
  }

  async close(): Promise<void> {}

  emitNotification(notification: ServerNotification): void {
    for (const listener of this.#notificationListeners) {
      listener(notification);
    }
  }

  emitRequest(request: ServerRequest): void {
    for (const listener of this.#requestListeners) {
      listener(request);
    }
  }

  emitProtocolError(message: string): void {
    const error = new RuntimeProtocolError(message);
    for (const listener of this.#protocolErrorListeners) {
      listener(error);
    }
  }

  emitProtocolEvent(event: RuntimeProtocolEvent): void {
    for (const listener of this.#protocolEventListeners) {
      listener(event);
    }
  }
}
