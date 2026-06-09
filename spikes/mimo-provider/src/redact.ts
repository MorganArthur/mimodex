const SENSITIVE_KEY = /(authorization|api[-_]?key|access[-_]?token|secret|credential)/i;

export function redact<T>(value: T, explicitSecrets: string[] = []): T {
  return redactValue(value, explicitSecrets.filter(Boolean)) as T;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, secrets),
      ]),
    );
  }

  return value;
}
