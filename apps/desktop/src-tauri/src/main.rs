#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring_core::{Entry, Error as KeyringError};
use serde::Serialize;

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

fn main() {
    let _ = initialize_credential_store();
    configure_runtime_credential();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            delete_mimo_credential,
            get_mimo_credential_status,
            save_mimo_credential
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Mimodex desktop application");
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
