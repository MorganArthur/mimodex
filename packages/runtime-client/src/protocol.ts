export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue | undefined;
};

export type RequestId = number | string;

export type JsonRpcRequest = {
  id: RequestId;
  method: string;
  params?: JsonValue;
};

export type JsonRpcNotification = {
  method: string;
  params?: JsonValue;
};

export type JsonRpcSuccess = {
  id: RequestId;
  result: JsonValue;
};

export type JsonRpcErrorBody = {
  code: number;
  message: string;
  data?: JsonValue;
};

export type JsonRpcFailure = {
  id: RequestId;
  error: JsonRpcErrorBody;
};

export type JsonRpcIncoming =
  | JsonRpcFailure
  | JsonRpcNotification
  | JsonRpcRequest
  | JsonRpcSuccess;

export type InitializeParams = {
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
  capabilities?: {
    experimentalApi?: boolean;
    optOutNotificationMethods?: string[];
  } | null;
};

export type InitializeResponse = {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
};

export type Thread = JsonObject & {
  id: string;
};

export type Turn = JsonObject & {
  id: string;
  status: "completed" | "failed" | "inProgress" | "interrupted";
};

export type ThreadStartParams = {
  model?: string | null;
  modelProvider?: string | null;
  cwd?: string | null;
  approvalPolicy?: "never" | "on-failure" | "on-request" | "untrusted" | null;
  sandbox?: "danger-full-access" | "read-only" | "workspace-write" | null;
  ephemeral?: boolean | null;
  threadSource?: string | null;
};

export type ThreadStartResponse = JsonObject & {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
};

export type ThreadResumeParams = {
  threadId: string;
};

export type ThreadResumeResponse = ThreadStartResponse;

export type ThreadArchiveParams = {
  threadId: string;
};

export type ThreadArchiveResponse = JsonObject;

export type ThreadUnarchiveParams = {
  threadId: string;
};

export type ThreadUnarchiveResponse = JsonObject;

export type TextUserInput = {
  type: "text";
  text: string;
  textElements: JsonValue[];
};

export type TurnStartParams = {
  threadId: string;
  clientUserMessageId?: string | null;
  input: TextUserInput[];
  cwd?: string | null;
  approvalPolicy?: "never" | "on-failure" | "on-request" | "untrusted" | null;
  model?: string | null;
};

export type TurnStartResponse = {
  turn: Turn;
};

export type TurnInterruptParams = {
  threadId: string;
  turnId: string;
};

export type TurnInterruptResponse = JsonObject;

export type ServerNotification = JsonRpcNotification;

export type ServerRequest = JsonRpcRequest;
