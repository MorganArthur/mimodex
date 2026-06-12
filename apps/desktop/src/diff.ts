export type DiffFile = {
  id: string;
  path: string;
  section: string | null;
  diff: string;
  additions: number;
  deletions: number;
};

export function parseUnifiedDiff(value: string): DiffFile[] {
  const lines = value.trim().split(/\r?\n/);
  if (!value.trim()) {
    return [];
  }

  const files: DiffFile[] = [];
  let section: string | null = null;
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const diff = current.join("\n").trim();
    if (!diff) {
      current = [];
      return;
    }
    const path = diffPath(current) ?? "Agent 变更";
    const { additions, deletions } = lineCounts(current);
    files.push({
      id: `${section ?? "runtime"}:${path}:${files.length}`,
      path,
      section,
      diff,
      additions,
      deletions,
    });
    current = [];
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      section = line.slice(3).trim() || null;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      flush();
    }
    current.push(line);
  }
  flush();

  return files;
}

function diffPath(lines: string[]): string | null {
  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      return line.slice(6);
    }
    if (line.startsWith("+++ ") && line !== "+++ /dev/null") {
      return line.slice(4);
    }
  }
  const header = lines.find((line) => line.startsWith("diff --git "));
  const match = header?.match(/^diff --git a\/(.+) b\/(.+)$/);
  return match?.[2] ?? match?.[1] ?? null;
}

function lineCounts(lines: string[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}
