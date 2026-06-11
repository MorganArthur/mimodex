#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring_core::{Entry, Error as KeyringError};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const CREDENTIAL_SERVICE: &str = "com.morganarthur.mimodex";
const CREDENTIAL_USER: &str = "mimo-api-key";
const MIMODEX_MANAGED_API_KEY_ENV: &str = "MIMODEX_MANAGED_MIMO_API_KEY";
const MIMO_API_KEY_ENV: &str = "MIMO_API_KEY";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialStatus {
    configured: bool,
    source: &'static str,
    storage: &'static str,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    is_repository: bool,
    branch: Option<String>,
    head: Option<String>,
    dirty: bool,
    changed_files: usize,
    untracked_files: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    path: String,
    name: String,
    available: bool,
    git: GitStatus,
    last_opened_at: u64,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectStore {
    projects: Vec<ProjectSummary>,
    selected_project_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectState {
    projects: Vec<ProjectSummary>,
    selected_project_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineEntry {
    id: String,
    kind: String,
    title: String,
    content: String,
    status: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadRecord {
    id: String,
    project_id: String,
    project_path: String,
    title: String,
    model: String,
    sandbox: String,
    turn_status: String,
    timeline: Vec<TimelineEntry>,
    diff: String,
    created_at: u64,
    updated_at: u64,
    #[serde(default)]
    archived: bool,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyThreadStore {
    threads: Vec<ThreadRecord>,
    selected_thread_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadState {
    threads: Vec<ThreadRecord>,
    selected_thread_id: Option<String>,
}

#[tauri::command]
fn get_mimo_credential_status() -> Result<CredentialStatus, String> {
    if stored_api_key()?.is_some() {
        return Ok(CredentialStatus {
            configured: true,
            source: "windowsCredentialManager",
            storage: "Windows 凭据管理器",
        });
    }

    let environment_configured = environment_api_key().is_some();
    Ok(CredentialStatus {
        configured: environment_configured,
        source: if environment_configured {
            "environment"
        } else {
            "missing"
        },
        storage: "Windows 凭据管理器",
    })
}

#[tauri::command]
fn save_mimo_credential(api_key: String) -> Result<CredentialStatus, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("MiMo API Key 不能为空。".to_string());
    }
    if api_key.len() > 4096 {
        return Err("MiMo API Key 长度异常。".to_string());
    }

    credential_entry()?
        .set_password(api_key)
        .map_err(|_| credential_error("保存"))?;

    Ok(CredentialStatus {
        configured: true,
        source: "windowsCredentialManager",
        storage: "Windows 凭据管理器",
    })
}

#[tauri::command]
fn delete_mimo_credential() -> Result<CredentialStatus, String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(CredentialStatus {
            configured: false,
            source: "missing",
            storage: "Windows 凭据管理器",
        }),
        Err(_) => Err(credential_error("删除")),
    }
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<ProjectState, String> {
    let mut store = load_project_store(&app)?;
    for project in &mut store.projects {
        refresh_project_summary(project);
    }
    sort_projects(&mut store.projects);
    save_project_store(&app, &store)?;
    Ok(project_state(store))
}

#[tauri::command]
fn add_project(app: AppHandle, path: String) -> Result<ProjectState, String> {
    let path = normalize_project_path(&path)?;
    let mut store = load_project_store(&app)?;
    let id = project_id(&path);
    let now = unix_timestamp_ms();

    if let Some(project) = store.projects.iter_mut().find(|project| project.id == id) {
        project.last_opened_at = now;
        refresh_project_summary(project);
    } else {
        store.projects.push(inspect_project(&path, now));
    }
    store.selected_project_id = Some(id);
    sort_projects(&mut store.projects);
    save_project_store(&app, &store)?;
    Ok(project_state(store))
}

#[tauri::command]
fn select_project(app: AppHandle, project_id: String) -> Result<ProjectState, String> {
    let mut store = load_project_store(&app)?;
    let project = store
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "项目记录不存在。".to_string())?;
    project.last_opened_at = unix_timestamp_ms();
    refresh_project_summary(project);
    store.selected_project_id = Some(project_id);
    sort_projects(&mut store.projects);
    save_project_store(&app, &store)?;
    Ok(project_state(store))
}

#[tauri::command]
fn refresh_project(app: AppHandle, project_id: String) -> Result<ProjectState, String> {
    let mut store = load_project_store(&app)?;
    let project = store
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "项目记录不存在。".to_string())?;
    refresh_project_summary(project);
    sort_projects(&mut store.projects);
    save_project_store(&app, &store)?;
    Ok(project_state(store))
}

#[tauri::command]
fn list_threads(app: AppHandle) -> Result<ThreadState, String> {
    let mut connection = open_thread_database(&app)?;
    import_legacy_threads(&app, &mut connection)?;
    recover_interrupted_threads(&mut connection)?;
    load_thread_state(&connection)
}

#[tauri::command]
fn upsert_thread(app: AppHandle, thread: ThreadRecord) -> Result<ThreadState, String> {
    validate_thread(&thread)?;
    let mut connection = open_thread_database(&app)?;
    import_legacy_threads(&app, &mut connection)?;
    let transaction = connection
        .transaction()
        .map_err(|_| thread_database_error("开始写入事务"))?;
    record_thread_projection(&transaction, &thread, "threadProjectionRecorded")?;
    set_app_state(&transaction, "selectedThreadId", Some(&thread.id))?;
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交写入事务"))?;
    load_thread_state(&connection)
}

#[tauri::command]
fn select_thread(app: AppHandle, thread_id: Option<String>) -> Result<ThreadState, String> {
    let connection = open_thread_database(&app)?;
    if let Some(id) = &thread_id {
        let exists = connection
            .query_row(
                "SELECT 1 FROM threads WHERE id = ?1",
                [id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| thread_database_error("查询线程"))?
            .is_some();
        if !exists {
            return Err("线程记录不存在。".to_string());
        }
    }
    set_app_state(&connection, "selectedThreadId", thread_id.as_deref())?;
    load_thread_state(&connection)
}

#[tauri::command]
fn set_thread_archived(
    app: AppHandle,
    thread_id: String,
    archived: bool,
) -> Result<ThreadState, String> {
    let mut connection = open_thread_database(&app)?;
    let mut thread = load_thread(&connection, &thread_id)?
        .ok_or_else(|| "线程记录不存在。".to_string())?;
    thread.archived = archived;
    thread.updated_at = unix_timestamp_ms();
    let transaction = connection
        .transaction()
        .map_err(|_| thread_database_error("开始归档事务"))?;
    record_thread_projection(
        &transaction,
        &thread,
        if archived {
            "threadArchived"
        } else {
            "threadUnarchived"
        },
    )?;
    if archived && selected_thread_id(&transaction)?.as_deref() == Some(&thread_id) {
        set_app_state(&transaction, "selectedThreadId", None)?;
    }
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交归档事务"))?;
    load_thread_state(&connection)
}

#[tauri::command]
fn delete_thread(app: AppHandle, thread_id: String) -> Result<ThreadState, String> {
    let mut connection = open_thread_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|_| thread_database_error("开始删除事务"))?;
    transaction
        .execute("DELETE FROM thread_events WHERE thread_id = ?1", [&thread_id])
        .map_err(|_| thread_database_error("删除线程事件"))?;
    let deleted = transaction
        .execute("DELETE FROM threads WHERE id = ?1", [&thread_id])
        .map_err(|_| thread_database_error("删除线程投影"))?;
    if deleted == 0 {
        return Err("线程记录不存在。".to_string());
    }
    if selected_thread_id(&transaction)?.as_deref() == Some(&thread_id) {
        set_app_state(&transaction, "selectedThreadId", None)?;
    }
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交删除事务"))?;
    load_thread_state(&connection)
}

fn main() {
    let _ = initialize_credential_store();
    configure_runtime_credential();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            add_project,
            delete_thread,
            delete_mimo_credential,
            get_mimo_credential_status,
            list_projects,
            list_threads,
            refresh_project,
            save_mimo_credential,
            select_project,
            select_thread,
            set_thread_archived,
            upsert_thread
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Mimodex desktop application");
}

fn project_state(store: ProjectStore) -> ProjectState {
    ProjectState {
        projects: store.projects,
        selected_project_id: store.selected_project_id,
    }
}

fn project_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("projects.json"))
        .map_err(|_| "无法确定 Mimodex 应用数据目录。".to_string())
}

