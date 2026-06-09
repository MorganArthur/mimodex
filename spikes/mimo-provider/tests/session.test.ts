import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSession,
  findLatestSessionPath,
  findLatestSessionPathForModel,
  loadSession,
  saveSession,
} from "../src/session.js";

test("会话保存并恢复 reasoning_content 与工具调用", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mimodex-session-"));
  const file = path.join(directory, "session.json");

  try {
    const session = createSession("mimo-v2.5", [
      { role: "user", content: "检查文件" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "需要读取文件",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_fixture_file",
              arguments: '{"path":"src/math.ts"}',
            },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: '{"content":"fixture"}' },
    ]);

    await saveSession(file, session);
    const loaded = await loadSession(file);

    assert.equal(loaded.model, "mimo-v2.5");
    assert.deepEqual(loaded.messages, session.messages);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("可以按模型找到最近的会话文件", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mimodex-model-session-"));
  try {
    await saveSession(
      path.join(directory, "session-2026-06-09T01-00-00Z.json"),
      createSession("mimo-v2.5", []),
    );
    await saveSession(
      path.join(directory, "session-2026-06-09T02-00-00Z.json"),
      createSession("mimo-v2.5-pro", []),
    );
    const latest = await findLatestSessionPathForModel("mimo-v2.5", directory);
    assert.equal(path.basename(latest), "session-2026-06-09T01-00-00Z.json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("可以找到最近的会话文件", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mimodex-latest-session-"));
  try {
    await saveSession(
      path.join(directory, "session-2026-06-09T01-00-00Z.json"),
      createSession("mimo-v2.5", []),
    );
    await saveSession(
      path.join(directory, "session-2026-06-09T02-00-00Z.json"),
      createSession("mimo-v2.5", []),
    );
    const latest = await findLatestSessionPath(directory);
    assert.equal(path.basename(latest), "session-2026-06-09T02-00-00Z.json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
