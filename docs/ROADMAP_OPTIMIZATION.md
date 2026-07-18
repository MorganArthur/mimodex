# Mimodex 后续优化路线图

- 状态：基于 v0.3.4 Windows 版本评估的系统性优化方案
- 版本：0.3
- 最后更新：2026-07-18
- 当前版本：v0.3.4
- 目标版本：v0.4.0 稳定版 → v0.5.0 公测版
- 首要平台：Windows 11 x64，预留 macOS 架构空间

---

## 1. 概述

本文档基于对 Mimodex v0.3.4 的全面评估，针对当前存在的核心不足，提出系统性的优化设计方案。

v0.3.4 相比 v0.1.7 已实现显著功能扩展：
- **自动化任务**：前端调度器（setInterval 30s 轮询）+ Rust 后端 CRUD + SQLite 持久化，支持 manual/hourly/daily/weekly
- **插件系统**：5 种 Webhook 插件（企业微信、飞书、钉钉、微信通知、通用 Webhook），支持测试和状态追踪
- **集成终端**：基于 Tauri shell API 的嵌入式 PowerShell 终端
- **分支切换**：Git 分支列表查看与切换

但仍存在以下核心待优化项：

---

## 2. 当前不足与对应优化策略

### 2.1 自动化任务调度器架构待升级

**现状分析**：
- 前端已实现完整的自动化配置 UI 和手动触发
- Rust 后端已实现 automations 表的 CRUD 和 automation_runs 记录
- **当前调度方式为前端 `setInterval(runDueAutomations, 30_000)` 轮询**，非理想架构
- 无 Rust 后端真实调度引擎，应用关闭期间无法触发自动化
- 无执行历史查询界面，无失败重试机制
- 无桌面通知能力

**优化方案**：

#### 2.1.1 迁移至 Rust 后端调度器

将调度逻辑从 React 前端迁移至 Rust 后端：

```rust
// src-tauri/src/automation/scheduler.rs
pub struct AutomationScheduler {
    db: Connection,
    active_timers: HashMap<String, JoinHandle<()>>,
}

impl AutomationScheduler {
    /// 应用启动时从 SQLite 恢复所有启用的自动化定时器
    pub async fn resume_from_db(&mut self) -> Result<()>;
    
    /// 计算下次执行时间（hourly/daily/weekly）
    fn compute_next_run(cadence: &str, time_of_day: &str, day_of_week: Option<i64>, from: i64) -> i64;
    
    /// 创建/更新/删除自动化时重新调度
    pub async fn reschedule(&mut self, automation_id: &str) -> Result<()>;
    
    /// 定时器触发后的执行逻辑
    async fn on_timer_trigger(&self, automation_id: String);
}
```

**调度策略**：

| 频率类型 | 当前实现 | 目标实现 | 精度 |
|---------|---------|---------|------|
| `manual` | 前端手动触发 | 保持不变 | - |
| `hourly` | 前端 30s 轮询 | Rust `tokio::time::sleep` 一次性定时器 | ±1 分钟 |
| `daily` | 前端 30s 轮询 | Rust 一次性定时器 | ±1 分钟 |
| `weekly` | 前端 30s 轮询 | Rust 一次性定时器 | ±1 分钟 |

**关键改进**：
- 应用启动时 Rust 恢复所有定时器
- 应用退出前取消待执行定时器（已触发的执行不受影响）
- 执行超时：单次自动化任务最长运行 30 分钟，超时标记为 `interrupted`
- 连续 3 次失败后自动禁用该自动化，并记录最后错误

#### 2.1.2 执行历史与通知

- 新增自动化执行历史查询界面（最近 20 次）
- 使用 Tauri notification API 实现失败桌面通知
- 自动化列表页显示下次执行时间倒计时

#### 2.1.3 验收标准

- [ ] 创建 hourly/daily/weekly 自动化后，Rust 后端在指定时间自动触发
- [ ] 重启应用后，未执行的自动化仍按时触发
- [ ] 手动触发可立即执行，不影响原定调度
- [ ] 连续 3 次失败后自动禁用
- [ ] 执行记录可查询，包含 thread_id 便于追溯
- [ ] 自动化执行使用独立的线程，不干扰用户当前对话