fn load_project_store(app: &AppHandle) -> Result<ProjectStore, String> {
    let path = project_store_path(app)?;
    if !path.exists() {
        return Ok(ProjectStore::default());
    }
    let contents = fs::read_to_string(path).map_err(|_| "无法读取项目记录。".to_string())?;
    serde_json::from_str(&contents).map_err(|_| "项目记录格式无效。".to_string())
}

fn save_project_store(app: &AppHandle, store: &ProjectStore) -> Result<(), String> {
    let path = project_store_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "项目记录路径无效。".to_string())?;
    fs::create_dir_all(directory).map_err(|_| "无法创建 Mimodex 应用数据目录。".to_string())?;
    let contents =
        serde_json::to_string_pretty(store).map_err(|_| "无法序列化项目记录。".to_string())?;
    fs::write(path, contents).map_err(|_| "无法保存项目记录。".to_string())
}

fn thread_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("threads.sqlite3"))
        .map_err(|_| "无法确定 Mimodex 应用数据目录。".to_string())
}

fn legacy_thread_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("threads.json"))
        .map_err(|_| "无法确定 Mimodex 应用数据目录。".to_string())
}

fn open_thread_database(app: &AppHandle) -> Result<Connection, String> {
    let path = thread_store_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "线程数据库路径无效。".to_string())?;
    fs::create_dir_all(directory).map_err(|_| "无法创建 Mimodex 应用数据目录。".to_string())?;
    let connection = Connection::open(path).map_err(|_| thread_database_error("打开"))?;
    migrate_thread_database(&connection)?;
    Ok(connection)
}

