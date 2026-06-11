import { invoke, isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

export type CredentialSource = "environment" | "missing" | "windowsCredentialManager";

export type CredentialStatus = {
  configured: boolean;
  source: CredentialSource;
  storage: string;
};

export interface CredentialService {
  getStatus(): Promise<CredentialStatus>;
  save(apiKey: string): Promise<CredentialStatus>;
  delete(): Promise<CredentialStatus>;
  restart(): Promise<void>;
}

export function createCredentialService(): CredentialService {
  return isTauri() ? new TauriCredentialService() : new DemoCredentialService();
}

class TauriCredentialService implements CredentialService {
  getStatus(): Promise<CredentialStatus> {
    return invoke("get_mimo_credential_status");
  }

  save(apiKey: string): Promise<CredentialStatus> {
    return invoke("save_mimo_credential", { apiKey });
  }

  delete(): Promise<CredentialStatus> {
    return invoke("delete_mimo_credential");
  }

  restart(): Promise<void> {
    return relaunch();
  }
}

class DemoCredentialService implements CredentialService {
  #status: CredentialStatus = {
    configured: true,
    source: "windowsCredentialManager",
    storage: "浏览器演示凭据",
  };

  async getStatus(): Promise<CredentialStatus> {
    return this.#status;
  }

  async save(_apiKey: string): Promise<CredentialStatus> {
    this.#status = { ...this.#status, configured: true };
    return this.#status;
  }

  async delete(): Promise<CredentialStatus> {
    this.#status = { ...this.#status, configured: false, source: "missing" };
    return this.#status;
  }

  async restart(): Promise<void> {}
}
