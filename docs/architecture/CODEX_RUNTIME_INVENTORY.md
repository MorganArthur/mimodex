# Codex Runtime 接入盘点

- 状态：盘点结论已落地为 9 个 Runtime 补丁并通过 Windows CI
- 最后更新：2026-06-13
- 上游仓库：https://github.com/openai/codex
- 固定上游 commit：`14660c22d14312c28a50c52954dd77dd88f03c26`
- 上游 commit 时间：`2026-06-08T21:39:35-07:00`

## 1. 结论

Mimodex 应继续采用 Codex Rust Runtime 分支，但不能把 MiMo 伪装成现有 Responses
Provider。首版应在模型传输边界新增原生 `ChatCompletions` wire API 和 MiMo Adapter，
将 MiMo 请求与 SSE 响应转换为 Codex 已有的 `Prompt`、`ResponseEvent` 和
`ResponseItem`。

以下能力可直接复用，无需因 MiMo 重写：

- Agent 多轮采样与工具循环；
- 工具注册、调用 ID 关联、并行调度、失败结果回传；
- 审批、沙箱和工具取消；
- 线程、轮次、项目事件和 app-server JSON-RPC；
- `turn/interrupt` 与模型流取消；
- rollout JSONL、SQLite 投影、线程恢复和历史规范化。

主要改造集中在请求构建、Chat Completions 历史编码、工具 Schema 编码、MiMo SSE
解析与模型目录。预计属于中等范围的可控分支，而不是 Runtime 重写。

截至 2026-06-13，这一结论已经通过 `runtime/patches/series` 中的 9 个补丁落地。
基础模型流、工具循环、恢复、可空 SSE 集合、MiMo 身份、简单对话快速路径和可配置
Base URL 均已通过 Runtime CI 与 Windows Preview 构建。

## 2. 已确认的上游事实

### 2.1 Provider 与传输

- 锁定的原始上游 `codex-rs/model-provider-info/src/lib.rs` 中，`WireApi` 只有
  `Responses`；Mimodex 补丁已增加 `ChatCompletions`。
- 配置 `wire_api = "chat"` 会直接返回“已移除”的反序列化错误。
- `codex-rs/core/src/client.rs` 的 `ModelClientSession::stream` 只分派到
  Responses HTTP 或 Responses WebSocket。
- `codex-rs/codex-api` 已提供通用 Provider、HTTP Transport、认证、重试和 SSE
  基础设施，但其请求、端点和 SSE 事件解析均以 Responses API 为中心。
- Provider 配置的 `env_http_headers` 可以从环境变量注入任意 Header。因此 MiMo 的
  `api-key: ${MIMO_API_KEY}` 不要求新增凭据读取机制，也不应使用现有 `env_key`
  的 Bearer 认证路径。

### 2.2 Runtime 中立边界

- `codex-rs/core/src/client_common.rs` 的 `Prompt` 已承载历史、工具、并行调用开关、
  基础指令和输出 Schema，适合作为 Adapter 输入。
- `codex-rs/codex-api/src/common.rs` 的 `ResponseEvent` 已覆盖文本增量、推理增量、
  工具参数增量、完成事件、Token 用量和完整输出项目。
- `codex-rs/protocol/src/models.rs` 的 `ResponseItem` 已覆盖消息、推理、工具调用和
  工具结果，并由 Runtime 后续流程统一处理。
- `ResponseItem::Reasoning.content` 可以持久化原始推理文本，满足 MiMo
  `reasoning_content` 的完整保存要求。

### 2.3 工具循环与取消

- `codex-rs/core/src/tools/router.rs` 根据 `ResponseItem::FunctionCall` 创建标准工具调用。
- `codex-rs/core/src/tools/parallel.rs` 已按工具能力执行并行或串行调度，并把失败与
  取消转为工具结果。
- `codex-rs/core/src/session/turn.rs` 消费统一的 `ResponseEvent`，执行工具并在需要时
  自动发起后续模型请求。
