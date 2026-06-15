# 本地线程索引与恢复实现说明

- 状态：可恢复线程、SQLite 事件账本、归档与活动审计已通过 Windows Preview
- 最后更新：2026-06-15
- 对应目录：`apps/desktop/src/threads.ts`、`packages/desktop-core/src/session-controller.ts`
- 架构依据：`docs/architecture/decisions/ADR-0005-local-thread-persistence.md`
- 首次原始事件账本权威构建：[Windows Preview #27385722233](https://github.com/MorganArthur/mimodex/actions/runs/27385722233)

## 1. 本阶段目标

本阶段将侧栏中的演示线程替换为真实本地线程索引。用户创建任务后，Mimodex 保存
Runtime 线程 ID 与桌面 UI 投影；应用重启后可以按项目查看线程，并通过
`thread/resume` 恢复 Runtime 的权威上下文后继续对话。

## 2. 数据职责

Runtime 仍是 Agent 上下文和 Provider 历史的权威来源。早期 `threads.json` 已由
`threads.sqlite3`、只追加事件账本和查询投影替换，用于：

- 按项目展示最近线程；
- 保存标题、模型、权限模式、状态和更新时间；
- 按创建时间形成固定列表顺序，切换和内容更新不会移动已有线程；
- 恢复用户、助手、推理、命令、文件与错误的桌面时间线及可用的开始、完成时间；
- 恢复最近 Diff 展示；
- 保存 Runtime 线程 ID，并在用户选择后调用 `thread/resume`。

API Key 永不写入线程索引。线程内容可能包含用户代码、命令输出和推理内容，因此
只保存在本机应用数据目录，不进入日志、遥测或项目目录。

## 3. 恢复流程

1. 应用启动后加载项目列表与 SQLite 线程投影；
2. 上次仍为 `inProgress` 的投影被标记为 `interrupted`，不自动重试任何工具；
3. 侧栏只展示当前项目绑定的线程；
4. 用户选择历史线程；
5. 桌面会话控制器调用 Runtime `thread/resume`；
6. Runtime 恢复成功后，界面展示本地 UI 投影；
7. 后续指令继续使用同一个 Runtime 线程 ID。

项目切换和“新建线程”会清空当前 UI 投影，但不会删除历史线程记录。

## 4. 投影限制

为避免流式输出导致本地索引无限增长，每个线程投影限制为：

- 最近 `500` 条时间线条目；
- 每条内容最近 `30,000` 个 JavaScript 字符；
- 最近 `100,000` 个 Diff 字符；
- 标题由首条用户消息压缩生成，最多 `60` 个字符。

这些限制只作用于桌面 UI 投影，不改变 Runtime 的权威线程记录。

## 5. 与 ADR-0005 的关系

当前实现已建立 ADR-0005 的 SQLite 查询投影、只追加桌面事件账本和线程相关 Runtime
双向原始协议事件记录。启动时会从账本重建查询投影；恢复仍依赖 Runtime 自身持久化的
权威线程，SQLite 桌面投影不得被用于 Provider 上下文重放。

后续持久化加固仍需实现：

- 实现只依赖 Runtime 原始事件的完整桌面投影语义 reducer；
- 保留策略和真正的 Runtime 永久删除能力；
- 副作用不确定状态的明确恢复与人工处置；
- 长线程压缩，同时保留 MiMo 协议要求字段。

## 6. 验收清单

- [x] 创建任务后生成真实最近线程；
- [x] 最近线程按项目筛选，并按创建时间保持固定顺序；
- [x] 点击历史线程调用 Runtime `thread/resume`；
- [x] 恢复后继续指令复用原 Runtime 线程；
- [x] 新建线程和切换项目清空旧 UI 投影；
- [x] 启动时将未完成投影标记为已中断；
- [x] SQLite Schema 迁移、事件去重、归档、恢复归档与本地索引移除；
- [x] 恢复历史线程后展示持久化 Runtime 活动审计；
- [x] React 与桌面会话测试通过；
- [x] Tauri Rust 后端格式检查与编译通过；
- [ ] Windows 11 安装后完成创建、重启、恢复与继续对话验收。

当前权威构建见：[Mimodex 当前项目状态](../CURRENT_STATUS.md)。
