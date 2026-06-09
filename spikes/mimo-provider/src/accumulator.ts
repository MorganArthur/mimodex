import type {
  ChatCompletionChunk,
  CompletedAssistantMessage,
  NormalizedStreamEvent,
  ToolCall,
  Usage,
} from "./types.js";

interface MutableToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class ChatStreamAccumulator {
  private responseId?: string;
  private reasoningContent = "";
  private textContent = "";
  private finishReason: string | null = null;
  private usage?: Usage;
  private readonly toolCalls = new Map<number, MutableToolCall>();

  consume(chunk: ChatCompletionChunk): NormalizedStreamEvent[] {
    const events: NormalizedStreamEvent[] = [];

    if (chunk.id && !this.responseId) {
      this.responseId = chunk.id;
      events.push({ type: "response_started", responseId: chunk.id });
    }

    if (chunk.usage) {
      this.usage = chunk.usage;
      events.push({ type: "usage", usage: chunk.usage });
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;

      if (delta?.reasoning_content) {
        this.reasoningContent += delta.reasoning_content;
        events.push({ type: "reasoning_delta", text: delta.reasoning_content });
      }

      if (delta?.content) {
        this.textContent += delta.content;
        events.push({ type: "text_delta", text: delta.content });
      }

      for (const toolDelta of delta?.tool_calls ?? []) {
        const current = this.toolCalls.get(toolDelta.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (toolDelta.id) current.id = toolDelta.id;
        if (toolDelta.function?.name) current.name += toolDelta.function.name;
        if (toolDelta.function?.arguments) current.arguments += toolDelta.function.arguments;
        this.toolCalls.set(toolDelta.index, current);

        events.push({
          type: "tool_call_delta",
          index: toolDelta.index,
          ...(toolDelta.id ? { callId: toolDelta.id } : {}),
          ...(toolDelta.function?.name ? { name: toolDelta.function.name } : {}),
          ...(toolDelta.function?.arguments
            ? { argumentsDelta: toolDelta.function.arguments }
            : {}),
        });
      }

      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        this.finishReason = choice.finish_reason;
        events.push({ type: "response_finished", finishReason: choice.finish_reason });
      }
    }

    return events;
  }

  complete(): CompletedAssistantMessage {
    const toolCalls: ToolCall[] = [...this.toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => {
        if (!value.id || !value.name) {
          throw new Error("流式工具调用缺少稳定 ID 或函数名称。");
        }

        JSON.parse(value.arguments);
        return {
          id: value.id,
          type: "function",
          function: {
            name: value.name,
            arguments: value.arguments,
          },
        };
      });

    return {
      message: {
        role: "assistant",
        content: this.textContent || null,
        ...(this.reasoningContent ? { reasoning_content: this.reasoningContent } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finishReason: this.finishReason,
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.responseId ? { responseId: this.responseId } : {}),
    };
  }
}
