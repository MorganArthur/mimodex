import { MimoClient } from "./client.js";
import { executeFixtureTool, fixtureTools } from "./tools.js";
import type {
  ChatMessage,
  CompletedAssistantMessage,
  FunctionTool,
  NormalizedStreamEvent,
  ToolCall,
} from "./types.js";

export interface AgentLoopOptions {
  model: string;
  messages: ChatMessage[];
  maxRequests?: number;
  onEvent?: (event: NormalizedStreamEvent) => void;
  tools?: FunctionTool[];
  executeTool?: (call: ToolCall) => Promise<string>;
}

export interface AgentLoopResult {
  messages: ChatMessage[];
  completions: CompletedAssistantMessage[];
}

export async function runFixtureAgentLoop(
  client: MimoClient,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const messages = [...options.messages];
  const completions: CompletedAssistantMessage[] = [];
  const maxRequests = options.maxRequests ?? 8;
  const tools = options.tools ?? fixtureTools;
  const executeTool = options.executeTool ?? executeFixtureTool;

  for (let requestIndex = 0; requestIndex < maxRequests; requestIndex += 1) {
    const completed = await client.streamCompletion(
      {
        model: options.model,
        messages,
        tools,
        tool_choice: "auto",
      },
      { ...(options.onEvent ? { onEvent: options.onEvent } : {}) },
    );
    completions.push(completed);
    messages.push(completed.message);

    const toolCalls = completed.message.tool_calls ?? [];
    if (toolCalls.length === 0) return { messages, completions };

    for (const call of toolCalls) {
      let content: string;
      try {
        content = await executeTool(call);
      } catch (error) {
        content = JSON.stringify({
          error: "tool_execution_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  throw new Error(`工具调用循环超过 ${maxRequests} 次请求上限。`);
}
