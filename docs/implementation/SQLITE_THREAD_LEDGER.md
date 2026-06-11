# SQLite 线程事件账本与查询投影

- 状态：首个 SQLite 账本切片已通过 Windows Preview 权威构建
- 最后更新：2026-06-11
- 对应目录：`apps/desktop/src-tauri/src/main.rs`
- 架构依据：`docs/architecture/decisions/ADR-0005-local-thread-persistence.md`

## 1. 本阶段目标

本阶段将 `threads.json` 替换为具备 Schema 迁移、事务写入和查询索引的 SQLite
线程存储，并建立只追加事件账本。桌面端仍通过 Runtime `thread/resume` 恢复
Provider 权威上下文；SQLite 账本记录 Mimodex 桌面投影与生命周期审计。

## 2. 数据库结构

数据库位于 Mimodex 应用数据目录的 `threads.sqlite3`，启用：

- SQLite bundled 构建，不依赖用户系统预装 SQLite；
- `WAL` 日志模式；
- `synchronous = FULL`；
- 外键检查；
- 幂等 Schema 迁移。

首个 Schema 包含：

| 表 | 职责 |
| --- | --- |
| `schema_migrations` | 记录已应用 Schema 版本 |
| `thread_events` | 只追加线程投影与生命周期事件 |
| `threads` | 按项目和更新时间查询的当前线程投影 |
| `app_state` | 当前选中线程与迁移状态 |

写入顺序为：在同一个 SQLite 事务中先追加事件，再更新查询投影，最后提交。连续
完全相同的同类型事件会被去重；晚到的过期投影会被忽略，不能覆盖较新的状态或追加
倒序事件。

## 3. 事件类型

当前写入的事件包括：

- `legacyThreadImported`：从旧 `threads.json` 首次导入；
- `threadProjectionRecorded`：桌面线程投影更新；
- `threadInterruptedAfterRestart`：启动时将未完成线程标记为已中断；
- `threadArchived`：Runtime 与本地投影完成归档；
- `threadUnarchived`：Runtime 与本地投影恢复归档。

执行中的流式投影合并为最多每秒一次写入，完成、失败、中断和空闲等终态立即写入。
投影内容继续遵守条目、单条内容和 Diff 大小上限。

## 4. 旧数据迁移

首次打开 SQLite 数据库时：

1. 检查 `legacyThreadsJsonImported` 迁移标记；
2. 如果旧 `threads.json` 存在，则在单个事务中导入所有线程；
3. 每条线程生成 `legacyThreadImported` 事件与当前投影；
4. 保存原选中线程 ID；
5. 写入迁移标记，后续启动不重复导入。

旧 JSON 文件不会自动删除，便于技术预览阶段回退和人工核验。

## 5. 归档与删除边界

- 归档和恢复归档会先调用 Runtime `thread/archive` 或 `thread/unarchive`，成功后再更新
  Mimodex SQLite；
- “移除本地索引”会删除 Mimodex 的该线程事件账本与查询投影；
- Runtime 当前没有线程删除 API，因此移除本地索引不会清除 Runtime 归档历史；
- 产品界面不得将“移除本地索引”描述为永久删除权威线程。

## 6. 当前权威边界

SQLite `thread_events` 当前记录桌面投影快照和生命周期事件，尚未直接接收全部 Runtime
原始通知、审批请求与响应。因此它已经是 Mimodex 桌面投影的只追加审计来源，但还
不是可独立重放 Provider 上下文的完整事实账本。

下一阶段需要把有序 Runtime 事件直接写入账本，并从事件重建桌面投影；在此之前，
恢复 Agent 上下文仍以 Runtime 自有线程存储为权威。

## 7. 验收清单

- [x] SQLite Schema 迁移幂等；
- [x] 事件追加与投影更新处于同一事务；
- [x] 连续相同事件去重；
- [x] 过期投影不会覆盖较新状态或追加倒序事件；
- [x] 旧 `threads.json` 自动导入一次；
- [x] 未完成线程启动时追加中断恢复事件；
- [x] 归档与恢复归档联动 Runtime 权威线程；
- [x] 本地索引移除明确保留 Runtime 归档历史；
- [x] React、桌面会话和 Runtime 客户端测试通过；
- [x] Windows CI 执行 Tauri Rust SQLite 单测并通过；
- [ ] Windows 11 安装后完成 JSON 迁移、归档与恢复验收。
