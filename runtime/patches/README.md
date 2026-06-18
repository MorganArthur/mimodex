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
   `mimo-v2.5`，将 `mimo-v2.5-pro` 标记为高级隐藏候选，显式声明 MiMo V2.5 系列
   `1,000,000` token 上下文窗口，并关闭首阶段未验证的图片、搜索和服务等级能力。该补丁已通过 Windows Runtime
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

7. `0007-use-mimo-identity-and-disable-thinking.patch`

   使用 Mimodex 专属 MiMo 系统提示替换上游 Codex 默认提示，避免模型错误声称自己是
   Claude、Anthropic、Codex 或 OpenAI；提示中补入 Codex 风格任务执行规范，包括先读项目、
   遵守 `AGENTS.md`、保护用户改动、聚焦修改和验证结果。Chat Completions 请求只在无工具
   简单轮次设置 `thinking.type = disabled`，带工具编码任务不再强制禁用 thinking。补丁同时验证
   实际请求中的身份提示和 thinking 策略。该补丁已通过 Windows Runtime CI 权威验证，`v0.1.7`
   的策略调整仍需新一轮 Runtime CI 复验。验证记录：
   [Runtime CI #27393023486](https://github.com/MorganArthur/mimodex/actions/runs/27393023486)。

8. `0008-stream-deltas-and-fast-simple-chat.patch`

   对明确的寒暄、身份和能力问答使用无工具 Chat Completions 快速路径，避免简单
   对话仍携带完整 Agent 工具定义；编码任务以及已有工具调用历史的线程继续保留
   完整工具能力。同一阶段的桌面 Runtime 客户端将单个 stdout 批次中的协议消息
   分批交给浏览器绘制，使真实 SSE 文本增量不会被 React 合并成一次整段显示。
   该补丁已通过 Windows Runtime CI 权威验证。验证记录：
   [Runtime CI #27397710384](https://github.com/MorganArthur/mimodex/actions/runs/27397710384)。

9. `0009-configurable-mimo-base-url.patch`

   允许 Mimodex 桌面端通过 `MIMO_BASE_URL` 为内置 MiMo Provider 注入可信的
   Chat Completions 兼容端点；未配置或值为空时继续使用小米 MiMo 官方端点。
   API Key 仍沿用独立的 Windows 凭据管理器链路，不写入普通设置文件。

10. `0010-fix-mimo-context-window-fallback.patch`

   修复 MiMo 模型 slug 走 fallback metadata 时丢失 1,000,000 token 上下文窗口、
   MiMo 专属身份提示和工具能力元数据的问题；同时让 fallback 路径使用 `v0.1.7`
   的任务执行强化提示，避免模型目录刷新或未知 slug 路径退回薄提示。

当前补丁队列包含 10 个补丁。前 9 个补丁已在锁定上游 commit 上通过 Windows Runtime CI，
并被 Windows Preview 用于构建真实 Runtime sidecar；`v0.1.7` 对 0007 与 0010 的任务质量
调整需要由下一轮 Runtime CI 和 Windows Release 复验。当前阶段不再新增首版 Adapter 大功能，
重点是真实失败路径、异常恢复、上游基线维护和私测验收。