fn migrate_thread_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS thread_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                occurred_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_thread_events_thread
                ON thread_events(thread_id, sequence);
            CREATE TABLE IF NOT EXISTS threads (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                project_path TEXT NOT NULL,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                sandbox TEXT NOT NULL,
                turn_status TEXT NOT NULL,
                timeline_json TEXT NOT NULL,
                diff TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_threads_project_updated
                ON threads(project_id, archived, updated_at DESC);
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (1, unixepoch('subsec') * 1000);
            ",
        )
        .map_err(|_| thread_database_error("执行迁移"))?;
    Ok(())
}

fn import_legacy_threads(app: &AppHandle, connection: &mut Connection) -> Result<(), String> {
    if app_state(connection, "legacyThreadsJsonImported")?.as_deref() == Some("1") {
        return Ok(());
    }
    let path = legacy_thread_store_path(app)?;
    let legacy = if path.exists() {
        let contents = fs::read_to_string(path).map_err(|_| "无法读取旧线程记录。".to_string())?;
        serde_json::from_str::<LegacyThreadStore>(&contents)
            .map_err(|_| "旧线程记录格式无效。".to_string())?
    } else {
        LegacyThreadStore::default()
    };
    let transaction = connection
        .transaction()
        .map_err(|_| thread_database_error("开始导入事务"))?;
    for thread in legacy.threads {
        validate_thread(&thread)?;
        record_thread_projection(&transaction, &thread, "legacyThreadImported")?;
    }
    set_app_state(
        &transaction,
        "selectedThreadId",
        legacy.selected_thread_id.as_deref(),
    )?;
    set_app_state(&transaction, "legacyThreadsJsonImported", Some("1"))?;
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交导入事务"))
}

fn recover_interrupted_threads(connection: &mut Connection) -> Result<(), String> {
    let thread_ids = {
        let mut statement = connection
            .prepare("SELECT id FROM threads WHERE turn_status = 'inProgress'")
            .map_err(|_| thread_database_error("准备崩溃恢复查询"))?;
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| thread_database_error("查询待恢复线程"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| thread_database_error("读取待恢复线程"))?
    };
    if thread_ids.is_empty() {
        return Ok(());
    }
    let transaction = connection
        .transaction()
        .map_err(|_| thread_database_error("开始崩溃恢复事务"))?;
    for thread_id in thread_ids {
        let mut thread = load_thread(&transaction, &thread_id)?
            .ok_or_else(|| "线程记录不存在。".to_string())?;
        thread.turn_status = "interrupted".to_string();
        thread.updated_at = unix_timestamp_ms();
        record_thread_projection(&transaction, &thread, "threadInterruptedAfterRestart")?;
    }
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交崩溃恢复事务"))
}

