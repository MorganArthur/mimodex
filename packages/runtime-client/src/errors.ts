import type { JsonRpcErrorBody, RequestId } from "./protocol.js";

export class RuntimeProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeProtocolError";
  }
}

export class RuntimeDisconnectedError extends Error {
  constructor(message = "Runtime connection closed") {
    super(message);
    this.name = "RuntimeDisconnectedError";
  }
}

export class JsonRpcResponseError extends Error {
  readonly id: RequestId;
  readonly code: number;
  readonly data: JsonRpcErrorBody["data"];

  constructor(id: RequestId, error: JsonRpcErrorBody) {
    super(error.message);
    this.name = "JsonRpcResponseError";
    this.id = id;
    this.code = error.code;
    this.data = error.data;
  }
}

export class JsonRpcTimeoutError extends Error {
  readonly id: RequestId;
  readonly method: string;

  constructor(id: RequestId, method: string, timeoutMs: number) {
    super(`JSON-RPC request timed out after ${timeoutMs} ms: ${method}`);
    this.name = "JsonRpcTimeoutError";
    this.id = id;
    this.method = method;
  }
}