---

### 2.2 私测验收仍未完成

**现状分析**：
- `WINDOWS_11_PRIVATE_BETA_ACCEPTANCE.md` 已更新至 v0.3.4，但验收项仍未实际执行
- 验收依赖真实 Windows 11 设备，目前仅在 CI 环境验证
- 缺乏系统化的验收执行流程和缺陷追踪机制

**优化方案**：

#### 2.2.1 双轨验收机制

```
轨道 A：自动化冒烟测试（CI 执行）
├── 安装包下载与 SHA256 校验
├── 静默安装 / 卸载（使用 NSIS /S 参数）
├── 启动后进程存活检查
├── Runtime sidecar 初始化握手
└── 退出码检查

轨道 B：人工验收清单（真实设备执行）
├── 按章节分配给不同验收人
├── 每章配备屏幕录制和日志收集
├── 缺陷记录到 GitHub Issues（标签：private-beta-blocker）
└── 修复后重新验收并更新清单
```

#### 2.2.2 验收标准

- [ ] 轨道 A 自动化冒烟测试通过率达到 100%
- [ ] 轨道 B 人工验收清单所有 P0 项勾选完成
- [ ] 无 open 状态的 `private-beta-blocker` 标签 Issue
- [ ] 验收报告由至少 2 人签字确认

---

### 2.3 测试覆盖不足

**现状分析**：
- 约 20 个测试文件，全部为单元/集成测试，无 E2E 测试
- Rust 侧无测试（`glob **/*.test.rs` 返回空）
- 缺乏真实 MiMo API 的常态化集成测试
- 凭据脱敏、权限边界等安全测试缺失

**优化方案**：

#### 2.3.1 测试金字塔

```
        /\
       /  \
      / E2E \      Playwright + 真实 Tauri 应用（5%）
     /─────────\
    /  Integration \  Runtime 客户端 + Provider Mock（15%）
   /─────────────────\
  /    Unit Tests      \  TypeScript + Rust 单元测试（80%）
 /─────────────────────────\
```

#### 2.3.2 Rust 单元测试

