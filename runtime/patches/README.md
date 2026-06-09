# Runtime 补丁队列

补丁按 `series` 文件中的顺序应用到 `runtime/upstream.lock.json` 锁定的 Codex
commit。

首个计划补丁：

`0001-add-chat-completions-wire-api.patch`

该补丁将只增加 `ChatCompletions` wire API 类型、配置解析与最小分派入口，并保持
Responses 行为不变。MiMo 请求编码和 SSE 解析将在后续独立补丁中实现。
