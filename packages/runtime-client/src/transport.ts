export type Unsubscribe = () => void;

export type RuntimeTransportHandlers = {
  onStdout: (chunk: string | Uint8Array) => void;
  onStderr: (chunk: string | Uint8Array) => void;
  onExit: (details?: { code?: number; signal?: string }) => void;
};

export interface RuntimeTransport {
  start(handlers: RuntimeTransportHandlers): Promise<void>;
  writeLine(line: string): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeProcessPort {
  start?(): Promise<void>;
  write(input: string): Promise<void>;
  kill(): Promise<void>;
  onStdout(listener: (chunk: string | Uint8Array) => void): Unsubscribe;
  onStderr(listener: (chunk: string | Uint8Array) => void): Unsubscribe;
  onExit(listener: (details?: { code?: number; signal?: string }) => void): Unsubscribe;
}

export class ProcessRuntimeTransport implements RuntimeTransport {
  readonly #process: RuntimeProcessPort;
  #unsubscribers: Unsubscribe[] = [];

  constructor(process: RuntimeProcessPort) {
    this.#process = process;
  }

  async start(handlers: RuntimeTransportHandlers): Promise<void> {
    if (this.#unsubscribers.length > 0) {
      throw new Error("Runtime process transport already started");
    }
    this.#unsubscribers = [
      this.#process.onStdout(handlers.onStdout),
      this.#process.onStderr(handlers.onStderr),
      this.#process.onExit(handlers.onExit),
    ];
    try {
      await this.#process.start?.();
    } catch (error) {
      for (const unsubscribe of this.#unsubscribers.splice(0)) {
        unsubscribe();
      }
      throw error;
    }
  }

  async writeLine(line: string): Promise<void> {
    await this.#process.write(`${line}\n`);
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      unsubscribe();
    }
    await this.#process.kill();
  }
}
