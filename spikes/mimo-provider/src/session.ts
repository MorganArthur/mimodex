import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, PersistedSession } from "./types.js";

export function createSession(model: string, messages: ChatMessage[]): PersistedSession {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    model,
    messages,
  };
}

export async function saveSession(
  filePath: string,
  session: PersistedSession,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const updated: PersistedSession = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}

export async function loadSession(filePath: string): Promise<PersistedSession> {
  const raw = await readFile(filePath, "utf8");
  const value: unknown = JSON.parse(raw);
  if (!isSession(value)) {
    throw new Error("会话文件格式无效。");
  }
  return value;
}

export function defaultSessionPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return path.resolve("artifacts", `session-${timestamp}.json`);
}

export async function findLatestSessionPath(
  artifactsDirectory = path.resolve("artifacts"),
): Promise<string> {
  const entries = await readdir(artifactsDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^session-.*\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const latest = candidates[0];
  if (!latest) {
    throw new Error(`未在 ${artifactsDirectory} 中找到可恢复会话。`);
  }
  return path.join(artifactsDirectory, latest);
}

export async function findLatestSessionPathForModel(
  model: string,
  artifactsDirectory = path.resolve("artifacts"),
): Promise<string> {
  const entries = await readdir(artifactsDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^session-.*\.json$/.test(entry.name))
    .map((entry) => path.join(artifactsDirectory, entry.name))
    .sort()
    .reverse();

  for (const candidate of candidates) {
    const session = await loadSession(candidate);
    if (session.model === model) return candidate;
  }

  throw new Error(`未在 ${artifactsDirectory} 中找到模型 ${model} 的可恢复会话。`);
}

function isSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSession>;
  return (
    candidate.version === 1 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.model === "string" &&
    Array.isArray(candidate.messages)
  );
}
