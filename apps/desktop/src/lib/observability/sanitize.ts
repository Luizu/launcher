const REDACTED = "[REDACTED]";
const USER_PATH = "[user-path]";
const MAX_STRING_LENGTH = 2_000;

const SAFE_METADATA_KEYS = new Set([
  "code",
  "durationms",
  "event",
  "message",
  "method",
  "name",
  "operation",
  "path",
  "provider",
  "requestid",
  "route",
  "status",
  "version",
]);

const SENSITIVE_KEY_PARTS = [
  "secret",
  "password",
  "passcode",
  "pass",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "session",
  "refreshtoken",
  "accesstoken",
  "jwt",
  "bearer",
  "sid",
  "pw",
  "auth",
  "body",
  "query",
];

const SENSITIVE_ASSIGNMENT =
  /(?<![A-Za-z0-9])(?:key|api[-_]?key|secret|password|passcode|pass|token|authorization|cookie|credential|creds?|session[-_\s]?(?:id|token|cookie)?|refresh[-_]?token|access[-_]?token|jwt|bearer|sid|pw|auth)(?![A-Za-z0-9])\s*["']?\s*[:=：＝]\s*(?:"(?:\\.|[^"\\])*"|'[^']*'|\{[\s\S]*\}|\[[\s\S]*\]|[^\s,;&}]+)/gi;
const KEY_ASSIGNMENT =
  /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9_-]*)(?:\s+([A-Za-z][A-Za-z0-9_-]*))?\s*["']?\s*[:=：＝]\s*(?:"(?:\\.|[^"\\])*"|'[^']*'|\{[\s\S]*\}|\[[\s\S]*\]|[^\s,;&}]+)/gi;
const BEARER_VALUE = /(Bearer\s+)(?![:=：＝])[^\s]+/gi;
const URL_CREDENTIAL = /(\/\/[^/\s:@]+:)[^@\s]+(@)/g;
const SENSITIVE_PROSE_VALUE =
  /(\b(?:token|secret|password|passcode|jwt|bearer|sid|creds?|pw)\b\s+)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;&}"']{4,})/gi;
const POSIX_PERSONAL_PATH = /\/(?:Users|home)\/[^"'`,;)}\]]+/g;
const WINDOWS_PERSONAL_PATH = /\b[A-Za-z]:[\\/](?:Users|home)[\\/][^"'`,;)}\]]+/g;
const JSON_PAYLOAD = /(?:\{[\s\S]*\}|\[[\s\S]*\])/g;

/**
 * Removes credentials, payloads, and personal filesystem paths from text.
 * The result is bounded so accidental large values cannot flood logs or
 * telemetry envelopes.
 */
export function sanitizeText(value: string): string {
  return value
    .replace(BEARER_VALUE, `$1${REDACTED}`)
    .replace(KEY_ASSIGNMENT, redactKeyAssignment)
    .replace(SENSITIVE_ASSIGNMENT, REDACTED)
    .replace(URL_CREDENTIAL, `$1${REDACTED}$2`)
    .replace(JSON_PAYLOAD, REDACTED)
    .replace(SENSITIVE_PROSE_VALUE, `$1${REDACTED}`)
    .replace(POSIX_PERSONAL_PATH, USER_PATH)
    .replace(WINDOWS_PERSONAL_PATH, USER_PATH)
    .slice(0, MAX_STRING_LENGTH);
}

/**
 * Keeps only operational metadata that is useful for support and safe to
 * send to logs or Sentry. Sensitive keys are retained as an explicit marker
 * so their presence is visible without leaking their value.
 */
export function sanitizeValue(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (key && isSensitiveKey(key)) {
    return REDACTED;
  }

  if (value instanceof Error) {
    return {
      name: sanitizeText(value.name || "Error"),
      message: sanitizeText(value.message),
    };
  }

  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (Array.isArray(value)) {
    return REDACTED;
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return REDACTED;
    }

    seen.add(value);
    const sanitizedEntries = Object.entries(value).flatMap(
      ([entryKey, entryValue]) => {
        if (isSensitiveKey(entryKey)) {
          return [[entryKey, REDACTED]];
        }

        if (!isSafeMetadataKey(entryKey)) {
          return [];
        }

        return [[entryKey, sanitizeValue(entryValue, entryKey, seen)]];
      },
    );
    seen.delete(value);
    return Object.fromEntries(sanitizedEntries);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return typeof value === "number" || typeof value === "boolean" || value === null
    ? value
    : undefined;
}

function redactKeyAssignment(
  match: string,
  firstWord: string,
  secondWord: string | undefined,
): string {
  const normalized = normalizeKey(
    secondWord ? `${firstWord} ${secondWord}` : firstWord,
  );
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
    ? REDACTED
    : match;
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isSafeMetadataKey(key: string): boolean {
  return SAFE_METADATA_KEYS.has(normalizeKey(key));
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
