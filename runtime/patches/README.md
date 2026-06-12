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

3. `0003-add-mimo-chat-completions-sse-parser.patch`

   增加 `/chat/completions` 流式端点与 MiMo SSE 累积解析器；在任意网络分块下
   稳定映射文本、完整推理、碎片化函数参数、完成项、用量、响应 ID 和结束原因；
   对多 choice、缺失工具 ID/名称、无效 JSON 参数和不完整流返回明确错误。该补丁
   加入队列后由 Windows Runtime CI 验证。

4. `0004-add-mimo-core-basic-model-flow.patch`

   将 Core 的 `ChatCompletions` 分派接到 `/chat/completions` 流式端点，构建
   确定性 Chat 请求并拒绝尚未验证的结构化输出与服务等级；注册使用 `api-key`
   Header 的内置 MiMo Provider 和专属静态模型目录。目录默认展示
   `mimo-v2.5`，将 `mimo-v2.5-pro` 标记为高级隐藏候选，并关闭首阶段未验证的
   图片、搜索、并行工具、服务等级和上下文窗口声明。该补丁已通过 Windows Runtime
   CI 验证。验证记录：
   [Runtime CI #27245545541](https://github.com/MorganArthur/mimodex/actions/runs/27245545541)。

5. `0005-add-mimo-tool-loop-and-recovery.patch`

   为 MiMo 模型目录开启已验证的标准函数工具与并行工具能力；增加真实
   `shell_command` 执行闭环、推理与工具结果历史重放、rollout 恢复继续，以及
   app-server `thread/start`、`turn/start`、`turn/interrupt` 生命周期测试。
   该补丁已通过 Windows Runtime CI 权威验证。验证记录：
   [Runtime CI #27249955613](https://github.com/MorganArthur/mimodex/actions/runs/27249955613)。

6. `0006-accept-null-mimo-sse-collections.patch`

   兼容 MiMo 流式响应中显式返回 `choices: null` 或 `tool_calls: null` 的增量，
   将这些可空集合按空数组处理，避免正常对话因为 SSE 反序列化失败而重复重连。
   同时加入覆盖真实可空集合形态的 Runtime 回归测试。该补丁已通过 Windows Runtime
   CI 权威验证。验证记录：
   [Runtime CI #27388925508](https://github.com/MorganArthur/mimodex/actions/runs/27388925508)。
