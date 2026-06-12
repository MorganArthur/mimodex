# SQLite 线程事件账本与查询投影

- 状态：Runtime 原始事件账本版正在等待 Windows Preview 权威构建
- 最后更新：2026-06-12
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
| `thread_events` | 只追加线程投影、生命周期事件与 Runtime 原始协议事件 |
| `threads` | 按项目和更新时间查询的当前线程投影 |
| `app_state` | 当前选中线程与迁移状态 |

写入顺序为：在同一个 SQLite 事务中先追加事件，再更新查询投影，最后提交。连续
完全相同的同类型事件会被去重；晚到的过期投影会被忽略，不能覆盖较新的状态或追加
倒序事件。

Schema v2 为 Runtime 原始协议事件增加全局唯一 `event_id`。每条事件保存连接内顺序、
方向、消息类型、方法、请求 ID、线程 ID 和未经桌面投影压缩的原始 JSON-RPC 消息。
事件按产生顺序短时间批量提交；重复 `event_id` 会被 SQLite 唯一索引忽略。

## 3. 事件类型

当前写入的事件包括：

- `legacyThreadImported`：从旧 `threads.json` 首次导入；
- `threadProjectionRecorded`：桌面线程投影更新；
- `threadInterruptedAfterRestart`：启动时将未完成线程标记为已中断；
- `threadArchived`：Runtime 与本地投影完成归档；
- `threadUnarchived`：Runtime 与本地投影恢复归档。
- `runtimeProtocolEvent`：线程相关的 Runtime 双向 JSON-RPC 请求、响应和通知。

执行中的流式投影合并为最多每秒一次写入，完成、失败、中断和空闲等终态立即写入。
投影内容继续遵守条目、单条内容和 Diff 大小上限。

Runtime 原始事件不执行 UI 内容截断。单条事件限制为 `2 MB`，单批最多 `1000` 条；
桌面端通常按最多 `100` 条或 `100 ms` 聚合后串行提交。`thread/start` 获得线程 ID
之前的事件会暂存，响应返回线程 ID 后按原顺序写入。后台归档等响应会继承对应请求的
线程上下文，不依赖当前正在查看的线程。

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

SQLite `thread_events` 当前记录桌面投影快照、生命周期事件，以及线程相关的 Runtime
双向原始请求、响应与通知。应用启动时会清空 `threads` 查询表，再按账本顺序重放投影
快照事件，随后执行未完成轮次的崩溃恢复，因此查询投影可以从只追加账本再生。

当前投影重建仍使用账本中的桌面投影快照事件，尚未实现仅依靠 Runtime 原始事件的完整
语义 reducer；恢复 Provider 上下文仍以 Runtime 自有线程存储为权威。

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
- [x] Runtime 双向原始 JSON-RPC 事件具备严格连接内顺序；
- [x] 原始事件按线程关联、批量写入并通过唯一事件 ID 去重；
- [x] 查询投影在启动时从只追加账本重建；
- [ ] Windows CI 执行 Schema v2、原始事件和投影重建 Rust 单测并通过；
- [ ] Windows 11 安装后完成 JSON 迁移、归档与恢复验收。