- 模型流和工具执行均使用 `CancellationToken`。
- app-server 已公开 `turn/interrupt`，并在收到 `TurnAborted` 后完成中断请求。

### 2.4 历史与恢复

- `ResponseItem::Reasoning`、`FunctionCall` 和 `FunctionCallOutput` 均属于必须持久化的
  rollout 项。
- `Session::record_conversation_items` 会同时更新内存历史、写入 rollout，并通知原始
  响应项目观察者。
- `ThreadStore` 是存储中立接口，支持创建、恢复、追加、刷新、读取和列出线程。
- 本地实现使用 rollout JSONL 作为可重放历史，并用 SQLite 提供查询投影。
- 历史规范化会为缺失工具结果补入 `aborted`，并移除孤立工具结果。

### 2.5 App Server 与模型目录

- app-server V2 已提供 `thread/start`、`thread/resume`、`turn/start`、
  `turn/interrupt`、`item/started`、`item/completed` 和 `turn/completed`。
- `thread/start` 已支持 `model` 与 `modelProvider`，桌面协议不需要为 MiMo 新增一套
  线程接口。
- Runtime 支持通过 `model_catalog_json` 加载静态模型目录。
- 模型元数据包含 `supports_parallel_tool_calls`、上下文窗口、可见性和默认模型标记，
  足以表达首版 `mimo-v2.5` 默认、`mimo-v2.5-pro` 高级可选的产品决策。

## 3. 模块影响表

| 模块 | 决策 | 首版修改 |
| --- | --- | --- |
| `model-provider-info` | 扩展 | 为 `WireApi` 增加 `ChatCompletions`；内置 Mimodex 分支注册 MiMo Provider |
| `model-provider` | 少量扩展 | 复用配置与 Header 注入；限制 MiMo 不支持的 Provider 能力 |
| `codex-api` | 新增 Adapter | 新增 Chat 请求类型、`/chat/completions` 端点和 MiMo SSE 解析器 |
| `core/client.rs` | 扩展分派 | 按 wire API 构建请求并返回统一 `ResponseStream` |
| `core/client_common.rs` | 复用 | `Prompt` 保持 Runtime 中立，不放入 MiMo 专属字段 |
| `protocol/models.rs` | 小幅扩展或复用 | 优先复用 `Reasoning.content`；仅在无法无损重放时增加 Provider 扩展字段 |
| `tools` | 新增编码器 | 把支持的 `ToolSpec::Function` 转成 Chat Completions tools；首版禁用不兼容工具类型 |
| `core/session` | 复用 | 继续消费统一 `ResponseEvent`，不加入 MiMo 分支判断 |
| `context_manager` | 复用并加测试 | 验证推理、工具调用和工具结果在压缩与恢复中不丢失 |
| `rollout` / `thread-store` | 复用 | 保持 JSONL 与 SQLite 机制，增加 MiMo 回放测试 |
| `app-server` / protocol | 基本复用 | 桌面端沿用现有线程、轮次、事件和中断协议 |
| 模型目录 | Mimodex 自有配置 | 默认展示 `mimo-v2.5`；`mimo-v2.5-pro` 进入高级模型选择 |

## 4. MiMo Adapter 最小实现路径

### 阶段 A：无工具的模型流

1. 为 `WireApi` 增加 `ChatCompletions`。
2. 新增 Chat 请求结构与 `/chat/completions` HTTP 端点。
3. 将 `Prompt.base_instructions` 和消息历史转换成 Chat messages。
4. 将 MiMo 文本、推理、用量和完成原因映射到现有 `ResponseEvent`。
5. 使用 `env_http_headers` 注入 `api-key`，日志与报告不得记录值。

### 阶段 B：Agent 工具循环

1. 将支持的函数工具编码为 Chat Completions tools。
2. 按 `index` 累积碎片化工具调用，并在参数完整后产生
   `ResponseItem::FunctionCall`。
