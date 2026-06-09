import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentLoopResult } from "./agent-loop.js";
import type { CompletedAssistantMessage, Usage } from "./types.js";

export interface CompletionProbeReport {
  version: 1;
  probe: "baseline";
  recordedAt: string;
  baseUrl: string;
  model: string;
  outcome: "pass";
  responseId?: string;
  finishReason: string | null;
  usage?: CompletedAssistantMessage["usage"];
  evidence: {
    hasReasoningContent: boolean;
    reasoningContentLength: number;
    hasTextContent: boolean;
    textContentLength: number;
    toolCallCount: number;
  };
}

export interface ToolLoopProbeReport {
  version: 1;
  probe: "tool-loop";
  recordedAt: string;
  baseUrl: string;
  model: string;
  outcome: "pass";
  evidence: {
    requestCount: number;
    assistantMessageCount: number;
    reasoningMessageCount: number;
    toolCallCount: number;
    maxToolCallsInSingleAssistant: number;
    toolResultCount: number;
    toolNames: string[];
    toolCallIdsMatchResults: boolean;
    finalHasTextContent: boolean;
    finalTextContentLength: number;
    finishReasons: Array<string | null>;
    responseIds: string[];
    usageByRequest: Usage[];
  };
}

export interface ResumeProbeReport {
  version: 1;
  probe: "resume";
  recordedAt: string;
  baseUrl: string;
  model: string;
  outcome: "pass";
  evidence: {
    messageCountBeforeResume: number;
    messageCountAfterResume: number;
    addedMessageCount: number;
    requestCount: number;
    addedAssistantMessageCount: number;
    addedReasoningMessageCount: number;
    addedToolCallCount: number;
    addedToolResultCount: number;
    finishReasons: Array<string | null>;
    responseIds: string[];
    usageByRequest: Usage[];
  };
}

export interface RecoveryProbeReport {
  version: 1;
  probe: "recovery";
  recordedAt: string;
  baseUrl: string;
  model: string;
  outcome: "pass";
  scenario: "denial" | "failure";
  evidence: {
    requestCount: number;
    toolCallCount: number;
    toolResultCount: number;
    expectedErrorCode: "permission_denied" | "tool_execution_failed";
    expectedErrorObserved: boolean;
    toolRepeated: boolean;
    finalHasTextContent: boolean;
    finalTextContentLength: number;
    finishReasons: Array<string | null>;
    responseIds: string[];
    usageByRequest: Usage[];
  };
}

export interface NegativeReplayProbeReport {
  version: 1;
  probe: "negative-replay";
  recordedAt: string;
  baseUrl: string;
  model: string;
  outcome: "observed";
  mode: "omit" | "empty" | "truncate";
  evidence: {
    modifiedReasoningMessageCount: number;
    historicalToolCallCount: number;
    expectedStatus: 400;
    requestAccepted: boolean;
    observedStatus?: number;
    observedCategory?: string;
    finishReason?: string | null;
    responseId?: string;
    officialExpectationMatched: boolean;
  };
}

export interface CancellationProbeReport {
  version: 1;
  probe: "cancellation";
  recordedAt: string;
  baseUrl: string;
  model: string;
  outcome: "pass" | "fail";
  evidence: {
    streamEventObservedBeforeCancel: boolean;
    cancellationObserved: boolean;
    cancellationCategory?: string;
    followUpRequestSucceeded: boolean;
    followUpFinishReason?: string | null;
    followUpResponseId?: string;
  };
}

export function buildCompletionProbeReport(
  baseUrl: string,
  model: string,
  completed: CompletedAssistantMessage,
): CompletionProbeReport {
  const reasoningContent = completed.message.reasoning_content ?? "";
  const textContent = completed.message.content ?? "";

  return {
    version: 1,
    probe: "baseline",
    recordedAt: new Date().toISOString(),
    baseUrl,
    model,
    outcome: "pass",
    ...(completed.responseId ? { responseId: completed.responseId } : {}),
    finishReason: completed.finishReason,
    ...(completed.usage ? { usage: completed.usage } : {}),
    evidence: {
      hasReasoningContent: reasoningContent.length > 0,
      reasoningContentLength: reasoningContent.length,
      hasTextContent: textContent.length > 0,
      textContentLength: textContent.length,
      toolCallCount: completed.message.tool_calls?.length ?? 0,
    },
  };
}

