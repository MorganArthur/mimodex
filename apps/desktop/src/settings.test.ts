import { describe, expect, it } from "vitest";

import { normalizeSettings } from "./settings.js";

describe("normalizeSettings", () => {
  it("规范化端点并保留支持的默认项", () => {
    expect(
      normalizeSettings({
        apiBaseUrl: " https://gateway.example.com/v1/ ",
        defaultModel: "mimo-v2.5-pro",
        defaultSandbox: "read-only",
      }),
    ).toEqual({
      apiBaseUrl: "https://gateway.example.com/v1",
      defaultModel: "mimo-v2.5-pro",
      defaultSandbox: "read-only",
    });
  });

  it("拒绝不安全或无效的基础地址", () => {
    expect(() =>
      normalizeSettings({
        apiBaseUrl: "file:///tmp/mimo",
        defaultModel: "mimo-v2.5",
        defaultSandbox: "workspace-write",
      }),
    ).toThrow(/HTTP 或 HTTPS/);
    expect(() =>
      normalizeSettings({
        apiBaseUrl: "https://user:password@example.com/v1",
        defaultModel: "mimo-v2.5",
        defaultSandbox: "workspace-write",
      }),
    ).toThrow(/不能包含凭据/);
  });
});
