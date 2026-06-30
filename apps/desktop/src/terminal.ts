import { isTauri } from "@tauri-apps/api/core";
import { Command, type Child, type Command as ShellCommand } from "@tauri-apps/plugin-shell";

type Listener = () => void;

export type TerminalStatus = "idle" | "starting" | "running" | "exited" | "error";
export type TerminalStream = "stdin" | "stdout" | "stderr" | "system";

export type TerminalChunk = {
  id: number;
  stream: TerminalStream;
  text: string;
  timestamp: number;
};

export type TerminalSnapshot = {
  error: string | null;
  exitCode: number | null;
  output: TerminalChunk[];
  projectPath: string;
  shellLabel: string;
  status: TerminalStatus;
};

export interface EmbeddedTerminalSession {
  getSnapshot(): TerminalSnapshot;
  send(input: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: Listener): () => void;
}

export interface EmbeddedTerminalService {
  createSession(projectPath: string): EmbeddedTerminalSession;
}

type ShellCandidate = {
  args: string[];
  label: string;
  program: string;
};

const SHELL_CANDIDATES: ShellCandidate[] = [
  {
    args: ["-NoLogo", "-NoProfile", "-NoExit"],
    label: "PowerShell",
    program: "embedded-pwsh",
  },
  {
    args: ["-NoLogo", "-NoProfile", "-NoExit"],
    label: "Windows PowerShell",
    program: "embedded-powershell",
  },
];

const MAX_OUTPUT_CHARS = 180_000;

export function createTerminalService(): EmbeddedTerminalService {
  return isTauri() ? new TauriEmbeddedTerminalService() : new DemoEmbeddedTerminalService();
}

class TauriEmbeddedTerminalService implements EmbeddedTerminalService {
  createSession(projectPath: string): EmbeddedTerminalSession {
    return new TauriEmbeddedTerminalSession(projectPath);
  }
}

class TauriEmbeddedTerminalSession implements EmbeddedTerminalSession {
  readonly #decoder = new TextDecoder();
  readonly #listeners = new Set<Listener>();
  readonly #projectPath: string;
  #child: Pick<Child, "kill" | "write"> | null = null;
  #error: string | null = null;
  #exitCode: number | null = null;
  #nextChunkId = 1;
  #output: TerminalChunk[] = [];
  #shellLabel = "PowerShell";
  #status: TerminalStatus = "idle";

  constructor(projectPath: string) {
    this.#projectPath = projectPath;
  }

  getSnapshot(): TerminalSnapshot {
    return {
      error: this.#error,
      exitCode: this.#exitCode,
      output: this.#output,
      projectPath: this.#projectPath,
      shellLabel: this.#shellLabel,
      status: this.#status,
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#status === "running" || this.#status === "starting") {
      return;
    }
    this.#status = "starting";
    this.#error = null;
    this.#exitCode = null;
    this.#emit();

    const failures: string[] = [];
    for (const candidate of SHELL_CANDIDATES) {
      try {
        await this.#spawn(candidate);
        return;
      } catch (error) {
        failures.push(`${candidate.label}: ${errorMessage(error)}`);
      }
    }

    this.#status = "error";
    this.#error = failures.join("\n") || "无法启动终端。";
    this.#append("system", `${this.#error}\r\n`);
    this.#emit();
  }

  async send(input: string): Promise<void> {
    if (!this.#child || this.#status !== "running") {
      return;
    }
    this.#append("stdin", `> ${input}\r\n`);
    await this.#child.write(`${input}\r\n`);
  }

  async stop(): Promise<void> {
    if (!this.#child) {
      return;
    }
    const child = this.#child;
    this.#child = null;
    try {
      await child.kill();
    } catch (error) {
      this.#append("system", `终端关闭失败：${errorMessage(error)}\r\n`);
    }
  }

