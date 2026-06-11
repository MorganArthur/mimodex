import { useEffect, useState, type FormEvent } from "react";

import type { DesktopSessionController } from "@mimodex/desktop-core";
import { App } from "./App.js";
import type { CredentialService, CredentialStatus } from "./credentials.js";

export type DesktopRootProps = {
  credentialService: CredentialService;
  createSession: () => DesktopSessionController;
};

export function DesktopRoot({ credentialService, createSession }: DesktopRootProps) {
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [session, setSession] = useState<DesktopSessionController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void credentialService
      .getStatus()
      .then(setCredentialStatus)
      .catch((error) => setCredentialError(errorMessage(error)));
  }, [credentialService]);

  useEffect(() => {
    if (!credentialStatus?.configured) {
      return;
    }
    const nextSession = createSession();
    setSession(nextSession);
    return () => {
      setSession(null);
      void nextSession.close();
    };
  }, [createSession, credentialStatus?.configured]);

  const saveCredential = async (apiKey: string) => {
    const status = await credentialService.save(apiKey);
    await credentialService.restart();
    setCredentialStatus(status);
  };

  const deleteCredential = async () => {
    const status = await credentialService.delete();
    await credentialService.restart();
    setCredentialStatus(status);
  };

  if (credentialError) {
    return <CredentialErrorPanel message={credentialError} />;
  }
  if (!credentialStatus) {
    return <LoadingPanel />;
  }
  if (!credentialStatus.configured) {
    return <CredentialSetup status={credentialStatus} onSave={saveCredential} />;
  }
  if (!session) {
    return <LoadingPanel />;
  }

  return (
    <>
      <App session={session} onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen && (
        <CredentialSettings
          status={credentialStatus}
          onClose={() => setSettingsOpen(false)}
          onDelete={deleteCredential}
          onSave={saveCredential}
        />
      )}
    </>
  );
}

function CredentialSetup({
  status,
  onSave,
}: {
  status: CredentialStatus;
  onSave: (apiKey: string) => Promise<void>;
}) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="setup-brand">
          <span className="brand-mark">M</span>
          <div><strong>Mimodex</strong><span>首次设置</span></div>
        </div>
        <p className="eyebrow">MIMO PROVIDER</p>
        <h1>连接你的 MiMo API</h1>
        <p className="setup-description">
          API Key 将保存在 Windows 凭据管理器中，不会写入项目、日志或普通配置文件。
        </p>
        <CredentialForm status={status} submitLabel="保存并重启 Mimodex" onSave={onSave} />
      </section>
    </main>
  );
}

function CredentialSettings({
  status,
  onClose,
  onDelete,
  onSave,
}: {
  status: CredentialStatus;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (error) {
      setDeleteError(errorMessage(error));
      setDeleting(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section aria-label="MiMo 设置" aria-modal="true" className="settings-dialog" role="dialog">
        <header>
          <div><p className="eyebrow">设置</p><h2>MiMo Provider</h2></div>
          <button aria-label="关闭设置" type="button" onClick={onClose}>×</button>
        </header>
        <CredentialForm status={status} submitLabel="更换 Key 并重启" onSave={onSave} />
        {status.source === "windowsCredentialManager" ? (
          <div className="danger-zone">
            <div>
              <strong>删除已保存的 API Key</strong>
              <span>删除后 Mimodex 将重启，并返回首次设置界面。</span>
            </div>
            <button disabled={deleting} type="button" onClick={() => void remove()}>
              {deleting ? "删除中" : "删除凭据"}
            </button>
          </div>
        ) : (
          <div className="environment-note">
            当前凭据来自启动环境变量。保存新的 Key 可将其迁移到 Windows 凭据管理器；
            环境变量本身需要在系统环境设置中移除。
          </div>
        )}
        {deleteError && <p className="form-error">{deleteError}</p>}
      </section>
    </div>
  );
}

function CredentialForm({
  status,
  submitLabel,
  onSave,
}: {
  status: CredentialStatus;
  submitLabel: string;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(apiKey);
    } catch (saveError) {
      setError(errorMessage(saveError));
      setSaving(false);
    }
  };

  return (
    <form className="credential-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>API Base URL</span>
        <input disabled value="https://api.xiaomimimo.com/v1" />
        <small>首版使用官方端点；自定义兼容端点将在连接诊断阶段开放。</small>
      </label>
      <label>
        <span>MiMo API Key</span>
        <input
          aria-label="MiMo API Key"
          autoComplete="off"
          placeholder={status.configured ? "输入新的 Key 以替换现有凭据" : "输入你的 MiMo API Key"}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <div className="credential-status">
        <span className={`connection-dot ${status.configured ? "ready" : "idle"}`} />
        <div>
          <strong>{credentialStatusLabel(status)}</strong>
          <span>安全存储：{status.storage}</span>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="credential-submit" disabled={!apiKey.trim() || saving} type="submit">
        {saving ? "正在安全保存…" : submitLabel}
      </button>
      <p className="restart-note">保存后应用会重启一次，Runtime 才能安全读取新凭据。</p>
    </form>
  );
}

function LoadingPanel() {
  return <main className="setup-screen"><div className="loading-panel">正在准备 Mimodex…</div></main>;
}

function CredentialErrorPanel({ message }: { message: string }) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <p className="eyebrow">凭据存储异常</p>
        <h1>无法读取 Windows 凭据管理器</h1>
        <p className="setup-description">{message}</p>
      </section>
    </main>
  );
}

function credentialStatusLabel(status: CredentialStatus): string {
  if (status.source === "windowsCredentialManager") {
    return "已安全保存";
  }
  if (status.source === "environment") {
    return "当前使用环境变量";
  }
  return "尚未配置";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
