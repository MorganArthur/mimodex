import {
  JsonRpcResponseError,
  JsonRpcTimeoutError,
  RuntimeDisconnectedError,
  RuntimeProtocolError,
} from "./errors.js";
import { NdjsonDecoder } from "./ndjson.js";
import type {
  JsonObject,
  JsonRpcFailure,
  JsonRpcIncoming,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonValue,
  RequestId,
} from "./protocol.js";
import type { RuntimeTransport } from "./transport.js";

type Listener<T> = (event: T) => void;

type PendingRequest = {
  method: string;
  resolve: (value: JsonValue) => void;
  reject: (reason: unknown) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

export type JsonRpcClientOptions = {
  requestTimeoutMs?: number;
  maxBufferedCharacters?: number;
};

export class JsonRpcClient {
  readonly #transport: RuntimeTransport;
  readonly #decoder: NdjsonDecoder;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<RequestId, PendingRequest>();
  readonly #notificationListeners = new Set<Listener<JsonRpcNotification>>();
  readonly #requestListeners = new Set<Listener<JsonRpcRequest>>();
  readonly #protocolErrorListeners = new Set<Listener<RuntimeProtocolError>>();
  readonly #stderrListeners = new Set<Listener<string | Uint8Array>>();
  readonly #exitListeners = new Set<Listener<{ code?: number; signal?: string } | undefined>>();
  #nextId = 1;
  #starting = false;
  #started = false;
  #closed = false;

  constructor(transport: RuntimeTransport, options: JsonRpcClientOptions = {}) {
    this.#transport = transport;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#decoder = new NdjsonDecoder(options.maxBufferedCharacters);
  }

  async start(): Promise<void> {
    if (this.#started || this.#starting) {
      throw new Error("JSON-RPC client already starting or started");
    }
    if (this.#closed) {
      throw new RuntimeDisconnectedError();
    }
    this.#starting = true;
    try {
      await this.#transport.start({
        onStdout: (chunk) => this.#handleStdout(chunk),
        onStderr: (chunk) => this.#emit(this.#stderrListeners, chunk),
        onExit: (details) => this.#handleExit(details),
      });
      this.#started = true;
    } finally {
      this.#starting = false;
    }
  }

  async request<TResult = JsonValue>(
    method: string,
    params?: unknown,
    timeoutMs = this.#requestTimeoutMs,
  ): Promise<TResult> {
    this.#assertWritable();
    const id = this.#nextId++;
    const message: JsonRpcRequest = { id, method };
    if (params !== undefined) {
      message.params = params as JsonValue;
    }

    const response = new Promise<JsonValue>((resolve, reject) => {
      const pending: PendingRequest = { method, resolve, reject };
      if (timeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          this.#pending.delete(id);
          reject(new JsonRpcTimeoutError(id, method, timeoutMs));
        }, timeoutMs);
      }
      this.#pending.set(id, pending);
    });

    try {
      await this.#transport.writeLine(JSON.stringify(message));
    } catch (error) {
      this.#rejectPending(id, error);
    }
    return (await response) as TResult;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.#assertWritable();
    const message: JsonRpcNotification = { method };
    if (params !== undefined) {
      message.params = params as JsonValue;
    }
    await this.#transport.writeLine(JSON.stringify(message));
  }

  async respond(id: RequestId, result: JsonValue = {}): Promise<void> {
    this.#assertWritable();
    const response: JsonRpcSuccess = { id, result };
    await this.#transport.writeLine(JSON.stringify(response));
  }

  async respondError(
    id: RequestId,
    error: { code: number; message: string; data?: JsonValue },
  ): Promise<void> {
    this.#assertWritable();
    const response: JsonRpcFailure = { id, error };
    await this.#transport.writeLine(JSON.stringify(response));
  }

  onNotification(listener: Listener<JsonRpcNotification>): () => void {
    return this.#listen(this.#notificationListeners, listener);
  }

  onServerRequest(listener: Listener<JsonRpcRequest>): () => void {
    return this.#listen(this.#requestListeners, listener);
  }

  onProtocolError(listener: Listener<RuntimeProtocolError>): () => void {
    return this.#listen(this.#protocolErrorListeners, listener);
  }

  onStderr(listener: Listener<string | Uint8Array>): () => void {
    return this.#listen(this.#stderrListeners, listener);
  }

  onExit(listener: Listener<{ code?: number; signal?: string } | undefined>): () => void {
    return this.#listen(this.#exitListeners, listener);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#rejectAll(new RuntimeDisconnectedError("Runtime connection closed by client"));
    await this.#transport.close();
  }

  #handleStdout(chunk: string | Uint8Array): void {
    try {
      for (const line of this.#decoder.push(chunk)) {
        this.#handleLine(line);
      }
    } catch (error) {
      this.#handleProtocolError(error);
    }
  }

  #handleLine(line: string): void {
    let message: JsonRpcIncoming;
    try {
      message = JSON.parse(line) as JsonRpcIncoming;
    } catch (error) {
      this.#handleProtocolError(new RuntimeProtocolError("Runtime emitted invalid JSON", { cause: error }));
      return;
    }

    if (!message || typeof message !== "object") {
      this.#handleProtocolError(new RuntimeProtocolError("Runtime emitted a non-object message"));
      return;
    }
    if ("method" in message) {
      if (typeof message.method !== "string") {
        this.#handleProtocolError(new RuntimeProtocolError("Runtime message has an invalid method"));
      } else if ("id" in message) {
        this.#emit(this.#requestListeners, message as JsonRpcRequest);
      } else {
        this.#emit(this.#notificationListeners, message as JsonRpcNotification);
      }
      return;
    }
    if (!("id" in message)) {
      this.#handleProtocolError(new RuntimeProtocolError("Runtime response is missing an id"));
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) {
      this.#handleProtocolError(
        new RuntimeProtocolError(`Runtime responded with unknown request id: ${String(message.id)}`),
      );
      return;
    }
    this.#pending.delete(message.id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    if ("error" in message) {
      pending.reject(new JsonRpcResponseError(message.id, message.error));
    } else if ("result" in message) {
      pending.resolve(message.result);
    } else {
      pending.reject(new RuntimeProtocolError("Runtime response has neither result nor error"));
    }
  }

  #handleProtocolError(error: unknown): void {
    const protocolError =
      error instanceof RuntimeProtocolError
        ? error
        : new RuntimeProtocolError("Runtime protocol failure", { cause: error });
    this.#emit(this.#protocolErrorListeners, protocolError);
  }

  #handleExit(details?: { code?: number; signal?: string }): void {
    try {
      for (const line of this.#decoder.finish()) {
        this.#handleLine(line);
      }
    } catch (error) {
      this.#handleProtocolError(error);
    }
    if (!this.#closed) {
      this.#closed = true;
      this.#rejectAll(
        new RuntimeDisconnectedError(
          `Runtime exited${details?.code === undefined ? "" : ` with code ${details.code}`}`,
        ),
      );
    }
    this.#emit(this.#exitListeners, details);
  }

  #assertWritable(): void {
    if (!this.#started) {
      throw new RuntimeDisconnectedError("Runtime connection has not started");
    }
    if (this.#closed) {
      throw new RuntimeDisconnectedError();
    }
  }

  #rejectPending(id: RequestId, reason: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      return;
    }
    this.#pending.delete(id);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.reject(reason);
  }

  #rejectAll(reason: unknown): void {
    for (const id of [...this.#pending.keys()]) {
      this.#rejectPending(id, reason);
    }
  }

  #listen<T>(listeners: Set<Listener<T>>, listener: Listener<T>): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  #emit<T>(listeners: Set<Listener<T>>, value: T): void {
    for (const listener of listeners) {
      listener(value);
    }
  }
}

export function asJsonObject(value: JsonValue): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new RuntimeProtocolError("Expected a JSON object response");
  }
  return value;
}
