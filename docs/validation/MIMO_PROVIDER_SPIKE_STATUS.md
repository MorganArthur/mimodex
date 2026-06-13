# MiMo Provider Spike 当前状态

- 状态：核心 Provider 验证与 Runtime Adapter 已完成，进入生产加固验证
- 最后更新：2026-06-13
- 当前阶段：Windows 私测准入与真实失败路径验证

## 已完成

- 创建独立的 `spikes/mimo-provider` TypeScript/Node 测试工程。
- 默认模型配置为 `mimo-v2.5`，高级模型配置为 `mimo-v2.5-pro`。
- 实现直接调用 MiMo Chat Completions 的最小 HTTP 客户端。
- 实现 SSE 分帧和 JSON 增量解析。
- 实现文本、`reasoning_content` 和碎片化工具调用参数组装。
- 实现 Provider HTTP 错误归一化与凭据脱敏。
- 实现只允许读取合成 Fixture 项目的工具调用循环。
- 实现工具路径穿越阻止和未知工具拒绝。
- 实现包含 `reasoning_content`、工具调用和工具结果的会话保存与恢复。
- 提供默认模型、高级模型、工具循环和会话恢复 CLI 命令。
- 默认模型 `mimo-v2.5` 已完成真实基础流式请求。
- 确认默认模型返回流式 `reasoning_content` 和最终文本。
- 确认流式响应包含结束原因、响应 ID、用量与独立推理 Token 数。
- 基础流式探针现在自动保存不含回答正文和推理正文的脱敏报告。
- 高级模型 `mimo-v2.5-pro` 已完成真实基础流式请求。
- 默认模型已完成三次连续真实工具调用并正确识别合成项目 Bug。
- 已确认工具调用 ID、工具结果关联和每轮 `reasoning_content` 均完整持久化。
- 默认模型已通过一次新进程中的真实会话恢复，MiMo 接受完整工具与推理历史。
- 高级模型已完成四次连续真实工具调用。
- 默认模型已通过权限拒绝与工具执行失败后的恢复验证，且未重复不可重试工具。
- 默认模型已在同一个助手响应中成功生成两个工具调用。
- 默认模型流式请求取消成功，且取消后同一客户端仍可继续请求。
- 默认模型包含工具历史的会话已跨新进程成功恢复两次。
- 发现负向重放实测与官方文档不一致：移除推理内容后未观察到预期 400。
- 已固定 Codex 上游盘点基线 commit：`14660c22d14312c28a50c52954dd77dd88f03c26`。
- 已完成 Codex Runtime 首轮源码盘点，确认采用新增 Chat Completions wire Adapter、
  复用现有 Agent Core 的实现路径。
- 已完成两个模型、三种推理内容修改方式的负向重放矩阵；6 种组合均被 API 接受。
- 已确认本地不安装 Rust 工具链，原生验证和 Windows 安装包构建交由 GitHub Actions。
- 已完成 9 个 Runtime 补丁并通过 Windows Runtime CI。
- 已完成 Tauri sidecar、桌面 Runtime 客户端、流式增量绘制和真实 Windows Preview。
- 已完成自定义 Base URL、连接诊断、结构化错误引导、Token 用量和活动审计展示。

## Spike 执行环境

| 项目 | 状态 |
| --- | --- |
| 验证日期与时区 | 2026-06-09，Asia/Shanghai |
| 操作系统 | Windows |
| Shell | PowerShell |
| Node.js | 24.11.1 |
| npm | 11.16.0 |
| Git | 2.51.2.windows.1，仓库已初始化 |
| Rust / Cargo | 本地不安装；由 GitHub Actions 提供权威原生构建与测试环境 |
| `MIMO_API_KEY` | 用户已在独立 PowerShell 会话中配置；不写入项目 |
| 默认 Base URL | `https://api.xiaomimimo.com/v1` |
| API 区域 | 待确认 |
| 默认模型 | `mimo-v2.5` |
| 高级模型 | `mimo-v2.5-pro` |

## 自动化验证结果

执行命令：

```powershell
cd spikes/mimo-provider
npm run verify
```

结果：

- TypeScript 类型检查通过。
- 测试共 23 项。
- 离线测试通过 22 项。
- 当时 Codex 进程中的自动化真实 API 测试因无法访问独立 PowerShell 会话变量而跳过 1 项。
- 失败 0 项。

## 默认模型真实基线结果

证据记录：[2026-06-09 `mimo-v2.5` 基础流式探针](evidence/2026-06-09-mimo-v2.5-baseline.md)

| 项目 | 结果 |
| --- | --- |
| 有效凭据和默认端点 | 通过 |
| 文本流式输出 | 通过 |
| 推理流式输出 | 通过 |
| 最终 `content` | 存在 |
| 最终 `reasoning_content` | 存在 |
| 结束原因 | `stop` |
| `prompt_tokens` | 43 |
| `completion_tokens` | 86 |
| `reasoning_tokens` | 75 |
| `total_tokens` | 129 |

## 高级模型真实基线结果

证据记录：[2026-06-09 `mimo-v2.5-pro` 基础流式探针](evidence/2026-06-09-mimo-v2.5-pro-baseline.md)

