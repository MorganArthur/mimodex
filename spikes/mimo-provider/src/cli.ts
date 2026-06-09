import path from "node:path";
import { runFixtureAgentLoop } from "./agent-loop.js";
import { describeProviderError, MimoClient } from "./client.js";
import { loadConfig } from "./config.js";
import { redact } from "./redact.js";
import {
  buildCompletionProbeReport,
  buildCancellationProbeReport,
  buildNegativeReplayProbeReport,
  buildRecoveryProbeReport,
  buildResumeProbeReport,
  buildToolLoopProbeReport,
  defaultReportPath,
  saveProbeReport,
} from "./report.js";
import {
  createSession,
  defaultSessionPath,
  findLatestSessionPath,
  findLatestSessionPathForModel,
  loadSession,
  saveSession,
} from "./session.js";
import type { ChatMessage, NormalizedStreamEvent } from "./types.js";
import {
  executeRecoveryTool,
  fixtureTools,
  recoveryTools,
  type RecoveryScenario,
} from "./tools.js";

const config = loadConfig();
const [command = "help", ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "config":
      printJson(redact(config, config.apiKey ? [config.apiKey] : []));
      break;
    case "baseline":
      await runBaseline(
        readOption(args, "--model") ?? config.model,
        readOption(args, "--report"),
      );
      break;
    case "tool-loop":
      await runToolLoop(
        readOption(args, "--model") ?? config.model,
        readOption(args, "--report"),
      );
      break;
    case "resume":
      await runResume(args);
      break;
    case "resume-latest":
      await runResumeLatest(args);
      break;
    case "recovery-loop":
      await runRecoveryLoop(args);
      break;
    case "parallel-tool-loop":
      await runParallelToolLoop(args);
      break;
    case "negative-replay":
      await runNegativeReplay(args);
      break;
    case "negative-replay-matrix":
      await runNegativeReplayMatrix();
      break;
    case "cancel-probe":
      await runCancelProbe(args);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`未知命令：${command}`);
  }
} catch (error) {
  const providerError = describeProviderError(error);
  if (providerError) {
    console.error(JSON.stringify(providerError, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

async function runBaseline(model: string, requestedReportPath: string | undefined): Promise<void> {
  const client = new MimoClient(config);
  const printEvent = createEventPrinter();
  const completed = await client.streamCompletion(
    {
      model,
      messages: [
        {
          role: "system",
          content: "你正在参与 MiMo Provider 协议测试。请简短回答，不要调用工具。",
        },
        { role: "user", content: "请回复：MiMo Provider baseline 已连接。" },
      ],
    },
    { onEvent: printEvent },
  );
  console.log("\n\n完成结果：");
  printJson(completed);
  const reportPath = path.resolve(requestedReportPath ?? defaultReportPath(model));
  await saveProbeReport(
    reportPath,
    buildCompletionProbeReport(config.baseUrl, model, completed),
  );
  console.log(`\n已保存脱敏验证报告：${reportPath}`);
}

async function runToolLoop(model: string, requestedReportPath: string | undefined): Promise<void> {
  const client = new MimoClient(config);
  const printEvent = createEventPrinter();
  const initialMessages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你正在检查一个合成 Fixture 项目。必须使用提供的只读工具获取事实，禁止猜测。找出测试失败原因并简短总结，不要要求执行 Shell。",
    },
    {
      role: "user",
      content: "请检查 Fixture 项目，找出加法测试失败的原因。",
    },
  ];
  const result = await runFixtureAgentLoop(client, {
    model,
    messages: initialMessages,
    onEvent: printEvent,
  });

  const session = createSession(model, result.messages);
  const sessionPath = defaultSessionPath();
  await saveSession(sessionPath, session);
  console.log(`\n\n已保存可恢复会话：${sessionPath}`);
  const reportPath = path.resolve(
    requestedReportPath ?? defaultReportPath(model, "tool-loop"),
  );
  await saveProbeReport(
    reportPath,
    buildToolLoopProbeReport(config.baseUrl, model, result),
  );
  console.log(`已保存脱敏工具循环报告：${reportPath}`);
}

async function runResume(args: string[]): Promise<void> {
  const filePath = args[0];
  const prompt = args.slice(1).join(" ").trim();
  if (!filePath || !prompt) {
    throw new Error('用法：npm run probe -- resume <会话文件> "跟进问题"');
  }

  const session = await loadSession(path.resolve(filePath));
  const messageCountBeforeResume = session.messages.length;
  const client = new MimoClient(config);
  const printEvent = createEventPrinter();
  const result = await runFixtureAgentLoop(client, {
    model: session.model,
    messages: [...session.messages, { role: "user", content: prompt }],
    onEvent: printEvent,
  });
  await saveSession(path.resolve(filePath), { ...session, messages: result.messages });
  console.log(`\n\n已更新会话：${path.resolve(filePath)}`);
  const reportPath = defaultReportPath(session.model, "resume");
  await saveProbeReport(
    reportPath,
    buildResumeProbeReport(
      config.baseUrl,
      session.model,
      messageCountBeforeResume,
      result,
    ),
  );
  console.log(`已保存脱敏恢复报告：${reportPath}`);
}

async function runResumeLatest(args: string[]): Promise<void> {
  const model = readOption(args, "--model");
  const prompt = removeOption(args, "--model").join(" ").trim();
  if (!prompt) {
    throw new Error('用法：npm run probe -- resume-latest [--model MODEL] "跟进问题"');
  }
  const latestSessionPath = model
    ? await findLatestSessionPathForModel(model)
    : await findLatestSessionPath();
  await runResume([latestSessionPath, prompt]);
}

async function runRecoveryLoop(args: string[]): Promise<void> {
  const scenario = readOption(args, "--scenario") as RecoveryScenario | undefined;
  const model = readOption(args, "--model") ?? config.model;
  if (scenario !== "denial" && scenario !== "failure") {
    throw new Error("用法：npm run probe -- recovery-loop --scenario denial|failure [--model MODEL]");
  }

  const scenarioInstruction =
    scenario === "denial"
      ? "必须调用一次 request_restricted_write，路径使用 ../outside.txt。收到拒绝后不得再次调用工具，并解释你会如何继续。"
      : "必须调用一次 run_failing_check，名称使用 synthetic-check。收到失败后不得再次调用工具，并解释失败结果。";
  const client = new MimoClient(config);
  const result = await runFixtureAgentLoop(client, {
    model,
    messages: [
      {
        role: "system",
        content:
          "你正在参与工具错误恢复测试。必须遵守工具返回结果，不得重复执行已被拒绝或标记为不可重试的操作。",
      },
      { role: "user", content: scenarioInstruction },
    ],
    tools: [recoveryTools[scenario]],
    executeTool: async (call) => await executeRecoveryTool(scenario, call),
    onEvent: createEventPrinter(),
    maxRequests: 4,
  });

  const reportPath = defaultReportPath(model, "recovery");
  const report = buildRecoveryProbeReport(config.baseUrl, model, scenario, result);
  await saveProbeReport(reportPath, report);
  console.log(`\n\n已保存脱敏恢复场景报告：${reportPath}`);

  if (!report.evidence.expectedErrorObserved || report.evidence.toolRepeated) {
    throw new Error("恢复场景未满足预期：错误结果未被观察到，或模型重复调用了不可重试工具。");
  }
}

async function runParallelToolLoop(args: string[]): Promise<void> {
  const model = readOption(args, "--model") ?? config.model;
  const client = new MimoClient(config);
  const readTools = fixtureTools.filter(
    (tool) => tool.function.name === "read_fixture_file",
  );
  const result = await runFixtureAgentLoop(client, {
    model,
    messages: [
      {
        role: "system",
        content:
          "你正在参与同一响应多工具调用测试。第一次响应必须同时发出所有需要的工具调用，收到结果后再总结。",
      },
      {
        role: "user",
        content:
          "请在同一个助手响应中同时调用两次 read_fixture_file，分别读取 src/math.ts 和 tests/math.test.ts；收到两个结果后说明测试失败原因。",
      },
    ],
    tools: readTools,
    onEvent: createEventPrinter(),
    maxRequests: 4,
  });
  const report = buildToolLoopProbeReport(config.baseUrl, model, result);
  const reportPath = defaultReportPath(model, "parallel-tool-loop");
  await saveProbeReport(reportPath, report);
  console.log(`\n\n已保存脱敏多工具调用报告：${reportPath}`);

  if (
    report.evidence.maxToolCallsInSingleAssistant < 2 ||
    !report.evidence.toolCallIdsMatchResults
  ) {
    throw new Error("模型未在同一助手响应中生成至少两个正确关联的工具调用。");
  }
}

async function runNegativeReplay(args: string[]): Promise<void> {
  const model = readOption(args, "--model") ?? config.model;
  const requestedMode = readOption(args, "--mode") ?? "omit";
  if (
    requestedMode !== "omit" &&
    requestedMode !== "empty" &&
    requestedMode !== "truncate"
  ) {
    throw new Error("用法：npm run probe -- negative-replay --mode omit|empty|truncate [--model MODEL]");
  }
  await observeNegativeReplay(model, requestedMode);
}

async function runNegativeReplayMatrix(): Promise<void> {
  const models = [...new Set([config.model, config.proModel])];
  const modes = ["omit", "empty", "truncate"] as const;

  for (const model of models) {
    for (const mode of modes) {
      console.log(`\n=== 负向重放观察 model=${model} mode=${mode} ===`);
      await observeNegativeReplay(model, mode);
    }
  }
}

async function observeNegativeReplay(
  model: string,
  mode: "omit" | "empty" | "truncate",
): Promise<void> {
  const sessionPath = await findLatestSessionPathForModel(model);
  const session = await loadSession(sessionPath);
  let modifiedReasoningMessageCount = 0;
  let historicalToolCallCount = 0;
  const messages: ChatMessage[] = session.messages.map((message) => {
    if (message.role !== "assistant") return message;
    historicalToolCallCount += message.tool_calls?.length ?? 0;
    if (!message.reasoning_content) return message;
    modifiedReasoningMessageCount += 1;
    if (mode === "empty") return { ...message, reasoning_content: "" };
    if (mode === "truncate") {
      return { ...message, reasoning_content: message.reasoning_content.slice(0, 1) };
    }
    const { reasoning_content: _reasoningContent, ...withoutReasoning } = message;
    return withoutReasoning;
  });
  messages.push({
    role: "user",
    content: "这是负向协议测试。请根据历史工具结果再次简短确认结论。",
  });

  const client = new MimoClient(config);
  let observedStatus: number | undefined;
  let observedCategory: string | undefined;
  let requestAccepted = false;
  let finishReason: string | null | undefined;
  let responseId: string | undefined;
  try {
    const completed = await client.streamCompletion({
      model,
      messages,
      tools: fixtureTools,
      tool_choice: "auto",
    });
    requestAccepted = true;
    finishReason = completed.finishReason;
    responseId = completed.responseId;
  } catch (error) {
    const details = describeProviderError(error);
    observedStatus = details?.status;
    observedCategory = details?.category;
  }

  const report = buildNegativeReplayProbeReport({
    baseUrl: config.baseUrl,
    model,
    mode,
    modifiedReasoningMessageCount,
    historicalToolCallCount,
    requestAccepted,
    ...(observedStatus !== undefined ? { observedStatus } : {}),
    ...(observedCategory ? { observedCategory } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(responseId ? { responseId } : {}),
  });
  const reportPath = defaultReportPath(model, "negative-replay");
  await saveProbeReport(reportPath, report);
  console.log(`已保存脱敏负向重放观察报告：${reportPath}`);
  console.log(
    report.evidence.officialExpectationMatched
      ? "观察结果与官方文档预期一致：HTTP 400。"
      : "观察结果与官方文档预期不一致，已记录供兼容性分析。",
  );
}

async function runCancelProbe(args: string[]): Promise<void> {
  const model = readOption(args, "--model") ?? config.model;
  const client = new MimoClient(config);
  const controller = new AbortController();
  let streamEventObservedBeforeCancel = false;
  let cancellationObserved = false;
  let cancellationCategory: string | undefined;

  try {
    await client.streamCompletion(
      {
        model,
        messages: [
          {
            role: "system",
            content: "你正在参与取消测试。请进行较完整的推理后再回答。",
          },
          { role: "user", content: "请详细分析为什么编程 Agent 需要取消能力。" },
        ],
      },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (
            !controller.signal.aborted &&
            (event.type === "reasoning_delta" || event.type === "text_delta")
          ) {
            streamEventObservedBeforeCancel = true;
            controller.abort();
          }
        },
      },
    );
  } catch (error) {
    const details = describeProviderError(error);
    cancellationCategory = details?.category;
    cancellationObserved = details?.category === "cancelled";
  }

  let followUpRequestSucceeded = false;
  let followUpFinishReason: string | null | undefined;
  let followUpResponseId: string | undefined;
  try {
    const completed = await client.streamCompletion({
      model,
      messages: [
        {
          role: "system",
          content: "你正在参与取消后的客户端可用性测试。请简短回答。",
        },
        { role: "user", content: "请回复：取消后仍可用。" },
      ],
    });
    followUpRequestSucceeded = true;
    followUpFinishReason = completed.finishReason;
    followUpResponseId = completed.responseId;
  } catch {
    followUpRequestSucceeded = false;
  }

  const report = buildCancellationProbeReport({
    baseUrl: config.baseUrl,
    model,
    streamEventObservedBeforeCancel,
    cancellationObserved,
    ...(cancellationCategory ? { cancellationCategory } : {}),
    followUpRequestSucceeded,
    ...(followUpFinishReason !== undefined ? { followUpFinishReason } : {}),
    ...(followUpResponseId ? { followUpResponseId } : {}),
  });
  const reportPath = defaultReportPath(model, "cancellation");
  await saveProbeReport(reportPath, report);
  console.log(`已保存脱敏取消报告：${reportPath}`);

  if (report.outcome !== "pass") {
    throw new Error("取消探针未满足预期：未观察到取消，或取消后客户端不可用。");
  }
}

function createEventPrinter(): (event: NormalizedStreamEvent) => void {
  let outputSection: "reasoning" | "text" | undefined;
  const displayedToolCalls = new Set<number>();

  return (event) => {
    switch (event.type) {
      case "reasoning_delta":
        if (outputSection !== "reasoning") {
          process.stdout.write("\n[推理]\n");
          outputSection = "reasoning";
        }
        process.stdout.write(event.text);
        break;
      case "text_delta":
        if (outputSection !== "text") {
          process.stdout.write("\n[回答]\n");
          outputSection = "text";
        }
        process.stdout.write(event.text);
        break;
      case "tool_call_delta":
        if (!displayedToolCalls.has(event.index)) {
          process.stdout.write(
            `\n[工具调用 index=${event.index}${event.name ? ` name=${event.name}` : ""}]\n`,
          );
          displayedToolCalls.add(event.index);
          outputSection = undefined;
        }
        break;
      case "response_finished":
        process.stdout.write(`\n[完成 reason=${event.finishReason ?? "unknown"}]`);
        outputSection = undefined;
        break;
      case "usage":
        process.stdout.write(`\n[用量 ${JSON.stringify(event.usage)}]`);
        break;
      case "response_started":
        displayedToolCalls.clear();
        outputSection = undefined;
        process.stdout.write(`[响应 ${event.responseId}]`);
        break;
    }
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function removeOption(args: string[], name: string): string[] {
  const index = args.indexOf(name);
  if (index < 0) return [...args];
  return args.filter((_, itemIndex) => itemIndex !== index && itemIndex !== index + 1);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`MiMo Provider Spike

命令：
  config                         显示脱敏配置
  baseline [--model MODEL]       运行基础流式探针并保存脱敏报告
           [--report FILE]       指定脱敏报告保存路径
  tool-loop [--model MODEL]      运行只读 Fixture 工具循环并保存脱敏报告
            [--report FILE]      指定脱敏报告保存路径
  resume FILE "PROMPT"           恢复已保存会话并继续
  resume-latest [--model MODEL]  自动恢复最近会话并继续
                "PROMPT"
  recovery-loop --scenario      验证工具拒绝或失败后的模型恢复
                denial|failure
                [--model MODEL]
  parallel-tool-loop            验证同一助手响应中的多个工具调用
                     [--model MODEL]
  negative-replay --mode        修改历史 reasoning_content 并记录实际行为
                  omit|empty|truncate
                  [--model MODEL]
  negative-replay-matrix        对默认和高级模型运行全部负向重放模式
  cancel-probe                  取消流式请求并验证客户端仍可继续使用
              [--model MODEL]
`);
}
