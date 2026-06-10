import { RuntimeProtocolError } from "./errors.js";

export class NdjsonDecoder {
  readonly #decoder = new TextDecoder();
  readonly #maxBufferedCharacters: number;
  #buffer = "";

  constructor(maxBufferedCharacters = 8 * 1024 * 1024) {
    this.#maxBufferedCharacters = maxBufferedCharacters;
  }

  push(chunk: string | Uint8Array): string[] {
    this.#buffer +=
      typeof chunk === "string" ? chunk : this.#decoder.decode(chunk, { stream: true });
    this.#assertWithinLimit();
    return this.#takeCompleteLines();
  }

  finish(): string[] {
    this.#buffer += this.#decoder.decode();
    this.#assertWithinLimit();
    const lines = this.#takeCompleteLines();
    const remainder = this.#buffer.trim();
    this.#buffer = "";
    if (remainder) {
      lines.push(remainder);
    }
    return lines;
  }

  #assertWithinLimit(): void {
    if (this.#buffer.length > this.#maxBufferedCharacters) {
      throw new RuntimeProtocolError(
        `Runtime stdout line exceeds ${this.#maxBufferedCharacters} characters`,
      );
    }
  }

  #takeCompleteLines(): string[] {
    const lines: string[] = [];
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, "").trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) {
        lines.push(line);
      }
      newline = this.#buffer.indexOf("\n");
    }
    return lines;
  }
}