export async function saveProbeReport(
  filePath: string,
  report:
    | CompletionProbeReport
    | ToolLoopProbeReport
    | ResumeProbeReport
    | RecoveryProbeReport
    | NegativeReplayProbeReport
    | CancellationProbeReport,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function buildNegativeReplayProbeReport(input: {
  baseUrl: string;
  model: string;
  mode: "omit" | "empty" | "truncate";
  modifiedReasoningMessageCount: number;
  historicalToolCallCount: number;
  requestAccepted: boolean;
  observedStatus?: number;
  observedCategory?: string;
  finishReason?: string | null;
  responseId?: string;
}): NegativeReplayProbeReport {
  const officialExpectationMatched = input.observedStatus === 400;
  return {
    version: 1,
    probe: "negative-replay",
    recordedAt: new Date().toISOString(),
    baseUrl: input.baseUrl,
    model: input.model,
    outcome: "observed",
    mode: input.mode,
    evidence: {
      modifiedReasoningMessageCount: input.modifiedReasoningMessageCount,
      historicalToolCallCount: input.historicalToolCallCount,
      expectedStatus: 400,
      requestAccepted: input.requestAccepted,
      ...(input.observedStatus !== undefined ? { observedStatus: input.observedStatus } : {}),
      ...(input.observedCategory ? { observedCategory: input.observedCategory } : {}),
      ...(input.finishReason !== undefined ? { finishReason: input.finishReason } : {}),
      ...(input.responseId ? { responseId: input.responseId } : {}),
      officialExpectationMatched,
    },
  };
}

export function buildCancellationProbeReport(input: {
  baseUrl: string;
  model: string;
  streamEventObservedBeforeCancel: boolean;
  cancellationObserved: boolean;
  cancellationCategory?: string;
  followUpRequestSucceeded: boolean;
  followUpFinishReason?: string | null;
  followUpResponseId?: string;
}): CancellationProbeReport {
  const outcome =
    input.streamEventObservedBeforeCancel &&
    input.cancellationObserved &&
    input.followUpRequestSucceeded
      ? "pass"
      : "fail";
  return {
    version: 1,
    probe: "cancellation",
    recordedAt: new Date().toISOString(),
    baseUrl: input.baseUrl,
    model: input.model,
    outcome,
    evidence: {
      streamEventObservedBeforeCancel: input.streamEventObservedBeforeCancel,
      cancellationObserved: input.cancellationObserved,
      ...(input.cancellationCategory
        ? { cancellationCategory: input.cancellationCategory }
        : {}),
      followUpRequestSucceeded: input.followUpRequestSucceeded,
      ...(input.followUpFinishReason !== undefined
        ? { followUpFinishReason: input.followUpFinishReason }
        : {}),
      ...(input.followUpResponseId ? { followUpResponseId: input.followUpResponseId } : {}),
    },
  };
}

export function buildRecoveryProbeReport(
  baseUrl: string,
  model: string,
  scenario: "denial" | "failure",
  result: AgentLoopResult,
): RecoveryProbeReport {
  const assistantMessages = result.messages.filter((message) => message.role === "assistant");
  const toolCalls = assistantMessages.flatMap((message) => message.tool_calls ?? []);
  const toolResults = result.messages.filter((message) => message.role === "tool");
  const expectedErrorCode =
    scenario === "denial" ? "permission_denied" : "tool_execution_failed";
  const finalMessage = assistantMessages.at(-1);

  return {
    version: 1,
    probe: "recovery",
    recordedAt: new Date().toISOString(),
    baseUrl,
    model,
    outcome: "pass",
    scenario,
    evidence: {
      requestCount: result.completions.length,
      toolCallCount: toolCalls.length,
      toolResultCount: toolResults.length,
      expectedErrorCode,
      expectedErrorObserved: toolResults.some((message) => {
        try {
          const parsed = JSON.parse(message.content) as { error?: unknown };
          return parsed.error === expectedErrorCode;
        } catch {
          return false;
        }
      }),
      toolRepeated: toolCalls.length > 1,
      finalHasTextContent: Boolean(finalMessage?.content),
      finalTextContentLength: finalMessage?.content?.length ?? 0,
      finishReasons: result.completions.map((completion) => completion.finishReason),
      responseIds: result.completions.flatMap((completion) =>
        completion.responseId ? [completion.responseId] : [],
      ),
      usageByRequest: result.completions.flatMap((completion) =>
        completion.usage ? [completion.usage] : [],
      ),
    },
  };
}

export function buildResumeProbeReport(
  baseUrl: string,
  model: string,
  messageCountBeforeResume: number,
  result: AgentLoopResult,
): ResumeProbeReport {
  const addedMessages = result.messages.slice(messageCountBeforeResume);
  const addedAssistantMessages = addedMessages.filter((message) => message.role === "assistant");
  const addedToolResults = addedMessages.filter((message) => message.role === "tool");

  return {
    version: 1,
    probe: "resume",
    recordedAt: new Date().toISOString(),
    baseUrl,
    model,
    outcome: "pass",
    evidence: {
      messageCountBeforeResume,
      messageCountAfterResume: result.messages.length,
      addedMessageCount: result.messages.length - messageCountBeforeResume,
      requestCount: result.completions.length,
      addedAssistantMessageCount: addedAssistantMessages.length,
      addedReasoningMessageCount: addedAssistantMessages.filter(
        (message) => Boolean(message.reasoning_content),
      ).length,
      addedToolCallCount: addedAssistantMessages.reduce(
        (total, message) => total + (message.tool_calls?.length ?? 0),
        0,
      ),
      addedToolResultCount: addedToolResults.length,
      finishReasons: result.completions.map((completion) => completion.finishReason),
      responseIds: result.completions.flatMap((completion) =>
        completion.responseId ? [completion.responseId] : [],
      ),
      usageByRequest: result.completions.flatMap((completion) =>
        completion.usage ? [completion.usage] : [],
      ),
    },
  };
}

export function buildToolLoopProbeReport(
  baseUrl: string,
  model: string,
  result: AgentLoopResult,
): ToolLoopProbeReport {
  const assistantMessages = result.messages.filter((message) => message.role === "assistant");
  const toolResults = result.messages.filter((message) => message.role === "tool");
  const toolCalls = assistantMessages.flatMap((message) => message.tool_calls ?? []);
  const toolResultIds = new Set(toolResults.map((message) => message.tool_call_id));
  const finalMessage = assistantMessages.at(-1);

  return {
    version: 1,
    probe: "tool-loop",
    recordedAt: new Date().toISOString(),
    baseUrl,
    model,
    outcome: "pass",
    evidence: {
      requestCount: result.completions.length,
      assistantMessageCount: assistantMessages.length,
      reasoningMessageCount: assistantMessages.filter(
        (message) => Boolean(message.reasoning_content),
      ).length,
      toolCallCount: toolCalls.length,
      maxToolCallsInSingleAssistant: Math.max(
        0,
        ...assistantMessages.map((message) => message.tool_calls?.length ?? 0),
      ),
      toolResultCount: toolResults.length,
      toolNames: toolCalls.map((call) => call.function.name),
      toolCallIdsMatchResults: toolCalls.every((call) => toolResultIds.has(call.id)),
      finalHasTextContent: Boolean(finalMessage?.content),
      finalTextContentLength: finalMessage?.content?.length ?? 0,
      finishReasons: result.completions.map((completion) => completion.finishReason),
      responseIds: result.completions.flatMap((completion) =>
        completion.responseId ? [completion.responseId] : [],
      ),
      usageByRequest: result.completions.flatMap((completion) =>
        completion.usage ? [completion.usage] : [],
      ),
    },
  };
}

export function defaultReportPath(
  model: string,
  probe:
    | "baseline"
    | "tool-loop"
    | "parallel-tool-loop"
    | "resume"
    | "recovery"
    | "negative-replay"
    | "cancellation" = "baseline",
): string {
  const safeModel = model.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return path.resolve("artifacts", "reports", `${probe}-${safeModel}-${timestamp}.json`);
}