fn record_thread_projection(
    transaction: &Transaction<'_>,
    thread: &ThreadRecord,
    event_type: &str,
) -> Result<(), String> {
    let stored_updated_at = transaction
        .query_row(
            "SELECT updated_at FROM threads WHERE id = ?1",
            [&thread.id],
            |row| row.get::<_, u64>(0),
        )
        .optional()
        .map_err(|_| thread_database_error("检查线程投影版本"))?;
    if stored_updated_at.is_some_and(|updated_at| updated_at > thread.updated_at) {
        return Ok(());
    }
    let payload =
        serde_json::to_string(thread).map_err(|_| "无法序列化线程事件。".to_string())?;
    let duplicate = transaction
        .query_row(
            "
            SELECT payload_json = ?2
            FROM thread_events
            WHERE thread_id = ?1 AND event_type = ?3
            ORDER BY sequence DESC
            LIMIT 1
            ",
            params![thread.id, payload, event_type],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|_| thread_database_error("检查重复线程事件"))?
        .unwrap_or(false);
    if !duplicate {
        transaction
            .execute(
                "
                INSERT INTO thread_events(thread_id, event_type, payload_json, occurred_at)
                VALUES (?1, ?2, ?3, ?4)
                ",
                params![thread.id, event_type, payload, unix_timestamp_ms()],
            )
            .map_err(|_| thread_database_error("追加线程事件"))?;
    }
    upsert_thread_projection(transaction, thread)
}

fn upsert_thread_projection(
    connection: &Connection,
    thread: &ThreadRecord,
) -> Result<(), String> {
    let timeline_json =
        serde_json::to_string(&thread.timeline).map_err(|_| "无法序列化线程时间线。".to_string())?;
    connection
        .execute(
            "
            INSERT INTO threads(
                id, project_id, project_path, title, model, sandbox, turn_status,
                timeline_json, diff, created_at, updated_at, archived
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                project_path = excluded.project_path,
                title = excluded.title,
                model = excluded.model,
                sandbox = excluded.sandbox,
                turn_status = excluded.turn_status,
                timeline_json = excluded.timeline_json,
                diff = excluded.diff,
                updated_at = excluded.updated_at,
                archived = excluded.archived
            ",
            params![
                thread.id,
                thread.project_id,
                thread.project_path,
                thread.title,
                thread.model,
                thread.sandbox,
                thread.turn_status,
                timeline_json,
                thread.diff,
                thread.created_at,
                thread.updated_at,
                thread.archived
            ],
        )
        .map_err(|_| thread_database_error("更新线程投影"))?;
    Ok(())
}

fn load_thread_state(connection: &Connection) -> Result<ThreadState, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, project_id, project_path, title, model, sandbox, turn_status,
                   timeline_json, diff, created_at, updated_at, archived
            FROM threads
            ORDER BY archived ASC, updated_at DESC
            ",
        )
        .map_err(|_| thread_database_error("准备线程列表查询"))?;
    let threads = statement
        .query_map([], thread_from_row)
        .map_err(|_| thread_database_error("查询线程列表"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| thread_database_error("读取线程列表"))?;
    Ok(ThreadState {
        threads,
        selected_thread_id: selected_thread_id(connection)?,
    })
}

fn load_thread(connection: &Connection, thread_id: &str) -> Result<Option<ThreadRecord>, String> {
    connection
        .query_row(
            "
            SELECT id, project_id, project_path, title, model, sandbox, turn_status,
                   timeline_json, diff, created_at, updated_at, archived
            FROM threads WHERE id = ?1
            ",
            [thread_id],
            thread_from_row,
        )
        .optional()
        .map_err(|_| thread_database_error("读取线程"))
}

