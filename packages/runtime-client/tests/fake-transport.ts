import type {
  RuntimeTransport,
  RuntimeTransportHandlers,
} from "../src/transport.js";

export class FakeTransport implements RuntimeTransport {
  readonly writes: string[] = [];
  handlers?: RuntimeTransportHandlers;
  onWrite?: (line: string) => void;
  closed = false;

  async start(handlers: RuntimeTransportHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async writeLine(line: string): Promise<void> {
    this.writes.push(line);
    this.onWrite?.(line);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emitStdout(chunk: string | Uint8Array): void {
    this.handlers?.onStdout(chunk);
  }

  emitStderr(chunk: string | Uint8Array): void {
    this.handlers?.onStderr(chunk);
  }

  emitExit(details?: { code?: number; signal?: string }): void {
    this.handlers?.onExit(details);
  }
}
