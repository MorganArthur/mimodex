import { describe, expect, it, vi } from "vitest";

import { MimodexRuntimeClient, ProcessRuntimeTransport } from "@mimodex/runtime-client";
import {
  TauriRuntimeProcessPort,
  type TauriRawOutput,
  type TauriSidecarCommand,
} from "./tauri-runtime.js";

describe("Tauri Runtime sidecar 端口", () => {
  it("注册监听器后启动进程，并转发读写、退出和终止", async () => {
    const command = new FakeCommand();
    const port = new TauriRuntimeProcessPort(() => command);
    const transport = new ProcessRuntimeTransport(port);
    const stdout: Uint8Array[] = [];
    const stderr: Array<string | Uint8Array> = [];
    const exits: Array<{ code?: number; signal?: string } | undefined> = [];

    await transport.start({
      onStdout(chunk) {
        if (chunk instanceof Uint8Array) {
          stdout.push(chunk);
        }
      },
      onStderr(chunk) {
        stderr.push(chunk);
      },
      onExit(details) {
        exits.push(details);
      },
    });
    await transport.writeLine('{"method":"initialized"}');
    command.emitStdout([123, 125, 10]);
    command.emitError("runtime warning");
    command.emitClose({ code: 0, signal: null });
    await transport.close();

    expect(command.spawned).toBe(true);
    expect(command.writes).toEqual(['{"method":"initialized"}\n']);
    expect(stdout).toEqual([new Uint8Array([123, 125, 10])]);
    expect(stderr).toEqual(["runtime warning"]);
    expect(exits).toEqual([{ code: 0 }]);
    expect(command.killed).toBe(false);
  });

  it("将 Tauri IPC 数字数组转换为字节流并完成 Runtime 初始化", async () => {
    const command = new FakeCommand();
    const client = new MimodexRuntimeClient(
      new ProcessRuntimeTransport(new TauriRuntimeProcessPort(() => command)),
      { clientVersion: __APP_VERSION__ },
    );

    const initialization = client.initialize();
    await vi.waitFor(() => expect(command.writes).toHaveLength(1));
    command.emitStdout(
      Array.from(
        new TextEncoder().encode(
          `${JSON.stringify({
            id: 1,
            result: {
              userAgent: "mimodex-runtime-test",
              codexHome: "C:\\Users\\tester\\.codex",
              platformFamily: "windows",
              platformOs: "windows",
            },
          })}\n`,
        ),
      ),
    );

    await expect(initialization).resolves.toMatchObject({
      userAgent: "mimodex-runtime-test",
      platformOs: "windows",
    });
    expect(command.writes).toHaveLength(2);
    expect(JSON.parse(command.writes[1] ?? "{}")).toMatchObject({ method: "initialized" });
  });
});

type CommandEvents = {
  close: Array<(value: { code: number | null; signal: number | null }) => void>;
  error: Array<(value: string) => void>;
  stdout: Array<(value: TauriRawOutput) => void>;
  stderr: Array<(value: TauriRawOutput) => void>;
};

class FakeCommand implements TauriSidecarCommand {
  readonly writes: string[] = [];
  readonly events: CommandEvents = { close: [], error: [], stdout: [], stderr: [] };
  spawned = false;
  killed = false;

  readonly stdout = {
    on: (_event: "data", listener: (value: TauriRawOutput) => void) => {
      this.events.stdout.push(listener);
    },
  };

  readonly stderr = {
    on: (_event: "data", listener: (value: TauriRawOutput) => void) => {
      this.events.stderr.push(listener);
    },
  };

  on(
    event: "close" | "error",
    listener: ((value: { code: number | null; signal: number | null }) => void) | ((value: string) => void),
  ): unknown {
    if (event === "close") {
      this.events.close.push(listener as (value: { code: number | null; signal: number | null }) => void);
    } else {
      this.events.error.push(listener as (value: string) => void);
    }
    return this;
  }

  async spawn() {
    this.spawned = true;
    return {
      write: async (input: string | Uint8Array | number[]) => {
        this.writes.push(typeof input === "string" ? input : String(input));
      },
      kill: async () => {
        this.killed = true;
      },
    };
  }

  emitStdout(value: TauriRawOutput): void {
    for (const listener of this.events.stdout) {
      listener(value);
    }
  }

  emitError(value: string): void {
    for (const listener of this.events.error) {
      listener(value);
    }
  }

  emitClose(value: { code: number | null; signal: number | null }): void {
    for (const listener of this.events.close) {
      listener(value);
    }
  }
}
