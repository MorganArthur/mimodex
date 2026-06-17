import { Command, type Child, type Command as ShellCommand } from "@tauri-apps/plugin-shell";

import {
  MimodexRuntimeClient,
  ProcessRuntimeTransport,
  type RuntimeProcessPort,
  type Unsubscribe,
} from "@mimodex/runtime-client";

type Listener<T> = (value: T) => void;
export type TauriRawOutput = Uint8Array | number[];

export interface TauriSidecarCommand {
  stdout: {
    on(event: "data", listener: Listener<TauriRawOutput>): unknown;
  };
  stderr: {
    on(event: "data", listener: Listener<TauriRawOutput>): unknown;
  };
  on(event: "close", listener: Listener<{ code: number | null; signal: number | null }>): unknown;
  on(event: "error", listener: Listener<string>): unknown;
  spawn(): Promise<Pick<Child, "kill" | "write">>;
}

export type TauriSidecarCommandFactory = () => TauriSidecarCommand;

const createCommand: TauriSidecarCommandFactory = () =>
  Command.sidecar("binaries/mimodex-runtime", [], { encoding: "raw" }) as ShellCommand<Uint8Array>;

export class TauriRuntimeProcessPort implements RuntimeProcessPort {
  readonly #commandFactory: TauriSidecarCommandFactory;
  readonly #stdoutListeners = new Set<Listener<Uint8Array>>();
  readonly #stderrListeners = new Set<Listener<string | Uint8Array>>();
  readonly #exitListeners = new Set<Listener<{ code?: number; signal?: string } | undefined>>();
  #child: Pick<Child, "kill" | "write"> | null = null;
  #started = false;
  #closed = false;

  constructor(commandFactory: TauriSidecarCommandFactory = createCommand) {
    this.#commandFactory = commandFactory;
  }

  async start(): Promise<void> {
    if (this.#started) {
      throw new Error("Mimodex Runtime sidecar already started");
    }
    if (this.#closed) {
      throw new Error("Mimodex Runtime sidecar port is closed");
    }
    this.#started = true;
    const command = this.#commandFactory();
    command.stdout.on("data", (chunk) => this.#emit(this.#stdoutListeners, normalizeRawOutput(chunk)));
    command.stderr.on("data", (chunk) => this.#emit(this.#stderrListeners, normalizeRawOutput(chunk)));
    command.on("error", (message) => this.#emit(this.#stderrListeners, message));
    command.on("close", ({ code, signal }) => {
      this.#child = null;
      this.#closed = true;
      this.#emit(this.#exitListeners, {
        ...(code === null ? {} : { code }),
        ...(signal === null ? {} : { signal: String(signal) }),
      });
    });
    try {
      this.#child = await command.spawn();
    } catch (error) {
      this.#started = false;
      throw error;
    }
  }

  async write(input: string): Promise<void> {
    if (!this.#child) {
      throw new Error("Mimodex Runtime sidecar is not running");
    }
    await this.#child.write(input);
  }

  async kill(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#child) {
      await this.#child.kill();
      this.#child = null;
    }
  }

  onStdout(listener: Listener<string | Uint8Array>): Unsubscribe {
    this.#stdoutListeners.add(listener);
    return () => this.#stdoutListeners.delete(listener);
  }

  onStderr(listener: Listener<string | Uint8Array>): Unsubscribe {
    this.#stderrListeners.add(listener);
    return () => this.#stderrListeners.delete(listener);
  }

  onExit(listener: Listener<{ code?: number; signal?: string } | undefined>): Unsubscribe {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  #emit<T>(listeners: Set<Listener<T>>, value: T): void {
    for (const listener of listeners) {
      listener(value);
    }
  }
}

function normalizeRawOutput(chunk: TauriRawOutput): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk);
}

export function createTauriRuntimeClient(): MimodexRuntimeClient {
  return new MimodexRuntimeClient(
    new ProcessRuntimeTransport(new TauriRuntimeProcessPort()),
    {
      clientVersion: "0.1.5",
      experimentalApi: true,
      requestTimeoutMs: 60_000,
    },
  );
}