| 项目 | 结果 |
| --- | --- |
| 文本流式输出 | 通过 |
| 推理流式输出 | 通过 |
| 最终 `content` | 存在 |
| 最终 `reasoning_content` | 存在 |
| 结束原因 | `stop` |
| `prompt_tokens` | 43 |
| `completion_tokens` | 86 |
| `reasoning_tokens` | 75 |
| `total_tokens` | 129 |

## 默认模型真实工具循环结果

证据记录：[2026-06-09 `mimo-v2.5` 真实工具循环](evidence/2026-06-09-mimo-v2.5-tool-loop.md)

| 项目 | 结果 |
| --- | --- |
| 单工具调用 | 通过 |
| 连续工具调用 | 通过，连续 3 次 |
| 工具调用 ID | 稳定并已保存 |
| 工具结果 ID 关联 | 全部匹配 |
| 工具调用轮次结束原因 | `tool_calls` |
| 最终轮次结束原因 | `stop` |
| 工具型助手消息推理内容 | 全部保存 |
| Bug 识别结果 | 正确 |

## 默认模型真实恢复结果

证据记录：[2026-06-09 `mimo-v2.5` 进程重启恢复](evidence/2026-06-09-mimo-v2.5-resume.md)

| 项目 | 结果 |
| --- | --- |
| 新进程读取持久会话 | 通过 |
| 包含工具历史的请求重放 | 通过 |
| 包含 `reasoning_content` 的请求重放 | 通过 |
| Provider 协议错误 | 无 |
| 恢复请求结束原因 | `stop` |
| 恢复后会话再次持久化 | 通过 |

## 高级模型真实工具循环结果

证据记录：[2026-06-09 `mimo-v2.5-pro` 真实工具循环](evidence/2026-06-09-mimo-v2.5-pro-tool-loop.md)

| 项目 | 结果 |
| --- | --- |
| 单工具调用 | 通过 |
| 连续工具调用 | 通过，连续 4 次 |
| 工具调用与结果 ID | 全部匹配 |
| 工具型助手消息推理内容 | 全部保存 |
| 最终轮次结束原因 | `stop` |

## 默认模型工具恢复与同响应多工具结果

证据记录：[2026-06-09 `mimo-v2.5` 工具恢复与同响应多工具调用](evidence/2026-06-09-mimo-v2.5-recovery-and-parallel-tools.md)

| 项目 | 结果 |
| --- | --- |
| 权限拒绝后恢复 | 通过 |
| 拒绝后重复不可重试工具 | 未发生 |
| 工具执行失败后恢复 | 通过 |
| 失败后重复不可重试工具 | 未发生 |
| 同一助手响应内多个工具调用 | 通过，单次响应包含 2 个调用 |
| 多工具调用与结果 ID 关联 | 全部匹配 |

## 默认模型取消与第二次恢复结果

证据记录：[2026-06-09 `mimo-v2.5` 流式取消与第二次恢复](evidence/2026-06-09-mimo-v2.5-cancellation-and-second-resume.md)

| 项目 | 结果 |
| --- | --- |
| 收到流式事件后主动取消 | 通过 |
| 取消归一化类别 | `cancelled` |
| 取消后同一客户端继续请求 | 通过 |
| 第二次新进程恢复 | 通过 |
| 第二次恢复后消息总数 | 13 |

## 负向推理重放不一致

证据记录：[2026-06-09 `mimo-v2.5` 缺失推理内容负向重放不一致](evidence/2026-06-09-mimo-v2.5-negative-replay-discrepancy.md)

矩阵证据记录：[2026-06-09 MiMo 推理内容负向重放矩阵](evidence/2026-06-09-mimo-negative-replay-matrix.md)

两个模型在省略、空字符串和截断三种模式下均接受了包含历史工具调用的请求，6 种
组合均未返回文档预期的 400。此项继续标记为“文档与实测不一致”。产品实现仍必须
完整保存并回传推理内容。

## 尚未验证与生产加固项

- 更长的多次进程重启恢复链。
- 限流、上下文超限、超时与服务不可用错误结构。
- 工具执行中异常退出和状态不确定副作用的人工恢复路径。
- 真实 Windows 安装环境中的凭据、权限、Agent 闭环与日志脱敏。
- 长上下文压缩不会破坏 MiMo 历史重放。

## 下一步执行顺序

1. 使用最新 Windows Preview 执行私测验收清单。
2. 使用受保护、预算受限凭据验证限流、超时、上下文超限和服务不可用。
3. 补齐异常恢复、脱敏和副作用重试安全测试。
4. 在真实私测通过后冻结首版 Provider 兼容边界。

## 当前结论

两个模型的基础流式和连续工具调用均已通过。默认模型还通过了一次新进程中的真实
会话恢复，证明当前保存的推理、工具调用与工具结果可以被 MiMo 接受并继续对话。
工具拒绝/失败恢复、同响应多工具调用、流式取消和两次新进程恢复均已通过。当前唯一
发现的 Provider 协议疑点是缺失推理内容时未出现官方文档描述的 400。该差异不阻止
继续实现，但必须在 Provider Adapter 中坚持完整保存推理内容，并继续验证差异。
Codex Runtime 源码盘点结论已经落地：新增 Chat Completions wire Adapter、复用现有
Agent Core 的方案已通过 Runtime CI、真实 sidecar 和 Windows Preview。当前不存在
已知的 Provider 架构阻断项，剩余风险集中在真实失败路径、长线程和 Windows 私测。
