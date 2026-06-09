export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  stream_options?: {
    include_usage: boolean;
  };
  tools?: FunctionTool[];
  tool_choice?: "auto" | "none";
  max_completion_tokens?: number;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatCompletionChunk {
  id?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: Usage;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export type NormalizedStreamEvent =
  | { type: "response_started"; responseId: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; index: number; callId?: string; name?: string; argumentsDelta?: string }
  | { type: "usage"; usage: Usage }
  | { type: "response_finished"; finishReason: string | null };

export interface CompletedAssistantMessage {
  message: Extract<ChatMessage, { role: "assistant" }>;
  finishReason: string | null;
  usage?: Usage;
  responseId?: string;
}

export type NormalizedErrorCategory =
  | "authentication"
  | "rate_limit"
  | "invalid_request"
  | "context_limit"
  | "provider_unavailable"
  | "timeout"
  | "cancelled"
  | "network"
  | "unknown";

export interface NormalizedProviderError {
  category: NormalizedErrorCategory;
  status?: number;
  requestId?: string;
  message: string;
  retryable: boolean;
}

export interface PersistedSession {
  version: 1;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: ChatMessage[];
}