fn thread_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadRecord> {
    let timeline_json: String = row.get(7)?;
    let timeline = serde_json::from_str(&timeline_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            7,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(ThreadRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_path: row.get(2)?,
        title: row.get(3)?,
        model: row.get(4)?,
        sandbox: row.get(5)?,
        turn_status: row.get(6)?,
        timeline,
        diff: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        archived: row.get(11)?,
    })
}

fn set_app_state(connection: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO app_state(key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )
        .map_err(|_| thread_database_error("更新应用状态"))?;
    Ok(())
}

fn app_state(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row("SELECT value FROM app_state WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|_| thread_database_error("读取应用状态"))
        .map(Option::flatten)
}

fn selected_thread_id(connection: &Connection) -> Result<Option<String>, String> {
    app_state(connection, "selectedThreadId")
}

fn thread_database_error(action: &str) -> String {
    format!("{action}线程 SQLite 数据库失败。")
}

fn validate_thread(thread: &ThreadRecord) -> Result<(), String> {
    if thread.id.trim().is_empty()
        || thread.project_id.trim().is_empty()
        || thread.project_path.trim().is_empty()
    {
        return Err("线程记录缺少必要字段。".to_string());
    }
    if thread.id.len() > 512
        || thread.project_id.len() > 32_768
        || thread.project_path.len() > 32_768
        || thread.title.len() > 1_024
        || thread.timeline.len() > 500
        || thread.diff.len() > 500_000
        || thread
            .timeline
            .iter()
            .any(|entry| entry.content.len() > 400_000)
    {
        return Err("线程记录超过本地投影限制。".to_string());
    }
    Ok(())
}

fn normalize_project_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path.trim());
    if !path.is_dir() {
        return Err("请选择存在的本地文件夹。".to_string());
    }
    dunce::canonicalize(path).map_err(|_| "无法解析所选项目路径。".to_string())
}

fn project_id(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn inspect_project(path: &Path, last_opened_at: u64) -> ProjectSummary {
    ProjectSummary {
        id: project_id(path),
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string()),
        available: true,
        git: inspect_git_status(path),
        last_opened_at,
    }
}

fn refresh_project_summary(project: &mut ProjectSummary) {
    let path = Path::new(&project.path);
    project.available = path.is_dir();
    project.git = if project.available {
        inspect_git_status(path)
    } else {
        empty_git_status()
    };
}

fn inspect_git_status(path: &Path) -> GitStatus {
    let Some(root) = run_git(path, &["rev-parse", "--show-toplevel"]) else {
        return empty_git_status();
    };
    if root.trim().is_empty() {
        return empty_git_status();
    }

    let branch = run_git(path, &["branch", "--show-current"]).filter(|value| !value.is_empty());
    let head = run_git(path, &["rev-parse", "--short", "HEAD"]).filter(|value| !value.is_empty());
    let status = run_git(
        path,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )
    .unwrap_or_default();
    let mut changed_files = 0;
    let mut untracked_files = 0;
    for line in status.lines().filter(|line| !line.trim().is_empty()) {
        if line.starts_with("??") {
            untracked_files += 1;
        } else {
            changed_files += 1;
        }
    }

    GitStatus {
        is_repository: true,
        branch,
        head,
        dirty: changed_files + untracked_files > 0,
        changed_files,
        untracked_files,
    }
}

fn empty_git_status() -> GitStatus {
    GitStatus {
        is_repository: false,
        branch: None,
        head: None,
        dirty: false,
        changed_files: 0,
        untracked_files: 0,
    }
}

fn run_git(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(path).args(args);
    hide_command_window(&mut command);
    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(windows)]
fn hide_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_command_window(_command: &mut Command) {}

fn sort_projects(projects: &mut [ProjectSummary]) {
    projects.sort_by(|left, right| right.last_opened_at.cmp(&left.last_opened_at));
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn configure_runtime_credential() {
    // This runs before Tauri starts worker threads. The Runtime sidecar inherits this variable.
    if let Ok(Some(api_key)) = stored_api_key() {
        unsafe {
            std::env::set_var(MIMO_API_KEY_ENV, api_key);
            std::env::set_var(MIMODEX_MANAGED_API_KEY_ENV, "1");
        }
        return;
    }

    if std::env::var_os(MIMODEX_MANAGED_API_KEY_ENV).is_some() {
        unsafe {
            std::env::remove_var(MIMO_API_KEY_ENV);
            std::env::remove_var(MIMODEX_MANAGED_API_KEY_ENV);
        }
    }
}

fn initialize_credential_store() -> Result<(), String> {
    let store =
        windows_native_keyring_store::Store::new().map_err(|_| credential_error("初始化"))?;
    keyring_core::set_default_store(store);
    Ok(())
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|_| credential_error("访问"))
}