  async #spawn(candidate: ShellCandidate): Promise<void> {
    const command = Command.create(candidate.program, candidate.args, {
      cwd: this.#projectPath,
      encoding: "raw",
    }) as ShellCommand<Uint8Array>;
    command.stdout.on("data", (chunk) => this.#append("stdout", this.#decode(chunk)));
    command.stderr.on("data", (chunk) => this.#append("stderr", this.#decode(chunk)));
    command.on("error", (message) => {
      this.#status = "error";
      this.#error = message;
      this.#append("system", `\r\n${message}\r\n`);
      this.#emit();
    });
    command.on("close", ({ code }) => {
      this.#child = null;
      this.#exitCode = code;
      if (this.#status !== "error") {
        this.#status = "exited";
      }
      this.#append("system", `\r\n终端已退出${code === null ? "" : `，代码 ${code}`}。\r\n`);
      this.#emit();
    });

    this.#child = await command.spawn();
    this.#shellLabel = candidate.label;
    this.#status = "running";
    this.#append("system", `${candidate.label} · ${this.#projectPath}\r\n`);
    try {
      await this.#child.write(terminalBootstrapCommand(this.#projectPath));
    } catch (error) {
      this.#append("system", `终端初始化失败：${errorMessage(error)}\r\n`);
    }
    this.#emit();
  }

  #append(stream: TerminalStream, text: string): void {
    if (!text) {
      return;
    }
    this.#output = trimTerminalOutput([
      ...this.#output,
      {
        id: this.#nextChunkId++,
        stream,
        text,
        timestamp: Date.now(),
      },
    ]);
    this.#emit();
  }

  #decode(chunk: Uint8Array): string {
    return this.#decoder.decode(chunk, { stream: true });
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

class DemoEmbeddedTerminalService implements EmbeddedTerminalService {
  createSession(projectPath: string): EmbeddedTerminalSession {
    return new DemoEmbeddedTerminalSession(projectPath);
  }
}

class DemoEmbeddedTerminalSession implements EmbeddedTerminalSession {
  readonly #listeners = new Set<Listener>();
  readonly #projectPath: string;
  #error: string | null = null;
  #nextChunkId = 1;
  #output: TerminalChunk[] = [];
  #status: TerminalStatus = "idle";

  constructor(projectPath: string) {
    this.#projectPath = projectPath;
  }

  getSnapshot(): TerminalSnapshot {
    return {
      error: this.#error,
      exitCode: null,
      output: this.#output,
      projectPath: this.#projectPath,
      shellLabel: "Demo Shell",
      status: this.#status,
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#status === "running") {
      return;
    }
    this.#status = "running";
    this.#append("system", `Demo Shell · ${this.#projectPath}\r\n`);
  }

  async send(input: string): Promise<void> {
    if (this.#status !== "running") {
      return;
    }
    this.#append("stdin", `> ${input}\r\n`);
    const normalized = input.trim().toLowerCase();
    if (normalized === "pwd" || normalized === "get-location") {
      this.#append("stdout", `${this.#projectPath}\r\n`);
    } else if (normalized) {
      this.#append("stdout", `demo: ${input}\r\n`);
    }
  }

  async stop(): Promise<void> {
    if (this.#status === "running") {
      this.#status = "exited";
      this.#append("system", "终端已关闭。\r\n");
    }
  }

  #append(stream: TerminalStream, text: string): void {
    this.#output = trimTerminalOutput([
      ...this.#output,
      {
        id: this.#nextChunkId++,
        stream,
        text,
        timestamp: Date.now(),
      },
    ]);
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function terminalBootstrapCommand(projectPath: string): string {
  const literalPath = projectPath.replace(/'/g, "''");
  return [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    `Set-Location -LiteralPath '${literalPath}'`,
    "function prompt { \"PS $($executionContext.SessionState.Path.CurrentLocation)> \" }",
    "",
  ].join("; ") + "\r\n";
}

function trimTerminalOutput(output: TerminalChunk[]): TerminalChunk[] {
  let total = 0;
  const kept: TerminalChunk[] = [];
  for (let index = output.length - 1; index >= 0; index -= 1) {
    const chunk = output[index];
    if (!chunk) {
      continue;
    }
    if (total + chunk.text.length <= MAX_OUTPUT_CHARS) {
      kept.push(chunk);
      total += chunk.text.length;
      continue;
    }
    const remaining = MAX_OUTPUT_CHARS - total;
    if (remaining > 0) {
      kept.push({ ...chunk, text: chunk.text.slice(-remaining) });
    }
    break;
  }
  return kept.reverse();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
