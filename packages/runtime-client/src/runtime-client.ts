import { JsonRpcClient } from "./json-rpc-client.js";
import type {
  InitializeParams,
  InitializeResponse,
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
} from "./protocol.js";
import type { RuntimeTransport } from "./transport.js";

export type MimodexRuntimeClientOptions = {
  clientVersion: string;
  experimentalApi?: boolean;
  requestTimeoutMs?: number;
};

export class MimodexRuntimeClient {
  readonly #rpc: JsonRpcClient;
  readonly #options: MimodexRuntimeClientOptions;
  #initialized = false;

  constructor(transport: RuntimeTransport, options: MimodexRuntimeClientOptions) {
    this.#options = options;
    this.#rpc = new JsonRpcClient(
      transport,
      options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs },
    );
  }

  async initialize(): Promise<InitializeResponse> {
    if (this.#initialized) {
      throw new Error("Mimodex Runtime client already initialized");
    }
    await this.#rpc.start();
    const capabilities =
      this.#options.experimentalApi === undefined
        ? null
        : { experimentalApi: this.#options.experimentalApi };
    const params: InitializeParams = {
      clientInfo: {
        name: "mimodex_desktop",
        title: "Mimodex Desktop",
        version: this.#options.clientVersion,
      },
      capabilities,
    };
    const response = await this.#rpc.request<InitializeResponse>("initialize", params);
    await this.#rpc.notify("initialized");
    this.#initialized = true;
    return response;
  }

  startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.#request("thread/start", params);
  }

  resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.#request("thread/resume", params);
  }

  startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.#request("turn/start", params);
  }

  interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return this.#request("turn/interrupt", params);
  }

  onNotification(listener: (notification: ServerNotification) => void): () => void {
    return this.#rpc.onNotification(listener);
  }

  onServerRequest(listener: (request: ServerRequest) => void): () => void {
    return this.#rpc.onServerRequest(listener);
  }

  onProtocolError(listener: Parameters<JsonRpcClient["onProtocolError"]>[0]): () => void {
    return this.#rpc.onProtocolError(listener);
  }

  onStderr(listener: Parameters<JsonRpcClient["onStderr"]>[0]): () => void {
    return this.#rpc.onStderr(listener);
  }

  onExit(listener: Parameters<JsonRpcClient["onExit"]>[0]): () => void {
    return this.#rpc.onExit(listener);
  }

  respond(
    id: ServerRequest["id"],
    result: Parameters<JsonRpcClient["respond"]>[1] = {},
  ): Promise<void> {
    return this.#rpc.respond(id, result);
  }

  respondError(
    id: ServerRequest["id"],
    error: Parameters<JsonRpcClient["respondError"]>[1],
  ): Promise<void> {
    return this.#rpc.respondError(id, error);
  }

  close(): Promise<void> {
    return this.#rpc.close();
  }

  #request<TResult>(
    method: string,
    params: object,
  ): Promise<TResult> {
    if (!this.#initialized) {
      return Promise.reject(new Error("Mimodex Runtime client is not initialized"));
    }
    return this.#rpc.request<TResult>(method, params);
  }
}
