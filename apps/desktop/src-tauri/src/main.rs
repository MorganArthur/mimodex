#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring_core::{Entry, Error as KeyringError};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const CREDENTIAL_SERVICE: &str = "com.morganarthur.mimodex";
const CREDENTIAL_USER: &str = "mimo-api-key";
const MIMODEX_MANAGED_API_KEY_ENV: &str = "MIMODEX_MANAGED_MIMO_API_KEY";
const MIMO_API_KEY_ENV: &str = "MIMO_API_KEY";
const MIMO_BASE_URL_ENV: &str = "MIMO_BASE_URL";
const DEFAULT_MIMO_BASE_URL: &str = "https://api.xiaomimimo.com/v1";
const MAX_PROJECT_DIFF_CHARS: usize = 500_000;
const MAX_UNTRACKED_DIFF_FILES: usize = 100;
static BACKGROUND_PERSISTENCE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialStatus {
    configured: bool,
    source: &'static str,
    storage: &'static str,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    api_base_url: String,
    default_model: String,
    default_sandbox: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionDiagnostic {
    ok: bool,
    category: &'static str,
    message: String,
    detail: String,
    latency_ms: Option<u64>,
    status_code: Option<u16>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_base_url: DEFAULT_MIMO_BASE_URL.to_string(),
            default_model: "mimo-v2.5".to_string(),
            default_sandbox: "workspace-write".to_string(),
        }
    }
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
    #[serde(default)]
    staged_files: usize,
    #[serde(default)]
    unstaged_files: usize,
    #[serde(default)]
    additions: usize,
    #[serde(default)]
    deletions: usize,
    #[serde(default)]
    diff: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    path: String,
    name: String,
    available: bool,
    git: GitStatus,
    last_opened_at: i64,
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
struct ImageAttachment {
    id: String,
    name: String,
    mime_type: String,
    size_bytes: i64,
    data_url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineEntry {
    id: String,
    kind: String,
    title: String,
    content: String,
    status: Option<String>,
    #[serde(default)]
    started_at: Option<i64>,
    #[serde(default)]
    completed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    images: Option<Vec<ImageAttachment>>,
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
    #[serde(default)]
    token_usage: Option<TokenUsage>,
    diff: String,
    created_at: i64,
    updated_at: i64,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    unread: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenUsage {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
    context_window: Option<i64>,
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEventRecord {
    event_id: String,
    thread_id: String,
    protocol: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadActivityEvent {
    event_id: String,
    thread_id: String,
    protocol: serde_json::Value,
    occurred_at: i64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationRecord {
    id: String,
    project_id: String,
    title: String,
    prompt: String,
    enabled: bool,
    cadence: String,
    time_of_day: String,
    day_of_week: Option<i64>,
    model: String,
    sandbox: String,
    next_run_at: Option<i64>,
    last_run_at: Option<i64>,
    last_completed_at: Option<i64>,
    last_status: String,
    last_error: Option<String>,
    last_thread_id: Option<String>,
    run_count: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationDraft {
    project_id: String,
    title: String,
    prompt: String,
    enabled: bool,
    cadence: String,
    time_of_day: String,
    day_of_week: Option<i64>,
    model: String,
    sandbox: String,
    next_run_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationRunRecord {
    automation_id: String,
    status: String,
    last_run_at: i64,
    completed_at: Option<i64>,
    next_run_at: Option<i64>,
    thread_id: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationState {
    automations: Vec<AutomationRecord>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginRecord {
    id: String,
    kind: String,
    name: String,
    webhook_url: String,
    secret: Option<String>,
    enabled: bool,
    last_test_status: String,
    last_tested_at: Option<i64>,
    last_error: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginDraft {
    kind: String,
    name: String,
    webhook_url: String,
    secret: Option<String>,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginState {
    plugins: Vec<PluginRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginTestResult {
    ok: bool,
    status_code: Option<u16>,
    latency_ms: Option<u64>,
    message: String,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginTestResponse {
    result: PluginTestResult,
    state: PluginState,
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
fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_app_settings(&app)
}

#[tauri::command]
fn save_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let settings = validate_app_settings(settings)?;
    save_app_settings_file(&app, &settings)?;
    configure_runtime_base_url(&settings.api_base_url);
    Ok(settings)
}

#[tauri::command]
async fn diagnose_mimo_connection(
    api_key: Option<String>,
    api_base_url: String,
    model: String,
) -> ConnectionDiagnostic {
    let settings = match validate_app_settings(AppSettings {
        api_base_url,
        default_model: model,
        default_sandbox: "workspace-write".to_string(),
    }) {
        Ok(settings) => settings,
        Err(message) => {
            return diagnostic_failure("endpoint", "端点配置无效", &message, None, None);
        }
    };
    let api_key = api_key
        .filter(|value| !value.trim().is_empty())
        .or_else(|| stored_api_key().ok().flatten())
        .or_else(environment_api_key);
    let Some(api_key) = api_key else {
        return diagnostic_failure(
            "missingCredential",
            "缺少 MiMo API Key",
            "请先输入或保存 MiMo API Key。",
            None,
            None,
        );
    };
    let endpoint = format!("{}/chat/completions", settings.api_base_url);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return diagnostic_failure(
                "network",
                "无法初始化网络诊断",
                "系统网络客户端初始化失败。",
                None,
                None,
            );
        }
    };
    let started = std::time::Instant::now();
    let response = client
        .post(endpoint)
        .header("api-key", api_key.trim())
        .json(&serde_json::json!({
            "model": settings.default_model,
            "messages": [{ "role": "user", "content": "Reply with OK." }],
            "stream": false,
            "max_completion_tokens": 32
        }))
        .send()
        .await;
    let latency_ms = Some(started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    match response {
        Ok(response) if response.status().is_success() => ConnectionDiagnostic {
            ok: true,
            category: "success",
            message: "连接成功".to_string(),
            detail: format!("{} 已响应最小诊断请求。", settings.default_model),
            latency_ms,
            status_code: Some(response.status().as_u16()),
        },
        Ok(response) => {
            let status = response.status().as_u16();
            let (category, message, detail) = diagnostic_http_failure(status);
            diagnostic_failure(category, message, detail, latency_ms, Some(status))
        }
        Err(error) if error.is_timeout() => diagnostic_failure(
            "timeout",
            "连接超时",
            "端点在 20 秒内没有完成诊断请求，请检查网络、代理或服务状态。",
            latency_ms,
            None,
        ),
        Err(error) if error.is_connect() => diagnostic_failure(
            "network",
            "无法连接端点",
            "请检查 API Base URL、网络、DNS、代理或防火墙设置。",
            latency_ms,
            None,
        ),
        Err(_) => diagnostic_failure(
            "provider",
            "诊断请求失败",
            "端点返回了无法完成的网络响应。",
            latency_ms,
            None,
        ),
    }
}

#[tauri::command]
async fn list_projects(app: AppHandle) -> Result<ProjectState, String> {
    run_background(move || {
        let mut store = load_project_store(&app)?;
        for project in &mut store.projects {
            refresh_project_summary(project);
        }
        save_project_store(&app, &store)?;
        Ok(project_state(store))
    })
    .await
}

#[tauri::command]
async fn add_project(app: AppHandle, path: String) -> Result<ProjectState, String> {
    run_background(move || {
        let path = normalize_project_path(&path)?;
        let mut store = load_project_store(&app)?;
        let id = project_id(&path);

        if let Some(project) = store.projects.iter_mut().find(|project| project.id == id) {
            refresh_project_summary(project);
        } else {
            store
                .projects
                .insert(0, inspect_project(&path, unix_timestamp_ms()));
        }
        store.selected_project_id = Some(id);
        save_project_store(&app, &store)?;
        Ok(project_state(store))
    })
    .await
}

#[tauri::command]
async fn select_project(app: AppHandle, project_id: String) -> Result<ProjectState, String> {
    run_background(move || {
        let mut store = load_project_store(&app)?;
        if !store
            .projects
            .iter()
            .any(|project| project.id == project_id)
        {
            return Err("项目记录不存在。".to_string());
        }
        store.selected_project_id = Some(project_id);
        save_project_store(&app, &store)?;
        Ok(project_state(store))
    })
    .await
}

#[tauri::command]
async fn refresh_project(app: AppHandle, project_id: String) -> Result<ProjectState, String> {
    run_background(move || {
        let mut store = load_project_store(&app)?;
        let project = store
            .projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "项目记录不存在。".to_string())?;
        refresh_project_summary(project);
        save_project_store(&app, &store)?;
        Ok(project_state(store))
    })
    .await
}

#[tauri::command]
async fn list_project_branches(app: AppHandle, project_id: String) -> Result<Vec<String>, String> {
    run_background(move || {
        let store = load_project_store(&app)?;
        let project = store
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "项目记录不存在。".to_string())?;
        if !project.available {
            return Err("项目文件夹当前不可访问。".to_string());
        }
        if !project.git.is_repository {
            return Err("项目尚未检测到 Git 仓库。".to_string());
        }
        Ok(list_git_branches(Path::new(&project.path)))
    })
    .await
}

#[tauri::command]
async fn switch_project_branch(
    app: AppHandle,
    project_id: String,
    branch: String,
) -> Result<ProjectState, String> {
    run_background(move || {
        let branch = branch.trim().to_string();
        if branch.is_empty() || branch.len() > 256 {
            return Err("分支名无效。".to_string());
        }
        let mut store = load_project_store(&app)?;
        let project = store
            .projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "项目记录不存在。".to_string())?;
        if !project.available {
            return Err("项目文件夹当前不可访问。".to_string());
        }
        if !project.git.is_repository {
            return Err("项目尚未检测到 Git 仓库。".to_string());
        }
        switch_git_branch(Path::new(&project.path), &branch)?;
        refresh_project_summary(project);
        save_project_store(&app, &store)?;
        Ok(project_state(store))
    })
    .await
}

#[tauri::command]
async fn list_threads(app: AppHandle) -> Result<ThreadState, String> {
    run_background(move || {
        let mut connection = open_thread_database(&app)?;
        import_legacy_threads(&app, &mut connection)?;
        rebuild_thread_projections(&mut connection)?;
        recover_interrupted_threads(&mut connection)?;
        load_thread_state(&connection)
    })
    .await
}

#[tauri::command]
async fn list_thread_activity(
    app: AppHandle,
    thread_id: String,
) -> Result<Vec<ThreadActivityEvent>, String> {
    run_background(move || {
        if thread_id.is_empty() || thread_id.len() > 512 {
            return Err("线程标识无效。".to_string());
        }
        let connection = open_thread_database(&app)?;
        load_thread_activity(&connection, &thread_id)
    })
    .await
}

#[tauri::command]
async fn append_runtime_events(
    app: AppHandle,
    events: Vec<RuntimeEventRecord>,
) -> Result<(), String> {
    run_background(move || {
        if events.len() > 1_000 {
            return Err("单批 Runtime 原始事件数量超出限制。".to_string());
        }
        let mut connection = open_thread_database(&app)?;
        let transaction = connection
            .transaction()
            .map_err(|_| thread_database_error("开始 Runtime 事件事务"))?;
        append_runtime_events_to_connection(&transaction, &events)?;
        transaction
            .commit()
            .map_err(|_| thread_database_error("提交 Runtime 事件事务"))
    })
    .await
}

#[tauri::command]
async fn upsert_thread(
    app: AppHandle,
    thread: ThreadRecord,
    select: Option<bool>,
) -> Result<ThreadState, String> {
    run_background(move || {
        validate_thread(&thread)?;
        let mut connection = open_thread_database(&app)?;
        import_legacy_threads(&app, &mut connection)?;
        let transaction = connection
            .transaction()
            .map_err(|_| thread_database_error("开始写入事务"))?;
        record_thread_projection(&transaction, &thread, "threadProjectionRecorded")?;
        if select.unwrap_or(true) {
            set_app_state(&transaction, "selectedThreadId", Some(&thread.id))?;
        }
        transaction
            .commit()
            .map_err(|_| thread_database_error("提交写入事务"))?;
        load_thread_state(&connection)
    })
    .await
}

#[tauri::command]
async fn select_thread(app: AppHandle, thread_id: Option<String>) -> Result<ThreadState, String> {
    run_background(move || {
        let connection = open_thread_database(&app)?;
        if let Some(id) = &thread_id {
            let exists = connection
                .query_row("SELECT 1 FROM threads WHERE id = ?1", [id], |_| Ok(()))
                .optional()
                .map_err(|_| thread_database_error("查询线程"))?
                .is_some();
            if !exists {
                return Err("线程记录不存在。".to_string());
            }
        }
        set_app_state(&connection, "selectedThreadId", thread_id.as_deref())?;
        load_thread_state(&connection)
    })
    .await
}

#[tauri::command]
async fn set_thread_archived(
    app: AppHandle,
    thread_id: String,
    archived: bool,
) -> Result<ThreadState, String> {
    run_background(move || {
        let mut connection = open_thread_database(&app)?;
        let mut thread =
            load_thread(&connection, &thread_id)?.ok_or_else(|| "线程记录不存在。".to_string())?;
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
    })
    .await
}

#[tauri::command]
async fn delete_thread(app: AppHandle, thread_id: String) -> Result<ThreadState, String> {
    run_background(move || {
        let mut connection = open_thread_database(&app)?;
        let transaction = connection
            .transaction()
            .map_err(|_| thread_database_error("开始删除事务"))?;
        transaction
            .execute(
                "DELETE FROM thread_events WHERE thread_id = ?1",
                [&thread_id],
            )
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
    })
    .await
}

#[tauri::command]
async fn list_automations(app: AppHandle) -> Result<AutomationState, String> {
    run_background(move || {
        let connection = open_thread_database(&app)?;
        load_automation_state(&connection)
    })
    .await
}

#[tauri::command]
async fn create_automation(
    app: AppHandle,
    automation: AutomationDraft,
) -> Result<AutomationState, String> {
    run_background(move || {
        validate_automation_draft(&automation)?;
        let connection = open_thread_database(&app)?;
        let now = unix_timestamp_ms();
        let record = AutomationRecord {
            id: automation_id(),
            project_id: automation.project_id,
            title: automation.title,
            prompt: automation.prompt,
            enabled: automation.enabled,
            cadence: automation.cadence,
            time_of_day: automation.time_of_day,
            day_of_week: automation.day_of_week,
            model: automation.model,
            sandbox: automation.sandbox,
            next_run_at: automation.next_run_at,
            last_run_at: None,
            last_completed_at: None,
            last_status: "idle".to_string(),
            last_error: None,
            last_thread_id: None,
            run_count: 0,
            created_at: now,
            updated_at: now,
        };
        upsert_automation(&connection, &record)?;
        load_automation_state(&connection)
    })
    .await
}

#[tauri::command]
async fn update_automation(
    app: AppHandle,
    automation_id: String,
    automation: AutomationDraft,
) -> Result<AutomationState, String> {
    run_background(move || {
        validate_automation_draft(&automation)?;
        let connection = open_thread_database(&app)?;
        let mut record = load_automation(&connection, &automation_id)?
            .ok_or_else(|| "自动化任务不存在。".to_string())?;
        record.project_id = automation.project_id;
        record.title = automation.title;
        record.prompt = automation.prompt;
        record.enabled = automation.enabled;
        record.cadence = automation.cadence;
        record.time_of_day = automation.time_of_day;
        record.day_of_week = automation.day_of_week;
        record.model = automation.model;
        record.sandbox = automation.sandbox;
        record.next_run_at = automation.next_run_at;
        record.updated_at = unix_timestamp_ms();
        upsert_automation(&connection, &record)?;
        load_automation_state(&connection)
    })
    .await
}

#[tauri::command]
async fn delete_automation(
    app: AppHandle,
    automation_id: String,
) -> Result<AutomationState, String> {
    run_background(move || {
        let connection = open_thread_database(&app)?;
        let deleted = connection
            .execute("DELETE FROM automations WHERE id = ?1", [&automation_id])
            .map_err(|_| thread_database_error("删除自动化任务"))?;
        if deleted == 0 {
            return Err("自动化任务不存在。".to_string());
        }
        load_automation_state(&connection)
    })
    .await
}

#[tauri::command]
async fn record_automation_run(
    app: AppHandle,
    run: AutomationRunRecord,
) -> Result<AutomationState, String> {
    run_background(move || {
        validate_automation_run(&run)?;
        let connection = open_thread_database(&app)?;
        let terminal = run.status != "running";
        let updated = connection
            .execute(
                "
                UPDATE automations
                SET last_run_at = ?2,
                    last_completed_at = ?3,
                    last_status = ?4,
                    last_error = ?5,
                    last_thread_id = ?6,
                    next_run_at = ?7,
                    run_count = run_count + ?8,
                    updated_at = ?9
                WHERE id = ?1
                ",
                params![
                    run.automation_id,
                    run.last_run_at,
                    run.completed_at,
                    run.status,
                    run.error,
                    run.thread_id,
                    run.next_run_at,
                    if terminal { 1 } else { 0 },
                    unix_timestamp_ms()
                ],
            )
            .map_err(|_| thread_database_error("记录自动化运行"))?;
        if updated == 0 {
            return Err("自动化任务不存在。".to_string());
        }
        load_automation_state(&connection)
    })
    .await
}

#[tauri::command]
async fn list_plugins(app: AppHandle) -> Result<PluginState, String> {
    run_background(move || {
        let connection = open_thread_database(&app)?;
        load_plugin_state(&connection)
    })
    .await
}

#[tauri::command]
async fn create_plugin(app: AppHandle, plugin: PluginDraft) -> Result<PluginState, String> {
    run_background(move || {
        validate_plugin_draft(&plugin)?;
        let connection = open_thread_database(&app)?;
        let now = unix_timestamp_ms();
        let record = PluginRecord {
            id: plugin_id(),
            kind: plugin.kind,
            name: plugin.name,
            webhook_url: plugin.webhook_url,
            secret: plugin.secret,
            enabled: plugin.enabled,
            last_test_status: "idle".to_string(),
            last_tested_at: None,
            last_error: None,
            created_at: now,
            updated_at: now,
        };
        upsert_plugin(&connection, &record)?;
        load_plugin_state(&connection)
    })
    .await
}

#[tauri::command]
async fn update_plugin(
    app: AppHandle,
    plugin_id: String,
    plugin: PluginDraft,
) -> Result<PluginState, String> {
    run_background(move || {
        validate_plugin_draft(&plugin)?;
        let connection = open_thread_database(&app)?;
        let mut record =
            load_plugin(&connection, &plugin_id)?.ok_or_else(|| "插件不存在。".to_string())?;
        record.kind = plugin.kind;
        record.name = plugin.name;
        record.webhook_url = plugin.webhook_url;
        record.secret = plugin.secret;
        record.enabled = plugin.enabled;
        record.updated_at = unix_timestamp_ms();
        upsert_plugin(&connection, &record)?;
        load_plugin_state(&connection)
    })
    .await
}

#[tauri::command]
async fn delete_plugin(app: AppHandle, plugin_id: String) -> Result<PluginState, String> {
    run_background(move || {
        let connection = open_thread_database(&app)?;
        let deleted = connection
            .execute("DELETE FROM plugins WHERE id = ?1", [&plugin_id])
            .map_err(|_| thread_database_error("删除插件"))?;
        if deleted == 0 {
            return Err("插件不存在。".to_string());
        }
        load_plugin_state(&connection)
    })
    .await
}

#[tauri::command]
async fn test_plugin(
    app: AppHandle,
    plugin_id: String,
    content: String,
) -> Result<PluginTestResponse, String> {
    let record = {
        let app = app.clone();
        let plugin_id = plugin_id.clone();
        run_background(move || {
            let connection = open_thread_database(&app)?;
            load_plugin(&connection, &plugin_id)?.ok_or_else(|| "插件不存在。".to_string())
        })
        .await?
    };
    let payload = content
        .trim()
        .is_empty()
        .then(|| "Mimodex 插件测试消息".to_string())
        .unwrap_or_else(|| content.trim().to_string());
    let result = send_plugin_webhook(&record, &payload).await;
    let now = unix_timestamp_ms();
    let last_test_status = if result.ok { "ok" } else { "failed" };
    let last_error = if result.ok {
        None
    } else {
        Some(result.detail.clone())
    };
    let state = run_background(move || {
        let connection = open_thread_database(&app)?;
        connection
            .execute(
                "
                UPDATE plugins
                SET last_test_status = ?2,
                    last_tested_at = ?3,
                    last_error = ?4,
                    updated_at = ?5
                WHERE id = ?1
                ",
                params![plugin_id, last_test_status, now, last_error, now],
            )
            .map_err(|_| thread_database_error("更新插件状态"))?;
        load_plugin_state(&connection)
    })
    .await?;
    Ok(PluginTestResponse { result, state })
}

async fn run_background<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = BACKGROUND_PERSISTENCE_LOCK
            .lock()
            .map_err(|_| "后台持久化锁异常。".to_string())?;
        task()
    })
    .await
    .map_err(|_| "后台任务异常终止。".to_string())?
}

fn main() {
    let _ = initialize_credential_store();
    configure_runtime_credential();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            configure_runtime_settings(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_project,
            append_runtime_events,
            create_automation,
            create_plugin,
            delete_automation,
            delete_plugin,
            delete_thread,
            delete_mimo_credential,
            diagnose_mimo_connection,
            get_app_settings,
            get_mimo_credential_status,
            list_automations,
            list_project_branches,
            list_plugins,
            list_projects,
            list_thread_activity,
            list_threads,
            record_automation_run,
            refresh_project,
            save_app_settings,
            save_mimo_credential,
            select_project,
            select_thread,
            set_thread_archived,
            switch_project_branch,
            test_plugin,
            update_automation,
            update_plugin,
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

fn app_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|_| "无法确定 Mimodex 应用数据目录。".to_string())
}

fn load_app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = app_settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let contents = fs::read_to_string(path).map_err(|_| "无法读取应用设置。".to_string())?;
    let settings = serde_json::from_str(&contents).map_err(|_| "应用设置格式无效。".to_string())?;
    validate_app_settings(settings)
}

fn save_app_settings_file(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = app_settings_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "应用设置路径无效。".to_string())?;
    fs::create_dir_all(directory).map_err(|_| "无法创建 Mimodex 应用数据目录。".to_string())?;
    let contents =
        serde_json::to_string_pretty(settings).map_err(|_| "无法序列化应用设置。".to_string())?;
    fs::write(path, contents).map_err(|_| "无法保存应用设置。".to_string())
}

fn validate_app_settings(mut settings: AppSettings) -> Result<AppSettings, String> {
    settings.api_base_url = settings
        .api_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    let authority = settings
        .api_base_url
        .strip_prefix("https://")
        .or_else(|| settings.api_base_url.strip_prefix("http://"))
        .unwrap_or_default()
        .split('/')
        .next()
        .unwrap_or_default();
    if settings.api_base_url.is_empty()
        || settings.api_base_url.len() > 2048
        || (!settings.api_base_url.starts_with("https://")
            && !settings.api_base_url.starts_with("http://"))
        || settings.api_base_url.chars().any(char::is_whitespace)
        || settings.api_base_url.contains('?')
        || settings.api_base_url.contains('#')
        || authority.is_empty()
        || authority.contains('@')
    {
        return Err("API Base URL 必须是有效的 HTTP 或 HTTPS 基础地址。".to_string());
    }
    if settings.default_model != "mimo-v2.5" && settings.default_model != "mimo-v2.5-pro" {
        return Err("默认模型无效。".to_string());
    }
    if settings.default_sandbox != "read-only"
        && settings.default_sandbox != "workspace-write"
        && settings.default_sandbox != "danger-full-access"
    {
        return Err("默认权限模式无效。".to_string());
    }
    Ok(settings)
}

fn diagnostic_http_failure(status: u16) -> (&'static str, &'static str, &'static str) {
    match status {
        401 | 403 => (
            "authentication",
            "认证失败",
            "API Key 无效、已失效，或没有访问所选模型的权限。",
        ),
        404 => (
            "endpoint",
            "端点不可用",
            "没有找到 Chat Completions 路径，请检查 API Base URL。",
        ),
        408 | 504 => (
            "timeout",
            "Provider 响应超时",
            "端点已连接，但没有及时完成诊断请求。",
        ),
        429 => (
            "rateLimit",
            "请求受到限流",
            "凭据或端点已响应，但当前额度或请求频率受限。",
        ),
        400 | 422 => (
            "model",
            "模型或请求不受支持",
            "请确认所选模型可用于当前端点，并兼容 MiMo Chat Completions 请求。",
        ),
        500..=599 => (
            "provider",
            "Provider 服务异常",
            "端点已响应，但服务当前不可用，请稍后重试。",
        ),
        _ => (
            "provider",
            "Provider 拒绝诊断请求",
            "端点返回了非成功状态，请检查服务配置。",
        ),
    }
}

fn diagnostic_failure(
    category: &'static str,
    message: &str,
    detail: &str,
    latency_ms: Option<u64>,
    status_code: Option<u16>,
) -> ConnectionDiagnostic {
    ConnectionDiagnostic {
        ok: false,
        category,
        message: message.to_string(),
        detail: detail.to_string(),
        latency_ms,
        status_code,
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
            PRAGMA busy_timeout = 5000;
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
                occurred_at INTEGER NOT NULL,
                event_id TEXT
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
                token_usage_json TEXT,
                diff TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                unread INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_threads_project_updated
                ON threads(project_id, archived, updated_at DESC);
            CREATE TABLE IF NOT EXISTS automations (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                prompt TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                cadence TEXT NOT NULL,
                time_of_day TEXT NOT NULL,
                day_of_week INTEGER,
                model TEXT NOT NULL,
                sandbox TEXT NOT NULL,
                next_run_at INTEGER,
                last_run_at INTEGER,
                last_completed_at INTEGER,
                last_status TEXT NOT NULL,
                last_error TEXT,
                last_thread_id TEXT,
                run_count INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_automations_next_run
                ON automations(enabled, next_run_at);
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (1, unixepoch('subsec') * 1000);
            ",
        )
        .map_err(|_| thread_database_error("执行迁移"))?;
    if !table_has_column(connection, "thread_events", "event_id")? {
        connection
            .execute("ALTER TABLE thread_events ADD COLUMN event_id TEXT", [])
            .map_err(|_| thread_database_error("迁移 Runtime 事件标识"))?;
    }
    connection
        .execute_batch(
            "
            CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_events_event_id
                ON thread_events(event_id) WHERE event_id IS NOT NULL;
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (2, unixepoch('subsec') * 1000);
            ",
        )
        .map_err(|_| thread_database_error("执行 Runtime 事件迁移"))?;
    if !table_has_column(connection, "threads", "unread")? {
        connection
            .execute(
                "ALTER TABLE threads ADD COLUMN unread INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|_| thread_database_error("迁移线程未读状态"))?;
    }
    if !table_has_column(connection, "threads", "token_usage_json")? {
        connection
            .execute("ALTER TABLE threads ADD COLUMN token_usage_json TEXT", [])
            .map_err(|_| thread_database_error("迁移线程 Token 统计"))?;
    }
    connection
        .execute_batch(
            "
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (3, unixepoch('subsec') * 1000);
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (4, unixepoch('subsec') * 1000);
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (5, unixepoch('subsec') * 1000);
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                webhook_url TEXT NOT NULL,
                secret TEXT,
                enabled INTEGER NOT NULL,
                last_test_status TEXT NOT NULL,
                last_tested_at INTEGER,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_plugins_enabled
                ON plugins(enabled, kind);
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (6, unixepoch('subsec') * 1000);
            ",
        )
        .map_err(|_| thread_database_error("执行本地数据库迁移"))?;
    Ok(())
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|_| thread_database_error("检查 Schema 列"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| thread_database_error("查询 Schema 列"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| thread_database_error("读取 Schema 列"))?;
    Ok(columns.iter().any(|candidate| candidate == column))
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
        let mut thread =
            load_thread(&transaction, &thread_id)?.ok_or_else(|| "线程记录不存在。".to_string())?;
        thread.turn_status = "interrupted".to_string();
        thread.updated_at = unix_timestamp_ms();
        record_thread_projection(&transaction, &thread, "threadInterruptedAfterRestart")?;
    }
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交崩溃恢复事务"))
}

fn rebuild_thread_projections(connection: &mut Connection) -> Result<(), String> {
    let payloads = {
        let mut statement = connection
            .prepare(
                "
                SELECT payload_json
                FROM thread_events
                WHERE event_type IN (
                    'legacyThreadImported',
                    'threadProjectionRecorded',
                    'threadInterruptedAfterRestart',
                    'threadArchived',
                    'threadUnarchived'
                )
                ORDER BY sequence ASC
                ",
            )
            .map_err(|_| thread_database_error("准备投影重建查询"))?;
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| thread_database_error("查询投影事件"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| thread_database_error("读取投影事件"))?
    };
    let transaction = connection
        .transaction()
        .map_err(|_| thread_database_error("开始投影重建事务"))?;
    transaction
        .execute("DELETE FROM threads", [])
        .map_err(|_| thread_database_error("清空线程投影"))?;
    for payload in payloads {
        let thread = serde_json::from_str::<ThreadRecord>(&payload)
            .map_err(|_| "线程投影事件格式无效。".to_string())?;
        validate_thread(&thread)?;
        upsert_thread_projection(&transaction, &thread)?;
    }
    transaction
        .commit()
        .map_err(|_| thread_database_error("提交投影重建事务"))
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
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|_| thread_database_error("检查线程投影版本"))?;
    if stored_updated_at.is_some_and(|updated_at| updated_at > thread.updated_at) {
        return Ok(());
    }
    let payload = serde_json::to_string(thread).map_err(|_| "无法序列化线程事件。".to_string())?;
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

fn append_runtime_events_to_connection(
    connection: &Connection,
    events: &[RuntimeEventRecord],
) -> Result<(), String> {
    for event in events {
        validate_runtime_event(event)?;
        let payload = serde_json::to_string(event)
            .map_err(|_| "无法序列化 Runtime 原始事件。".to_string())?;
        connection
            .execute(
                "
                INSERT OR IGNORE INTO thread_events(
                    thread_id, event_type, payload_json, occurred_at, event_id
                )
                VALUES (?1, 'runtimeProtocolEvent', ?2, ?3, ?4)
                ",
                params![
                    event.thread_id,
                    payload,
                    unix_timestamp_ms(),
                    event.event_id
                ],
            )
            .map_err(|_| thread_database_error("追加 Runtime 原始事件"))?;
    }
    Ok(())
}

fn load_thread_activity(
    connection: &Connection,
    thread_id: &str,
) -> Result<Vec<ThreadActivityEvent>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT payload_json, occurred_at
            FROM thread_events
            WHERE thread_id = ?1 AND event_type = 'runtimeProtocolEvent'
            ORDER BY sequence DESC
            LIMIT 300
            ",
        )
        .map_err(|_| thread_database_error("准备活动记录查询"))?;
    let records = statement
        .query_map([thread_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|_| thread_database_error("查询活动记录"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| thread_database_error("读取活动记录"))?;
    records
        .into_iter()
        .map(|(payload, occurred_at)| {
            let event = serde_json::from_str::<RuntimeEventRecord>(&payload)
                .map_err(|_| "Runtime 活动记录格式无效。".to_string())?;
            Ok(ThreadActivityEvent {
                event_id: event.event_id,
                thread_id: event.thread_id,
                protocol: event.protocol,
                occurred_at,
            })
        })
        .collect()
}

fn upsert_thread_projection(connection: &Connection, thread: &ThreadRecord) -> Result<(), String> {
    let timeline_json = serde_json::to_string(&thread.timeline)
        .map_err(|_| "无法序列化线程时间线。".to_string())?;
    let token_usage_json = match &thread.token_usage {
        Some(token_usage) => Some(
            serde_json::to_string(token_usage)
                .map_err(|_| "无法序列化 Token 统计。".to_string())?,
        ),
        None => None,
    };
    connection
        .execute(
            "
            INSERT INTO threads(
                id, project_id, project_path, title, model, sandbox, turn_status,
                timeline_json, token_usage_json, diff, created_at, updated_at, archived, unread
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                project_path = excluded.project_path,
                title = excluded.title,
                model = excluded.model,
                sandbox = excluded.sandbox,
                turn_status = excluded.turn_status,
                timeline_json = excluded.timeline_json,
                token_usage_json = excluded.token_usage_json,
                diff = excluded.diff,
                updated_at = excluded.updated_at,
                archived = excluded.archived,
                unread = excluded.unread
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
                token_usage_json,
                thread.diff,
                thread.created_at,
                thread.updated_at,
                thread.archived,
                thread.unread
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
                   timeline_json, token_usage_json, diff, created_at, updated_at, archived, unread
            FROM threads
            ORDER BY archived ASC, created_at DESC, id ASC
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
                   timeline_json, token_usage_json, diff, created_at, updated_at, archived, unread
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
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let token_usage_json: Option<String> = row.get(8)?;
    let token_usage = token_usage_json
        .as_deref()
        .map(|payload| {
            serde_json::from_str(payload).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()?;
    Ok(ThreadRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_path: row.get(2)?,
        title: row.get(3)?,
        model: row.get(4)?,
        sandbox: row.get(5)?,
        turn_status: row.get(6)?,
        timeline,
        token_usage,
        diff: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        archived: row.get(12)?,
        unread: row.get(13)?,
    })
}

fn load_automation_state(connection: &Connection) -> Result<AutomationState, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, project_id, title, prompt, enabled, cadence, time_of_day,
                   day_of_week, model, sandbox, next_run_at, last_run_at,
                   last_completed_at, last_status, last_error, last_thread_id,
                   run_count, created_at, updated_at
            FROM automations
            ORDER BY created_at DESC, id ASC
            ",
        )
        .map_err(|_| thread_database_error("准备自动化列表查询"))?;
    let automations = statement
        .query_map([], automation_from_row)
        .map_err(|_| thread_database_error("查询自动化列表"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| thread_database_error("读取自动化列表"))?;
    Ok(AutomationState { automations })
}

fn load_automation(
    connection: &Connection,
    automation_id: &str,
) -> Result<Option<AutomationRecord>, String> {
    connection
        .query_row(
            "
            SELECT id, project_id, title, prompt, enabled, cadence, time_of_day,
                   day_of_week, model, sandbox, next_run_at, last_run_at,
                   last_completed_at, last_status, last_error, last_thread_id,
                   run_count, created_at, updated_at
            FROM automations WHERE id = ?1
            ",
            [automation_id],
            automation_from_row,
        )
        .optional()
        .map_err(|_| thread_database_error("读取自动化任务"))
}

fn upsert_automation(connection: &Connection, automation: &AutomationRecord) -> Result<(), String> {
    validate_automation_record(automation)?;
    connection
        .execute(
            "
            INSERT INTO automations(
                id, project_id, title, prompt, enabled, cadence, time_of_day,
                day_of_week, model, sandbox, next_run_at, last_run_at,
                last_completed_at, last_status, last_error, last_thread_id,
                run_count, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                title = excluded.title,
                prompt = excluded.prompt,
                enabled = excluded.enabled,
                cadence = excluded.cadence,
                time_of_day = excluded.time_of_day,
                day_of_week = excluded.day_of_week,
                model = excluded.model,
                sandbox = excluded.sandbox,
                next_run_at = excluded.next_run_at,
                last_run_at = excluded.last_run_at,
                last_completed_at = excluded.last_completed_at,
                last_status = excluded.last_status,
                last_error = excluded.last_error,
                last_thread_id = excluded.last_thread_id,
                run_count = excluded.run_count,
                updated_at = excluded.updated_at
            ",
            params![
                automation.id,
                automation.project_id,
                automation.title,
                automation.prompt,
                automation.enabled,
                automation.cadence,
                automation.time_of_day,
                automation.day_of_week,
                automation.model,
                automation.sandbox,
                automation.next_run_at,
                automation.last_run_at,
                automation.last_completed_at,
                automation.last_status,
                automation.last_error,
                automation.last_thread_id,
                automation.run_count,
                automation.created_at,
                automation.updated_at
            ],
        )
        .map_err(|_| thread_database_error("更新自动化任务"))?;
    Ok(())
}

fn automation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRecord> {
    Ok(AutomationRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        enabled: row.get(4)?,
        cadence: row.get(5)?,
        time_of_day: row.get(6)?,
        day_of_week: row.get(7)?,
        model: row.get(8)?,
        sandbox: row.get(9)?,
        next_run_at: row.get(10)?,
        last_run_at: row.get(11)?,
        last_completed_at: row.get(12)?,
        last_status: row.get(13)?,
        last_error: row.get(14)?,
        last_thread_id: row.get(15)?,
        run_count: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

fn load_plugin_state(connection: &Connection) -> Result<PluginState, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, kind, name, webhook_url, secret, enabled,
                   last_test_status, last_tested_at, last_error,
                   created_at, updated_at
            FROM plugins
            ORDER BY created_at DESC, id ASC
            ",
        )
        .map_err(|_| thread_database_error("准备插件列表查询"))?;
    let plugins = statement
        .query_map([], plugin_from_row)
        .map_err(|_| thread_database_error("查询插件列表"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| thread_database_error("读取插件列表"))?;
    Ok(PluginState { plugins })
}

fn load_plugin(connection: &Connection, plugin_id: &str) -> Result<Option<PluginRecord>, String> {
    connection
        .query_row(
            "
            SELECT id, kind, name, webhook_url, secret, enabled,
                   last_test_status, last_tested_at, last_error,
                   created_at, updated_at
            FROM plugins WHERE id = ?1
            ",
            [plugin_id],
            plugin_from_row,
        )
        .optional()
        .map_err(|_| thread_database_error("读取插件"))
}

fn upsert_plugin(connection: &Connection, plugin: &PluginRecord) -> Result<(), String> {
    validate_plugin_record(plugin)?;
    connection
        .execute(
            "
            INSERT INTO plugins(
                id, kind, name, webhook_url, secret, enabled,
                last_test_status, last_tested_at, last_error,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                name = excluded.name,
                webhook_url = excluded.webhook_url,
                secret = excluded.secret,
                enabled = excluded.enabled,
                last_test_status = excluded.last_test_status,
                last_tested_at = excluded.last_tested_at,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
            ",
            params![
                plugin.id,
                plugin.kind,
                plugin.name,
                plugin.webhook_url,
                plugin.secret,
                plugin.enabled,
                plugin.last_test_status,
                plugin.last_tested_at,
                plugin.last_error,
                plugin.created_at,
                plugin.updated_at
            ],
        )
        .map_err(|_| thread_database_error("更新插件"))?;
    Ok(())
}

fn plugin_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PluginRecord> {
    Ok(PluginRecord {
        id: row.get(0)?,
        kind: row.get(1)?,
        name: row.get(2)?,
        webhook_url: row.get(3)?,
        secret: row.get(4)?,
        enabled: row.get(5)?,
        last_test_status: row.get(6)?,
        last_tested_at: row.get(7)?,
        last_error: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
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

fn validate_runtime_event(event: &RuntimeEventRecord) -> Result<(), String> {
    if event.event_id.trim().is_empty() || event.thread_id.trim().is_empty() {
        return Err("Runtime 原始事件缺少必要字段。".to_string());
    }
    let payload_size = serde_json::to_vec(&event.protocol)
        .map_err(|_| "Runtime 原始事件格式无效。".to_string())?
        .len();
    if event.event_id.len() > 512 || event.thread_id.len() > 512 || payload_size > 2_000_000 {
        return Err("Runtime 原始事件超出本地存储限制。".to_string());
    }
    Ok(())
}

fn validate_automation_draft(automation: &AutomationDraft) -> Result<(), String> {
    validate_automation_fields(
        &automation.project_id,
        &automation.title,
        &automation.prompt,
        &automation.cadence,
        &automation.time_of_day,
        automation.day_of_week,
        &automation.model,
        &automation.sandbox,
    )
}

fn validate_automation_record(automation: &AutomationRecord) -> Result<(), String> {
    if automation.id.trim().is_empty() || automation.id.len() > 512 {
        return Err("自动化任务标识无效。".to_string());
    }
    validate_automation_fields(
        &automation.project_id,
        &automation.title,
        &automation.prompt,
        &automation.cadence,
        &automation.time_of_day,
        automation.day_of_week,
        &automation.model,
        &automation.sandbox,
    )?;
    if !automation_run_status(&automation.last_status) {
        return Err("自动化任务运行状态无效。".to_string());
    }
    Ok(())
}

fn validate_automation_run(run: &AutomationRunRecord) -> Result<(), String> {
    if run.automation_id.trim().is_empty() || run.automation_id.len() > 512 {
        return Err("自动化任务标识无效。".to_string());
    }
    if !automation_run_status(&run.status) {
        return Err("自动化任务运行状态无效。".to_string());
    }
    if run.error.as_ref().is_some_and(|error| error.len() > 8_192) {
        return Err("自动化运行错误信息过长。".to_string());
    }
    Ok(())
}

fn validate_automation_fields(
    project_id: &str,
    title: &str,
    prompt: &str,
    cadence: &str,
    time_of_day: &str,
    day_of_week: Option<i64>,
    model: &str,
    sandbox: &str,
) -> Result<(), String> {
    if project_id.trim().is_empty() || title.trim().is_empty() || prompt.trim().is_empty() {
        return Err("自动化任务缺少必要字段。".to_string());
    }
    if project_id.len() > 32_768 || title.len() > 1_024 || prompt.len() > 200_000 {
        return Err("自动化任务超过本地存储限制。".to_string());
    }
    if !matches!(cadence, "manual" | "hourly" | "daily" | "weekly") {
        return Err("自动化任务频率无效。".to_string());
    }
    if !valid_time_of_day(time_of_day) {
        return Err("自动化任务时间无效。".to_string());
    }
    if cadence == "weekly" && !day_of_week.is_some_and(|day| (1..=7).contains(&day)) {
        return Err("自动化任务星期无效。".to_string());
    }
    if !matches!(model, "mimo-v2.5" | "mimo-v2.5-pro") {
        return Err("自动化任务模型无效。".to_string());
    }
    if !matches!(
        sandbox,
        "danger-full-access" | "read-only" | "workspace-write"
    ) {
        return Err("自动化任务权限无效。".to_string());
    }
    Ok(())
}

fn automation_run_status(status: &str) -> bool {
    matches!(
        status,
        "idle" | "running" | "completed" | "failed" | "interrupted"
    )
}

fn validate_plugin_draft(plugin: &PluginDraft) -> Result<(), String> {
    validate_plugin_fields(
        &plugin.kind,
        &plugin.name,
        &plugin.webhook_url,
        &plugin.secret,
    )
}

fn validate_plugin_record(plugin: &PluginRecord) -> Result<(), String> {
    if plugin.id.trim().is_empty() || plugin.id.len() > 512 {
        return Err("插件标识无效。".to_string());
    }
    if !plugin_test_status(&plugin.last_test_status) {
        return Err("插件测试状态无效。".to_string());
    }
    validate_plugin_fields(
        &plugin.kind,
        &plugin.name,
        &plugin.webhook_url,
        &plugin.secret,
    )
}

fn validate_plugin_fields(
    kind: &str,
    name: &str,
    webhook_url: &str,
    secret: &Option<String>,
) -> Result<(), String> {
    if !plugin_kind_valid(kind) {
        return Err("插件类型无效。".to_string());
    }
    if name.trim().is_empty() || name.len() > 256 {
        return Err("插件名称无效。".to_string());
    }
    let url = webhook_url.trim();
    if url.is_empty() || url.len() > 4096 {
        return Err("插件 Webhook URL 无效。".to_string());
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("插件 Webhook URL 必须使用 HTTP 或 HTTPS。".to_string());
    }
    if url.chars().any(char::is_whitespace) {
        return Err("插件 Webhook URL 不能包含空白字符。".to_string());
    }
    if secret.as_ref().is_some_and(|value| value.len() > 1024) {
        return Err("插件密钥过长。".to_string());
    }
    Ok(())
}

fn plugin_kind_valid(kind: &str) -> bool {
    matches!(kind, "wecom" | "feishu" | "dingtalk" | "wechat" | "webhook")
}

fn plugin_test_status(status: &str) -> bool {
    matches!(status, "idle" | "ok" | "failed")
}

fn plugin_id() -> String {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("plugin-{suffix}")
}

fn build_plugin_payload(plugin: &PluginRecord, content: &str) -> serde_json::Value {
    match plugin.kind.as_str() {
        "wecom" | "dingtalk" => serde_json::json!({
            "msgtype": "text",
            "text": { "content": content }
        }),
        "feishu" => serde_json::json!({
            "msg_type": "text",
            "content": { "text": content }
        }),
        "wechat" => serde_json::json!({
            "title": "Mimodex 通知",
            "desp": content,
            "content": content
        }),
        _ => serde_json::json!({
            "source": "mimodex",
            "text": content
        }),
    }
}

async fn send_plugin_webhook(plugin: &PluginRecord, content: &str) -> PluginTestResult {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return PluginTestResult {
                ok: false,
                status_code: None,
                latency_ms: None,
                message: "无法初始化网络客户端".to_string(),
                detail: "系统网络客户端初始化失败。".to_string(),
            };
        }
    };
    let payload = build_plugin_payload(plugin, content);
    let started = std::time::Instant::now();
    let response = client.post(&plugin.webhook_url).json(&payload).send().await;
    let latency_ms = Some(started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    match response {
        Ok(response) => {
            let status = response.status();
            let status_code = Some(status.as_u16());
            let body = response.text().await.unwrap_or_default();
            let body_trimmed = body.trim();
            let body_preview: String = body_trimmed.chars().take(400).collect();
            if !status.is_success() {
                return PluginTestResult {
                    ok: false,
                    status_code,
                    latency_ms,
                    message: format!("Webhook 返回 {status}"),
                    detail: if body_preview.is_empty() {
                        format!("HTTP 状态码 {} 表示请求未被接受。", status.as_u16())
                    } else {
                        body_preview
                    },
                };
            }
            if let Some(error_detail) = inspect_plugin_response(&plugin.kind, body_trimmed) {
                return PluginTestResult {
                    ok: false,
                    status_code,
                    latency_ms,
                    message: "Webhook 返回业务失败".to_string(),
                    detail: error_detail,
                };
            }
            PluginTestResult {
                ok: true,
                status_code,
                latency_ms,
                message: "发送成功".to_string(),
                detail: if body_preview.is_empty() {
                    "Webhook 已接受请求。".to_string()
                } else {
                    body_preview
                },
            }
        }
        Err(error) if error.is_timeout() => PluginTestResult {
            ok: false,
            status_code: None,
            latency_ms,
            message: "请求超时".to_string(),
            detail: "Webhook 在 15 秒内未响应，请检查网络或服务状态。".to_string(),
        },
        Err(error) if error.is_connect() => PluginTestResult {
            ok: false,
            status_code: None,
            latency_ms,
            message: "无法连接 Webhook".to_string(),
            detail: "请检查 URL、网络、DNS、代理或防火墙设置。".to_string(),
        },
        Err(_) => PluginTestResult {
            ok: false,
            status_code: None,
            latency_ms,
            message: "Webhook 请求失败".to_string(),
            detail: "网络层返回了无法完成的响应。".to_string(),
        },
    }
}

fn inspect_plugin_response(kind: &str, body: &str) -> Option<String> {
    if body.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    match kind {
        "wecom" | "dingtalk" | "feishu" => {
            let code = value
                .get("errcode")
                .or_else(|| value.get("code"))
                .and_then(serde_json::Value::as_i64);
            let msg = value
                .get("errmsg")
                .or_else(|| value.get("msg"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if let Some(code) = code {
                if code != 0 {
                    return Some(format!("业务错误码 {code}: {msg}"));
                }
            }
            None
        }
        "wechat" => {
            let code = value
                .get("code")
                .or_else(|| value.get("errno"))
                .and_then(serde_json::Value::as_i64);
            if let Some(code) = code {
                if code != 0 && code != 200 {
                    let msg = value
                        .get("message")
                        .or_else(|| value.get("msg"))
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    return Some(format!("业务错误码 {code}: {msg}"));
                }
            }
            None
        }
        _ => None,
    }
}

fn valid_time_of_day(value: &str) -> bool {
    let Some((hours, minutes)) = value.split_once(':') else {
        return false;
    };
    let Ok(hours) = hours.parse::<u8>() else {
        return false;
    };
    let Ok(minutes) = minutes.parse::<u8>() else {
        return false;
    };
    hours <= 23 && minutes <= 59
}

fn automation_id() -> String {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("automation-{suffix}")
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

fn inspect_project(path: &Path, last_opened_at: i64) -> ProjectSummary {
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
    let status =
        run_git(path, &["status", "--porcelain=v1", "--untracked-files=all"]).unwrap_or_default();
    let mut changed_files = 0;
    let mut untracked_files = 0;
    let mut staged_files = 0;
    let mut unstaged_files = 0;
    for line in status.lines().filter(|line| !line.trim().is_empty()) {
        if line.starts_with("??") {
            untracked_files += 1;
        } else {
            changed_files += 1;
            let bytes = line.as_bytes();
            if bytes
                .first()
                .is_some_and(|value| *value != b' ' && *value != b'?')
            {
                staged_files += 1;
            }
            if bytes
                .get(1)
                .is_some_and(|value| *value != b' ' && *value != b'?')
            {
                unstaged_files += 1;
            }
        }
    }
    let staged_diff = run_git(
        path,
        &["diff", "--cached", "--no-ext-diff", "--no-color", "--", "."],
    )
    .unwrap_or_default();
    let unstaged_diff =
        run_git(path, &["diff", "--no-ext-diff", "--no-color", "--", "."]).unwrap_or_default();
    let untracked_diff = untracked_git_diff(path);
    let full_diff = join_git_diffs(&[
        ("已暂存", &staged_diff),
        ("未暂存", &unstaged_diff),
        ("未跟踪", &untracked_diff),
    ]);
    let (additions, deletions) = diff_line_counts(&full_diff);
    let diff = truncate_git_diff(full_diff);

    GitStatus {
        is_repository: true,
        branch,
        head,
        dirty: changed_files + untracked_files > 0,
        changed_files,
        untracked_files,
        staged_files,
        unstaged_files,
        additions,
        deletions,
        diff,
    }
}

fn list_git_branches(path: &Path) -> Vec<String> {
    let output = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads",
            "--sort=refname",
        ],
    )
    .unwrap_or_default();
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn switch_git_branch(path: &Path, branch: &str) -> Result<(), String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(path).args(["switch", branch]);
    hide_command_window(&mut command);
    let output = command
        .output()
        .map_err(|_| "无法调用 git 切换分支。".to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    if detail.is_empty() {
        Err(format!("切换到分支 {branch} 失败。"))
    } else {
        Err(format!("切换到分支 {branch} 失败：{detail}"))
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
        staged_files: 0,
        unstaged_files: 0,
        additions: 0,
        deletions: 0,
        diff: String::new(),
    }
}

fn run_git(path: &Path, args: &[&str]) -> Option<String> {
    run_git_with_exit_codes(path, args, &[0])
}

fn run_git_with_exit_codes(
    path: &Path,
    args: &[&str],
    accepted_exit_codes: &[i32],
) -> Option<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(path).args(args);
    hide_command_window(&mut command);
    let output = command.output().ok()?;
    let exit_code = output.status.code()?;
    accepted_exit_codes
        .contains(&exit_code)
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn untracked_git_diff(path: &Path) -> String {
    let files = run_git(
        path,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
        ],
    )
    .unwrap_or_default();
    let files = files
        .split('\0')
        .filter(|file| !file.is_empty())
        .collect::<Vec<_>>();
    let omitted_files = files.len().saturating_sub(MAX_UNTRACKED_DIFF_FILES);
    let mut diffs = files
        .into_iter()
        .take(MAX_UNTRACKED_DIFF_FILES)
        .filter_map(|file| {
            run_git_with_exit_codes(
                path,
                &[
                    "diff",
                    "--no-index",
                    "--no-ext-diff",
                    "--no-color",
                    "--",
                    "/dev/null",
                    file,
                ],
                &[0, 1],
            )
        })
        .filter(|diff| !diff.is_empty())
        .collect::<Vec<_>>();
    if omitted_files > 0 {
        diffs.push(format!("[另有 {omitted_files} 个未跟踪文件未展开]"));
    }
    diffs.join("\n\n")
}

fn join_git_diffs(sections: &[(&str, &str)]) -> String {
    sections
        .iter()
        .filter(|(_, diff)| !diff.is_empty())
        .map(|(title, diff)| format!("## {title}\n\n{diff}"))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn diff_line_counts(diff: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

fn truncate_git_diff(mut diff: String) -> String {
    let Some((byte_index, _)) = diff.char_indices().nth(MAX_PROJECT_DIFF_CHARS) else {
        return diff;
    };
    diff.truncate(byte_index);
    diff.push_str("\n\n[Diff 内容过长，已截断；文件计数与增删行统计仍为完整结果]");
    diff
}

#[cfg(windows)]
fn hide_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_command_window(_command: &mut Command) {}

fn unix_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
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

fn configure_runtime_settings(app: &AppHandle) {
    let settings = load_app_settings(app).unwrap_or_default();
    configure_runtime_base_url(&settings.api_base_url);
}

fn configure_runtime_base_url(api_base_url: &str) {
    // The Runtime sidecar reads this before constructing the built-in MiMo provider.
    unsafe {
        std::env::set_var(MIMO_BASE_URL_ENV, api_base_url);
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
    fn app_settings_normalize_trailing_slash_and_accept_supported_defaults() {
        let settings = validate_app_settings(AppSettings {
            api_base_url: " https://gateway.example.com/v1/ ".to_string(),
            default_model: "mimo-v2.5-pro".to_string(),
            default_sandbox: "read-only".to_string(),
        })
        .expect("validate app settings");

        assert_eq!(settings.api_base_url, "https://gateway.example.com/v1");
        assert_eq!(settings.default_model, "mimo-v2.5-pro");
        assert_eq!(settings.default_sandbox, "read-only");
    }

    #[test]
    fn app_settings_reject_invalid_endpoint() {
        let result = validate_app_settings(AppSettings {
            api_base_url: "file:///tmp/mimo".to_string(),
            ..AppSettings::default()
        });

        assert!(result.is_err());
        assert!(
            validate_app_settings(AppSettings {
                api_base_url: "https://".to_string(),
                ..AppSettings::default()
            })
            .is_err()
        );
    }

    #[test]
    fn connection_diagnostic_classifies_common_http_failures() {
        assert_eq!(diagnostic_http_failure(401).0, "authentication");
        assert_eq!(diagnostic_http_failure(404).0, "endpoint");
        assert_eq!(diagnostic_http_failure(429).0, "rateLimit");
        assert_eq!(diagnostic_http_failure(500).0, "provider");
    }

    #[test]
    fn git_status_includes_staged_new_file_diff() {
        let directory =
            std::env::temp_dir().join(format!("mimodex-git-status-{}", unix_timestamp_ms()));
        fs::create_dir_all(&directory).expect("create temporary repository");
        run_git(&directory, &["init"]).expect("initialize repository");
        fs::write(directory.join(".gitignore"), "node_modules/\ndist/\n")
            .expect("write staged fixture");
        run_git(&directory, &["add", ".gitignore"]).expect("stage fixture");

        let status = inspect_git_status(&directory);

        assert!(status.dirty);
        assert_eq!(status.changed_files, 1);
        assert_eq!(status.staged_files, 1);
        assert_eq!(status.unstaged_files, 0);
        assert_eq!(status.untracked_files, 0);
        assert_eq!(status.additions, 2);
        assert_eq!(status.deletions, 0);
        assert!(status.diff.contains("## 已暂存"));
        assert!(status.diff.contains("diff --git a/.gitignore b/.gitignore"));

        fs::remove_dir_all(directory).expect("remove temporary repository");
    }

    #[test]
    fn git_branch_helpers_list_and_switch_local_branches() {
        let directory =
            std::env::temp_dir().join(format!("mimodex-git-branch-{}", unix_timestamp_ms()));
        fs::create_dir_all(&directory).expect("create temporary repository");
        run_git(&directory, &["init"]).expect("initialize repository");
        run_git(
            &directory,
            &["config", "user.email", "mimodex@example.test"],
        )
        .expect("configure git email");
        run_git(&directory, &["config", "user.name", "Mimodex Test"]).expect("configure git name");
        run_git(&directory, &["branch", "-M", "main"]).expect("rename initial branch");
        fs::write(directory.join("README.md"), "fixture\n").expect("write fixture");
        run_git(&directory, &["add", "README.md"]).expect("stage fixture");
        run_git(&directory, &["commit", "-m", "initial"]).expect("commit fixture");
        run_git(&directory, &["switch", "-c", "develop"]).expect("create develop branch");

        let branches = list_git_branches(&directory);

        assert_eq!(branches, vec!["develop".to_string(), "main".to_string()]);
        switch_git_branch(&directory, "main").expect("switch to main");
        assert_eq!(
            inspect_git_status(&directory).branch.as_deref(),
            Some("main")
        );
        switch_git_branch(&directory, "develop").expect("switch to develop");
        assert_eq!(
            inspect_git_status(&directory).branch.as_deref(),
            Some("develop")
        );

        fs::remove_dir_all(directory).expect("remove temporary repository");
    }

    #[test]
    fn project_diff_is_truncated_without_breaking_unicode() {
        let diff = format!("{}结束", "变".repeat(MAX_PROJECT_DIFF_CHARS));

        let truncated = truncate_git_diff(diff);

        assert!(truncated.starts_with('变'));
        assert!(truncated.contains("已截断"));
        assert!(!truncated.contains("结束"));
    }

    #[test]
    fn thread_events_are_append_only_and_projection_is_queryable() {
        let mut connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("migrate SQLite");
        let mut thread = fixture_thread();
        thread.token_usage = Some(TokenUsage {
            input_tokens: 1_000,
            cached_input_tokens: 100,
            output_tokens: 500,
            reasoning_output_tokens: 50,
            total_tokens: 1_500,
            context_window: Some(1_000_000),
        });

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
        assert_eq!(stored.timeline[0].started_at, Some(1_000));
        assert_eq!(stored.timeline[0].completed_at, Some(2_000));
        assert_eq!(
            stored
                .token_usage
                .as_ref()
                .map(|token_usage| token_usage.total_tokens),
            Some(1_500)
        );
    }

    #[test]
    fn thread_list_order_is_stable_when_existing_thread_is_updated() {
        let mut connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("migrate SQLite");
        let mut older = fixture_thread();
        older.id = "thread-older".to_string();
        older.created_at = 1;
        older.updated_at = 1;
        let mut newer = fixture_thread();
        newer.id = "thread-newer".to_string();
        newer.created_at = 2;
        newer.updated_at = 2;

        let transaction = connection.transaction().expect("begin initial transaction");
        record_thread_projection(&transaction, &older, "threadProjectionRecorded")
            .expect("record older thread");
        record_thread_projection(&transaction, &newer, "threadProjectionRecorded")
            .expect("record newer thread");
        transaction.commit().expect("commit initial transaction");

        older.updated_at = 3;
        let transaction = connection.transaction().expect("begin update transaction");
        record_thread_projection(&transaction, &older, "threadProjectionRecorded")
            .expect("update older thread");
        transaction.commit().expect("commit update transaction");

        let state = load_thread_state(&connection).expect("load stable thread list");
        let ids = state
            .threads
            .iter()
            .map(|thread| thread.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["thread-newer", "thread-older"]);
    }

    #[test]
    fn migration_is_idempotent() {
        let connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("first migration");
        migrate_thread_database(&connection).expect("second migration");

        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count migrations");
        assert_eq!(migration_count, 6);
    }

    #[test]
    fn migration_adds_runtime_event_identity_to_existing_ledger() {
        let connection = Connection::open_in_memory().expect("open in-memory SQLite");
        connection
            .execute_batch(
                "
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at INTEGER NOT NULL
                );
                INSERT INTO schema_migrations(version, applied_at) VALUES (1, 0);
                CREATE TABLE thread_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    occurred_at INTEGER NOT NULL
                );
                ",
            )
            .expect("create schema v1");

        migrate_thread_database(&connection).expect("migrate schema v1 to v2");

        assert!(
            table_has_column(&connection, "thread_events", "event_id").expect("check event id")
        );
        assert!(
            table_has_column(&connection, "threads", "token_usage_json")
                .expect("check token usage projection")
        );
        let migration_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count migrations");
        assert_eq!(migration_count, 6);
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

    #[test]
    fn runtime_events_are_ordered_and_deduplicated_by_event_id() {
        let connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("migrate SQLite");
        let first = fixture_runtime_event("session-1-1", 1);
        let second = fixture_runtime_event("session-1-2", 2);

        append_runtime_events_to_connection(&connection, &[first, second])
            .expect("append runtime events");
        append_runtime_events_to_connection(
            &connection,
            &[fixture_runtime_event("session-1-1", 1)],
        )
        .expect("deduplicate first event");

        let event_ids = connection
            .prepare(
                "
                SELECT event_id FROM thread_events
                WHERE event_type = 'runtimeProtocolEvent'
                ORDER BY sequence ASC
                ",
            )
            .expect("prepare event query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query events")
            .collect::<Result<Vec<_>, _>>()
            .expect("read events");

        assert_eq!(event_ids, vec!["session-1-1", "session-1-2"]);

        let activity = load_thread_activity(&connection, "thread-test").expect("load activity");
        assert_eq!(activity.len(), 2);
        assert_eq!(activity[0].event_id, "session-1-2");
        assert_eq!(activity[1].event_id, "session-1-1");
        assert_eq!(activity[0].protocol["method"], "turn/started");
    }

    #[test]
    fn thread_projection_can_be_rebuilt_from_append_only_events() {
        let mut connection = Connection::open_in_memory().expect("open in-memory SQLite");
        migrate_thread_database(&connection).expect("migrate SQLite");
        let mut thread = fixture_thread();

        let transaction = connection.transaction().expect("begin first transaction");
        record_thread_projection(&transaction, &thread, "threadProjectionRecorded")
            .expect("record first projection");
        transaction.commit().expect("commit first transaction");

        thread.turn_status = "completed".to_string();
        thread.updated_at = 2;
        let transaction = connection.transaction().expect("begin second transaction");
        record_thread_projection(&transaction, &thread, "threadProjectionRecorded")
            .expect("record completed projection");
        transaction.commit().expect("commit second transaction");
        connection
            .execute("DELETE FROM threads", [])
            .expect("simulate lost projection");

        rebuild_thread_projections(&mut connection).expect("rebuild projection");
        let stored = load_thread(&connection, &thread.id)
            .expect("load rebuilt projection")
            .expect("thread exists");

        assert_eq!(stored.turn_status, "completed");
        assert_eq!(stored.updated_at, 2);
    }

    fn fixture_runtime_event(event_id: &str, sequence: i64) -> RuntimeEventRecord {
        RuntimeEventRecord {
            event_id: event_id.to_string(),
            thread_id: "thread-test".to_string(),
            protocol: serde_json::json!({
                "sequence": sequence,
                "direction": "runtimeToClient",
                "kind": "notification",
                "method": "turn/started",
                "requestId": null,
                "message": {
                    "method": "turn/started",
                    "params": { "threadId": "thread-test" }
                }
            }),
        }
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
                started_at: Some(1_000),
                completed_at: Some(2_000),
                images: None,
            }],
            token_usage: None,
            diff: String::new(),
            created_at: 1,
            updated_at: 1,
            archived: false,
            unread: false,
        }
    }
}