为 Tauri 后端新增 Rust 测试：

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_next_run_at_hourly() { /* ... */ }
    
    #[test]
    fn test_automation_persistence_roundtrip() { /* ... */ }
    
    #[test]
    fn test_credential_redaction_in_logs() { /* ... */ }
}
```

#### 2.3.3 覆盖率门槛

| 层级 | 目标覆盖率 | 检查方式 |
|-----|-----------|---------|
| TypeScript 单元测试 | ≥ 80% | `vitest --coverage` |
| Rust 单元测试 | ≥ 70% | `cargo tarpaulin` |
| E2E 测试 | 关键用户旅程 | Playwright 报告 |

---

### 2.4 平台局限

**现状分析**：
- 仅支持 Windows 11 x64
- 安装包未代码签名，触发 SmartScreen
- macOS 支持尚未开始

**优化方案**：

#### 2.4.1 Windows 代码签名

推荐 Azure Trusted Signing（微软官方推荐，与 GitHub Actions 集成好）。

#### 2.4.2 macOS 架构准备

```
src-tauri/src/platform/
├── mod.rs          // 平台无关接口
├── windows.rs      // Windows 实现
└── macos.rs        // macOS 实现
```

---

### 2.5 P1 功能补全

**现状分析**：
- 集成终端（P1-2）已在 v0.3.4 实现基础版本
- 线程重命名、Git 暂存/提交、撤销 Agent 改动等仍未实现

**优化方案**：

| 优先级 | 功能 | 状态 |
|-------|------|------|
| P1-1 | 撤销选定 Agent 改动 | 未实现 |
| P1-2 | 集成终端 | v0.3.4 基础版本已实现，待增强 |
| P1-3 | Git 暂存与提交 | 未实现 |
| P1-4 | 线程重命名与置顶 | 未实现 |
| P1-5 | 非敏感设置导入导出 | 未实现 |
| P1-6 | 长上下文压缩 | 未实现 |

---

## 3. 实施路线图

### Phase 1：v0.3.5（4-6 周）

**目标**：Rust 调度器落地 + 私测验收启动

| 周 | 任务 | 产出 |
|---|------|------|
| 1-2 | Rust 自动化调度器实现 | scheduler.rs + 定时器管理 |
| 2-3 | 执行历史查询 + 失败通知 | UI 增强 + Tauri notification |
| 3-4 | Rust 单元测试补齐 | ≥ 50 个 Rust 测试 |
| 4-5 | 启动 Windows 11 人工验收 | 验收报告 + blocker issues |
| 5-6 | 修复 blocker 缺陷 | 修复 PR + 回归测试 |

**准入标准**：
- Rust 调度器替代前端轮询
- 自动化任务 hourly/daily/weekly 全部可运行
- 验收清单 P0 项无 blocker

---

### Phase 2：v0.4.0（6-8 周）

**目标**：稳定私测版

| 周 | 任务 | 产出 |
|---|------|------|
| 1-2 | E2E 测试框架搭建 | Playwright + Tauri 驱动 |
| 2-3 | E2E 核心流程覆盖 | 5 个核心用户旅程 |
| 3-4 | 安全测试专项 | 凭据脱敏 + 权限边界测试 |
| 4-5 | Windows 代码签名 | 签名 Release 流程 |
| 5-6 | 撤销 Agent 改动 | revertAgentEdit 完整实现 |
| 6-7 | Git 暂存/提交 | 暂存、提交、丢弃 |
| 7-8 | 发布 v0.4.0 | 签名稳定私测版 |

**准入标准**：
- E2E 测试通过
- 安装包已签名
- 连续 7 天无崩溃报告

---

### Phase 3：v0.5.0（8-10 周）

**目标**：公测版

| 周 | 任务 | 产出 |
|---|------|------|
| 1-2 | 线程重命名/置顶 | UI + 持久化 |
| 2-3 | 集成终端增强 | PTY 终端 + 多标签 |
| 3-4 | 长上下文压缩 | Runtime 上下文压缩策略 |
| 4-5 | 非敏感设置导入导出 | 设置模块扩展 |
| 5-6 | macOS 平台抽象层 | 跨平台接口 + macOS 实现 |
| 6-7 | macOS CI 建立 | macOS Preview 工作流 |
| 7-8 | 发布 v0.5.0 | 跨平台公测版 |

**准入标准**：
- P1 功能全部可用
- macOS 可编译
- 用户反馈任务完成率 ≥ 60%

---

## 4. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| Windows 验收发现大量 blocker | Phase 1 延期 | 提前启动验收，每周同步；预留 2 周缓冲 |
| Azure Trusted Signing 申请延迟 | Phase 2 延期 | 同步申请 OV 证书作为备选 |
| macOS 开发无设备 | Phase 3 延期 | 使用 GitHub Actions macOS runner 远程验证 |
| 长上下文压缩影响质量 | Phase 3 质量风险 | A/B 测试对比压缩前后的任务完成率 |

---

## 5. 成功指标

| 指标 | v0.3.5 目标 | v0.4.0 目标 | v0.5.0 目标 |
|-----|------------|------------|------------|
| Rust 调度器替代前端轮询 | 是 | - | - |
| 私测验收通过率 | 100% P0 | - | - |
| 测试覆盖率（TS） | ≥ 80% | ≥ 85% | ≥ 90% |
| 测试覆盖率（Rust） | ≥ 50% | ≥ 70% | ≥ 80% |
| E2E 测试通过率 | - | 100% | 100% |
| 安装包签名 | - | 是 | 是 |
| 崩溃率 | < 1% | < 0.5% | < 0.1% |
| 用户任务完成率 | - | ≥ 60% | ≥ 70% |

---

## 6. 附录

### A. 新增/修改文件清单

```
apps/desktop/src-tauri/src/
  automation/
    mod.rs                         # 新增：调度器核心
    scheduler.rs                   # 新增：定时器管理
    tests.rs                       # 新增：单元测试
  main.rs                          # 修改：注册调度器
```

### B. 数据库 Schema（已存在，无需迁移）

v0.3.4 已包含以下表：

```sql
-- automations 表（已存在）
-- automation_runs 表（已存在）
-- plugins 表（已存在）
```