3. 将工具结果编码为 `role=tool` 消息，并保持 `tool_call_id`。
4. 将 MiMo 助手消息中的完整 `reasoning_content` 映射为
   `ResponseItem::Reasoning`，回放时恢复到同一助手消息。
5. 复用 Runtime 现有工具调度、失败回传和后续采样逻辑。

### 阶段 C：恢复、取消与一致性

1. 增加包含推理、连续工具和同响应多工具的 rollout 恢复测试。
2. 验证取消模型流后，同一线程可以继续下一轮。
3. 验证取消本地 Shell 工具后，Runtime 等待进程清理并记录中断结果。
4. 验证上下文压缩不会产生孤立工具调用，也不会静默删除需要重放的推理内容。

## 5. Provider 中立类型原则

- `core/session` 与 app-server 不得依赖 MiMo JSON 字段名。
- MiMo Adapter 必须在传输边界内完成 `reasoning_content`、工具增量和结束原因映射。
- 不能把 MiMo Chat 消息直接作为 Runtime 权威历史格式。
- 对无法映射但恢复必需的 Provider 字段，使用明确的 Provider 扩展结构，不把原始
  任意 JSON 散布到核心类型。
- Adapter 必须完整保存和回传推理内容，即使负向实测暂未复现官方文档所述 400。

## 6. 首版能力限制

MiMo Chat Completions Adapter 首版只承诺：

- 文本与推理流；
- 标准函数工具；
- 连续工具和同响应多工具；
- 工具拒绝、失败和取消；
- 本地线程持久化与恢复；
- `mimo-v2.5` 和 `mimo-v2.5-pro`。

首版默认关闭或隐藏以下 Responses 专属能力，直到单独验证：

- Responses WebSocket；
- Responses `previous_response_id`、`include` 和加密推理内容；
- Responses 原生 namespace、tool search、web search、image generation 和 freeform
  tool wire 格式；
- 远程压缩、service tier、verbosity 和 Responses 专属 output schema 行为。

## 7. 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| Codex 上游已主动移除 Chat wire API | 上游合并时容易冲突 | 将新增逻辑限制在 Adapter 与单一分派点，持续记录固定上游 commit |
| Chat 历史与 `ResponseItem` 不是一一对应 | 推理或工具消息可能错误重放 | 建立确定性历史编码器和黄金 Fixture 测试 |
| MiMo 推理回放实测与文档不一致 | 隐性兼容性变化 | 始终完整保存并回传，保留负向矩阵回归 |
| Responses 专属工具无法直接用于 Chat | 模型请求被拒绝 | 首版能力白名单，Provider capability 禁用不支持工具 |
| 自动重试重复副作用 | 安全风险 | 只重试尚未产生工具调用或可证明未执行的请求 |
| 上游协议快速变化 | 维护成本 | Runtime 分支保持小改动面，桌面端只依赖 app-server 稳定协议 |

## 8. 测试入口建议

- 在 `codex-api` 为 MiMo SSE 建立脱敏黄金 Fixture 测试。
- 在 `core` 增加 Chat 请求历史编码与统一事件消费测试。
- 在 `core/tests` 增加完整 Agent 工具循环、取消和恢复测试。
- 在 `app-server` 增加 MiMo Provider 下的 thread/start、turn/start、turn/interrupt
  协议测试。
- 保留 `spikes/mimo-provider` 作为真实 API 兼容性探针，不把真实凭据测试混入默认 CI。

## 9. 实施结论

继续采用固定 Codex App Server 上游 commit 与版本化补丁队列。最小
`ChatCompletions` Adapter、Agent 工具循环、恢复和桌面 UI 主流程均已完成。后续重点
是保持补丁边界可审计、补充真实错误与恢复验证，并在必要时评估升级固定上游基线。

## 10. 上游更新规则

- 当前不自动跟随上游 HEAD。
- 如果切换 commit，必须更新本文档并说明原因。
- Mimodex Runtime 发布必须记录对应上游 commit。