fn stored_api_key() -> Result<Option<String>, String> {
    match credential_entry()?.get_password() {
        Ok(api_key) if !api_key.trim().is_empty() => Ok(Some(api_key)),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err(credential_error("读取")),
    }
}

fn environment_api_key() -> Option<String> {
    std::env::var(MIMO_API_KEY_ENV)
        .ok()
        .filter(|api_key| !api_key.trim().is_empty())
}

fn credential_error(action: &str) -> String {
    format!("{action} Windows 凭据管理器中的 MiMo API Key 失败。")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_events_are_append_only_and_projection_is_queryable() {
        let mut connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("migrate SQLite");
        let mut thread = fixture_thread();

        let transaction = connection.transaction().expect("begin transaction");
        record_thread_projection(&transaction, &thread, "threadProjectionRecorded")
            .expect("record first projection");
        record_thread_projection(&transaction, &thread, "threadProjectionRecorded")
            .expect("deduplicate identical projection");
        transaction.commit().expect("commit first transaction");

        thread.turn_status = "completed".to_string();
        thread.updated_at += 1;
        let transaction = connection.transaction().expect("begin second transaction");
        record_thread_projection(&transaction, &thread, "threadProjectionRecorded")
            .expect("record changed projection");
        transaction.commit().expect("commit second transaction");

        let event_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM thread_events", [], |row| row.get(0))
            .expect("count events");
        let stored = load_thread(&connection, &thread.id)
            .expect("load projection")
            .expect("thread exists");

        assert_eq!(event_count, 2);
        assert_eq!(stored.turn_status, "completed");
        assert_eq!(stored.timeline[0].content, "修复测试");
    }

    #[test]
    fn migration_is_idempotent() {
        let connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("first migration");
        migrate_thread_database(&connection).expect("second migration");

        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| row.get(0))
            .expect("count migrations");
        assert_eq!(migration_count, 1);
    }

    #[test]
    fn stale_projection_does_not_overwrite_newer_state_or_append_event() {
        let mut connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("migrate SQLite");
        let mut completed = fixture_thread();
        completed.turn_status = "completed".to_string();
        completed.updated_at = 2;

        let transaction = connection.transaction().expect("begin first transaction");
        record_thread_projection(&transaction, &completed, "threadProjectionRecorded")
            .expect("record completed projection");
        transaction.commit().expect("commit first transaction");

        let stale = fixture_thread();
        let transaction = connection.transaction().expect("begin stale transaction");
        record_thread_projection(&transaction, &stale, "threadProjectionRecorded")
            .expect("ignore stale projection");
        transaction.commit().expect("commit stale transaction");

        let event_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM thread_events", [], |row| row.get(0))
            .expect("count events");
        let stored = load_thread(&connection, &completed.id)
            .expect("load projection")
            .expect("thread exists");

        assert_eq!(event_count, 1);
        assert_eq!(stored.turn_status, "completed");
        assert_eq!(stored.updated_at, 2);
    }

    fn fixture_thread() -> ThreadRecord {
        ThreadRecord {
            id: "thread-test".to_string(),
            project_id: "project-test".to_string(),
            project_path: "D:\\project".to_string(),
            title: "修复测试".to_string(),
            model: "mimo-v2.5".to_string(),
            sandbox: "workspace-write".to_string(),
            turn_status: "inProgress".to_string(),
            timeline: vec![TimelineEntry {
                id: "user-1".to_string(),
                kind: "user".to_string(),
                title: "你".to_string(),
                content: "修复测试".to_string(),
                status: None,
            }],
            diff: String::new(),
            created_at: 1,
            updated_at: 1,
            archived: false,
        }
    }
}
