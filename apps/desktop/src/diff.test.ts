import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "./diff.js";

describe("parseUnifiedDiff", () => {
  it("按暂存区和文件拆分 Git Diff", () => {
    const files = parseUnifiedDiff(`## 已暂存

diff --git a/.gitignore b/.gitignore
--- /dev/null
+++ b/.gitignore
@@ -0,0 +1,2 @@
+node_modules/
+dist/

## 未暂存

diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+next`);

    expect(files).toEqual([
      expect.objectContaining({
        path: ".gitignore",
        section: "已暂存",
        additions: 2,
        deletions: 0,
      }),
      expect.objectContaining({
        path: "src/app.ts",
        section: "未暂存",
        additions: 1,
        deletions: 1,
      }),
    ]);
  });

  it("为 Runtime 的无文件头 Diff 提供单项审阅入口", () => {
    expect(parseUnifiedDiff("+ return left + right;")).toEqual([
      expect.objectContaining({
        path: "Agent 变更",
        additions: 1,
        deletions: 0,
      }),
    ]);
  });
});
