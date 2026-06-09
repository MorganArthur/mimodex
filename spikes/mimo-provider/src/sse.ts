export async function* parseSseData(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const flushEvent = (): string | undefined => {
    if (dataLines.length === 0) return undefined;
    const value = dataLines.join("\n");
    dataLines = [];
    return value;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line === "") {
          const event = flushEvent();
          if (event !== undefined) yield event;
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }

        newlineIndex = buffer.indexOf("\n");
      }

      if (done) break;
    }

    if (buffer.startsWith("data:")) {
      dataLines.push(buffer.slice(5).replace(/^ /, ""));
    }
    const event = flushEvent();
    if (event !== undefined) yield event;
  } finally {
    reader.releaseLock();
  }
}

export async function* parseJsonSse<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  for await (const data of parseSseData(stream)) {
    if (data === "[DONE]") return;
    yield JSON.parse(data) as T;
  }
}
