#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring_core::{Entry, Error as KeyringError};
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

fn main() {
    let _ = initialize_credential_store();
    configure_runtime_credential();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            add_project,
            delete_mimo_credential,
            get_mimo_credential_status,
            list_projects,
            refresh_project,
            save_mimo_credential,
            select_project
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
    let status = run_git(path, &["status", "--porcelain=v1", "--untracked-files=normal"])
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
