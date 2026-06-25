import { invoke, isTauri } from "@tauri-apps/api/core";

export type PluginKind = "wecom" | "feishu" | "dingtalk" | "wechat" | "webhook";

export type PluginTestStatus = "idle" | "ok" | "failed";

export type PluginRecord = {
  id: string;
  kind: PluginKind;
  name: string;
  webhookUrl: string;
  secret: string | null;
  enabled: boolean;
  lastTestStatus: PluginTestStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PluginDraft = {
  kind: PluginKind;
  name: string;
  webhookUrl: string;
  secret: string | null;
  enabled: boolean;
};

export type PluginState = {
  plugins: PluginRecord[];
};

export type PluginTestResult = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  message: string;
  detail: string;
};

export interface PluginService {
  list(): Promise<PluginState>;
  create(input: PluginDraft): Promise<PluginState>;
  update(pluginId: string, input: PluginDraft): Promise<PluginState>;
  delete(pluginId: string): Promise<PluginState>;
  test(pluginId: string, content: string): Promise<{ result: PluginTestResult; state: PluginState }>;
}

export const PLUGIN_KIND_OPTIONS: Array<{
  description: string;
  label: string;
  value: PluginKind;
}> = [
  {
    description: "企业微信群机器人 Webhook，发送文本消息。",
    label: "企业微信",
    value: "wecom",
  },
  {
    description: "飞书自定义机器人 Webhook，发送文本消息。",
    label: "飞书",
    value: "feishu",
  },
  {
    description: "钉钉自定义机器人 Webhook，发送文本消息（可选加签密钥）。",
    label: "钉钉",
    value: "dingtalk",
  },
  {
    description: "微信通知（Server 酱 / PushPlus 等），按 query 携带 key。",
    label: "微信通知",
    value: "wechat",
  },
  {
    description: "通用 Webhook，POST 一段 JSON 文本。",
    label: "通用 Webhook",
    value: "webhook",
  },
];

export function pluginKindLabel(kind: PluginKind): string {
  return PLUGIN_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function createPluginService(): PluginService {
  return isTauri() ? new TauriPluginService() : new DemoPluginService();
}

export function normalizePluginDraft(input: PluginDraft): PluginDraft {
  const kind = normalizePluginKind(input.kind);
  return {
    kind,
    name: compactPluginName(input.name.trim() || pluginKindLabel(kind)),
    webhookUrl: input.webhookUrl.trim(),
    secret:
      typeof input.secret === "string" && input.secret.trim().length > 0
        ? input.secret.trim()
        : null,
    enabled: Boolean(input.enabled),
  };
}

export function normalizePluginKind(kind: PluginKind | string): PluginKind {
  return PLUGIN_KIND_OPTIONS.some((option) => option.value === kind)
    ? (kind as PluginKind)
    : "webhook";
}

class TauriPluginService implements PluginService {
  list(): Promise<PluginState> {
    return invoke("list_plugins");
  }

  create(input: PluginDraft): Promise<PluginState> {
    return invoke("create_plugin", { plugin: normalizePluginDraft(input) });
  }

  update(pluginId: string, input: PluginDraft): Promise<PluginState> {
    return invoke("update_plugin", {
      plugin: normalizePluginDraft(input),
      pluginId,
    });
  }

  delete(pluginId: string): Promise<PluginState> {
    return invoke("delete_plugin", { pluginId });
  }

  test(
    pluginId: string,
    content: string,
  ): Promise<{ result: PluginTestResult; state: PluginState }> {
    return invoke("test_plugin", {
      pluginId,
      content: content.trim() || "Mimodex 插件测试消息",
    });
  }
}

class DemoPluginService implements PluginService {
  #state: PluginState = { plugins: [] };

  async list(): Promise<PluginState> {
    return this.#state;
  }

  async create(input: PluginDraft): Promise<PluginState> {
    const now = Date.now();
    const draft = normalizePluginDraft(input);
    const plugin: PluginRecord = {
      ...draft,
      id: `plugin-${now}-${Math.random().toString(36).slice(2, 7)}`,
      lastTestStatus: "idle",
      lastTestedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#state = { plugins: [plugin, ...this.#state.plugins] };
    return this.#state;
  }

  async update(pluginId: string, input: PluginDraft): Promise<PluginState> {
    const draft = normalizePluginDraft(input);
    this.#state = {
      plugins: this.#state.plugins.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, ...draft, updatedAt: Date.now() } : plugin,
      ),
    };
    return this.#state;
  }

  async delete(pluginId: string): Promise<PluginState> {
    this.#state = {
      plugins: this.#state.plugins.filter((plugin) => plugin.id !== pluginId),
    };
    return this.#state;
  }

  async test(
    pluginId: string,
    _content: string,
  ): Promise<{ result: PluginTestResult; state: PluginState }> {
    const now = Date.now();
    const result: PluginTestResult = {
      ok: true,
      statusCode: 200,
      latencyMs: 120,
      message: "演示模式：未发送真实请求",
      detail: "Demo 环境下 test 调用只更新本地状态。",
    };
    this.#state = {
      plugins: this.#state.plugins.map((plugin) =>
        plugin.id === pluginId
          ? {
              ...plugin,
              lastTestStatus: "ok",
              lastTestedAt: now,
              lastError: null,
              updatedAt: now,
            }
          : plugin,
      ),
    };
    return { result, state: this.#state };
  }
}

function compactPluginName(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 80);
}
