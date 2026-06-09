import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FunctionTool, ToolCall } from "./types.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/workspace/", import.meta.url));

export const fixtureTools: FunctionTool[] = [
  {
    type: "function",
    function: {
      name: "read_fixture_file",
      description: "读取合成 Fixture 项目中的文本文件。只能读取给定的项目相对路径。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于 Fixture 项目根目录的路径" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_fixture",
      description: "在合成 Fixture 项目的文本文件中搜索字符串。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "需要搜索的非空字符串" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export type RecoveryScenario = "denial" | "failure";

export const recoveryTools: Record<RecoveryScenario, FunctionTool> = {
  denial: {
    type: "function",
    function: {
      name: "request_restricted_write",
      description: "请求执行一个将被审批策略拒绝的写入操作，用于测试拒绝恢复。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "希望写入的测试路径" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  failure: {
    type: "function",
    function: {
      name: "run_failing_check",
      description: "运行一个固定失败的合成检查，用于测试工具执行失败恢复。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "合成检查名称" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
};

export async function executeFixtureTool(call: ToolCall): Promise<string> {
  const args = parseArguments(call);

  switch (call.function.name) {
    case "read_fixture_file":
      return JSON.stringify({
        path: requireString(args, "path"),
        content: await readFixtureFile(requireString(args, "path")),
      });
    case "search_fixture":
      return JSON.stringify({
        query: requireString(args, "query"),
        matches: await searchFixture(requireString(args, "query")),
      });
    default:
      return JSON.stringify({
        error: "tool_not_allowed",
        message: `工具 ${call.function.name} 不在 Spike 允许列表中。`,
      });
  }
}

export async function executeRecoveryTool(
  scenario: RecoveryScenario,
  call: ToolCall,
): Promise<string> {
  const args = parseArguments(call);

  if (scenario === "denial" && call.function.name === "request_restricted_write") {
    return JSON.stringify({
      error: "permission_denied",
      message: "用户拒绝了项目外写入请求。不得自动重试。",
      path: requireString(args, "path"),
      retryable: false,
    });
  }

  if (scenario === "failure" && call.function.name === "run_failing_check") {
    return JSON.stringify({
      error: "tool_execution_failed",
      message: "合成检查按测试设计返回失败。",
      check: requireString(args, "name"),
      exitCode: 1,
      retryable: false,
    });
  }

  return JSON.stringify({
    error: "tool_not_allowed",
    message: `工具 ${call.function.name} 不属于 ${scenario} 恢复场景。`,
    retryable: false,
  });
}

function parseArguments(call: ToolCall): Record<string, unknown> {
  const value: unknown = JSON.parse(call.function.arguments);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`工具 ${call.function.name} 的参数必须是 JSON 对象。`);
  }
  return value as Record<string, unknown>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`工具参数 ${key} 必须是非空字符串。`);
  }
  return value;
}

async function readFixtureFile(relativePath: string): Promise<string> {
  const resolved = resolveFixturePath(relativePath);
  const content = await readFile(resolved, "utf8");
  return boundText(content, 20_000);
}

async function searchFixture(query: string): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = await listFiles(fixtureRoot);
  const matches: Array<{ path: string; line: number; text: string }> = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (line.includes(query)) {
        matches.push({
          path: path.relative(fixtureRoot, file).replaceAll("\\", "/"),
          line: index + 1,
          text: boundText(line, 500),
        });
        if (matches.length >= 50) return matches;
      }
    }
  }

  return matches;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(resolved)));
    if (entry.isFile()) files.push(resolved);
  }
  return files;
}

function resolveFixturePath(relativePath: string): string {
  const resolved = path.resolve(fixtureRoot, relativePath);
  const relative = path.relative(fixtureRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("拒绝读取 Fixture 项目之外的路径。");
  }
  return resolved;
}

function boundText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[TRUNCATED]`;
}
