import assert from "node:assert/strict";
import test from "node:test";
import { MimoClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig();

test(
  "真实 MiMo API 可以完成默认模型基础流式请求",
  { skip: !config.apiKey },
  async () => {
    const client = new MimoClient(config);
    const result = await client.streamCompletion({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你正在参与 API 连通性测试，请只回复简短文本。",
        },
        { role: "user", content: "回复 OK" },
      ],
    });

    assert.ok(result.message.content || result.message.reasoning_content);
  },
);
