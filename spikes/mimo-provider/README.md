# MiMo Provider Spike 测试工程

这是一个可丢弃的 TypeScript/Node 协议探针，用于验证和持续回归 MiMo Chat
Completions 的流式输出、`reasoning_content`、工具调用和会话重放。

该工程不是正式 Provider 实现，也不会被桌面端直接依赖。正式 Provider Adapter 已由
Mimodex Runtime 补丁队列实现；本工程继续用于真实 API 兼容与失败路径调查。

## 环境要求

- Node.js 24+
- npm 11+
- 有效的 MiMo API 凭据，仅在真实 API 测试时需要

## 安装与离线验证

```powershell
cd spikes/mimo-provider
npm install
npm run verify
```

离线测试不需要 API Key，覆盖：

- SSE 分帧解析；
- 流式文本、推理和工具参数组装；
- 凭据脱敏；
- 会话序列化与恢复；
- HTTP 请求头与错误归一化。

## 配置真实 API

推荐仅在当前 PowerShell 会话中设置凭据：

```powershell
$env:MIMO_API_KEY = "..."
$env:MIMO_BASE_URL = "https://api.xiaomimimo.com/v1"
```

不要将真实凭据写入 `.env.example`、Fixture、日志或会话文件。

## 探针命令

查看脱敏后的当前配置：

```powershell
npm run probe -- config
```

验证默认模型 `mimo-v2.5` 的基础流式响应：

```powershell
npm run probe -- baseline
```

命令完成后会自动在 `artifacts/reports` 保存脱敏验证报告。报告只记录模型、请求 ID、
结束原因、用量和内容长度，不保存回答正文或推理正文。

验证高级模型：

```powershell
npm run probe -- baseline --model mimo-v2.5-pro
```

也可以指定报告路径：

```powershell
npm run probe -- baseline --report artifacts/reports/default-model.json
```

运行只允许访问合成 Fixture 的工具调用循环，并保存可恢复会话：

```powershell
npm run probe -- tool-loop
```

工具循环完成后会同时保存：

- `artifacts/session-*.json`：用于真实恢复测试，包含合成 Fixture 会话正文；
- `artifacts/reports/tool-loop-*.json`：不含正文的脱敏能力证据。

使用已保存会话验证进程重启后的重放：

```powershell
npm run probe -- resume artifacts/session-<timestamp>.json "继续总结刚才发现的内容"
```

也可以自动选择最近会话：

```powershell
npm run probe -- resume-latest "请确认刚才的工具调用结论，并说明使用过哪些工具"
```

按模型选择最近会话：

```powershell
npm run probe -- resume-latest --model mimo-v2.5 "这是第二次恢复，请继续确认历史结论"
```

恢复成功后会自动在 `artifacts/reports` 保存不含提示词、回答或推理正文的恢复报告。

验证工具拒绝和工具执行失败后的模型恢复：

```powershell
npm run probe -- recovery-loop --scenario denial
npm run probe -- recovery-loop --scenario failure
```

探针要求模型只调用一次测试工具。若模型在收到不可重试的拒绝或失败后重复调用工具，
命令会以失败状态退出。

验证同一助手响应内的多个工具调用：

```powershell
npm run probe -- parallel-tool-loop
```

如果模型没有在同一响应中生成至少两个正确关联的工具调用，命令会以失败状态退出。

记录修改历史 `reasoning_content` 后的实际 API 行为：

```powershell
npm run probe -- negative-replay --mode omit
npm run probe -- negative-replay --mode empty
npm run probe -- negative-replay --mode truncate
```

该探针不会假设 API 必须返回 400。它会记录请求被接受或拒绝、状态码、结束原因，
以及结果是否符合官方文档描述。

一次运行两个模型的全部三种模式：

```powershell
npm run probe -- negative-replay-matrix
```

验证主动取消流式请求后客户端仍可继续请求：

```powershell
npm run probe -- cancel-probe
```

显式运行真实 API 测试：

```powershell
npm run test:live
```

未配置 `MIMO_API_KEY` 时，真实 API 测试会自动跳过。

## 安全边界

- 探针不会执行模型生成的 Shell 命令。
- 可调用工具仅能读取 `fixtures/workspace`。
- `artifacts` 和 `tmp` 已被 Git 忽略。
- 日志只输出归一化事件，禁止打印原始请求头。

## 与验证清单的关系

执行结果应回填到：

- `docs/validation/MIMO_PROVIDER_SPIKE.md`
- `docs/validation/MIMO_PROVIDER_SPIKE_STATUS.md`
- `docs/validation/evidence/` 中的脱敏历史证据
