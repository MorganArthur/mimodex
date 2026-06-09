# Runtime 补丁队列

补丁按 `series` 文件中的顺序应用到 `runtime/upstream.lock.json` 锁定的 Codex
commit。

当前补丁：

1. `0001-add-chat-completions-wire-api.patch`

   增加 `ChatCompletions` wire API 类型、配置解析与最小分派入口，并保持
   Responses 行为不变。首阶段调用会返回明确的未实现能力错误。该补丁已通过
   Windows Runtime CI。

2. `0002-add-chat-completions-history-encoder.patch`

   增加确定性 Chat 历史消息编码和函数工具定义转换；完整保留
   `reasoning_content`、`tool_call_id` 与串行/并行工具轮次边界；将 Codex
   `developer` 上下文降级为 `system`；拒绝首版不支持的消息、工具和结构化工具
   输出，并递归移除 Responses 专属 schema 字段。该补丁加入队列后由 Windows
   Runtime CI 验证。
