import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "../src/redact.js";

test("按字段名和显式凭据脱敏", () => {
  const secret = "sk-test-secret";
  const value = {
    headers: {
      "api-key": secret,
      authorization: `Bearer ${secret}`,
      harmless: `value ${secret}`,
    },
    nested: [{ access_token: secret }],
  };

  assert.deepEqual(redact(value, [secret]), {
    headers: {
      "api-key": "[REDACTED]",
      authorization: "[REDACTED]",
      harmless: "value [REDACTED]",
    },
    nested: [{ access_token: "[REDACTED]" }],
  });
});
