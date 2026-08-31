use std::path::Path;

/// Keeps the Rust and Crashpad clients alive for the lifetime of the Tauri
/// process. Dropping either guard flushes its queue and disables its client.
pub struct NativeObservabilityGuard {
    _rust: Option<sentry::ClientInitGuard>,
    #[cfg(windows)]
    _crashpad: Option<sentry_contrib_native::Shutdown>,
}

pub(crate) fn native_dsn(dsn: Option<&str>) -> Option<&str> {
    dsn.map(str::trim).filter(|dsn| !dsn.is_empty())
}

pub(crate) fn native_release(version: &str) -> String {
    format!("fuse-launcher@{version}")
}

/// Initializes panic reporting everywhere and Crashpad hard-crash reporting
/// on Windows when a DSN and packaged handler are available. Missing local
/// configuration is intentionally non-fatal.
pub fn init_native_observability(
    resource_dir: Option<&Path>,
    data_dir: Option<&Path>,
) -> NativeObservabilityGuard {
    #[cfg(not(windows))]
    let _ = (resource_dir, data_dir);

    let runtime_dsn = std::env::var("SENTRY_NATIVE_DSN").ok();
    let dsn = native_dsn(option_env!("SENTRY_NATIVE_DSN").or(runtime_dsn.as_deref()));
    let Some(dsn) = dsn else {
        return NativeObservabilityGuard::disabled();
    };

    if dsn.parse::<sentry::types::Dsn>().is_err() {
        log::warn!("native observability disabled because its DSN is invalid");
        return NativeObservabilityGuard::disabled();
    }

    let environment = if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    };
    let release = native_release(env!("CARGO_PKG_VERSION"));
    let rust_guard = sentry::init(
        sentry::ClientOptions::new()
            .dsn(dsn)
            .release(release.clone())
            .environment(environment)
            .send_default_pii(false)
            .before_send(sanitize_rust_event),
    );

    #[cfg(windows)]
    let crashpad = init_crashpad(dsn, &release, environment, resource_dir, data_dir);

    #[cfg(windows)]
    if crashpad.is_some() {
        let previous_hook = std::panic::take_hook();
        sentry_contrib_native::set_hook(Some(Box::new(sanitize_native_event)), Some(previous_hook));
    }

    NativeObservabilityGuard {
        _rust: Some(rust_guard),
        #[cfg(windows)]
        _crashpad: crashpad,
    }
}

impl NativeObservabilityGuard {
    fn disabled() -> Self {
        Self {
            _rust: None,
            #[cfg(windows)]
            _crashpad: None,
        }
    }
}

#[cfg(windows)]
fn init_crashpad(
    dsn: &str,
    release: &str,
    environment: &str,
    resource_dir: Option<&Path>,
    data_dir: Option<&Path>,
) -> Option<sentry_contrib_native::Shutdown> {
    let Some(resource_dir) = resource_dir else {
        log::warn!("native crash reporting disabled because resources are unavailable");
        return None;
    };
    let Some(data_dir) = data_dir else {
        log::warn!("native crash reporting disabled because app data is unavailable");
        return None;
    };

    let handler_path = resource_dir.join("crashpad_handler.exe");
    if !handler_path.is_file() {
        log::warn!("native crash reporting disabled because its handler is unavailable");
        return None;
    }

    let mut options = sentry_contrib_native::Options::new();
    options.set_dsn(dsn);
    options.set_release(release);
    options.set_environment(environment);
    options.set_handler_path(handler_path);
    options.set_database_path(data_dir.join("sentry-native"));

    match options.init() {
        Ok(shutdown) => Some(shutdown),
        Err(_) => {
            log::warn!("native crash reporting could not be initialized");
            None
        }
    }
}

fn sanitize_rust_event(
    mut event: sentry::protocol::Event<'static>,
) -> Option<sentry::protocol::Event<'static>> {
    event.server_name = None;
    event.user = None;
    event.contexts.clear();
    event.breadcrumbs = Default::default();
    event.modules.clear();
    event.threads = event
        .threads
        .into_iter()
        .map(|mut thread| {
            if let Some(stacktrace) = thread.stacktrace.as_mut() {
                sanitize_stacktrace(stacktrace);
            }
            if let Some(stacktrace) = thread.raw_stacktrace.as_mut() {
                sanitize_stacktrace(stacktrace);
            }
            thread
        })
        .collect();
    event.exception = event
        .exception
        .into_iter()
        .map(|mut exception| {
            exception.value = exception.value.map(|value| sanitize_native_text(&value));
            exception.mechanism = None;
            if let Some(stacktrace) = exception.stacktrace.as_mut() {
                sanitize_stacktrace(stacktrace);
            }
            if let Some(stacktrace) = exception.raw_stacktrace.as_mut() {
                sanitize_stacktrace(stacktrace);
            }
            exception
        })
        .collect();
    if let Some(stacktrace) = event.stacktrace.as_mut() {
        sanitize_stacktrace(stacktrace);
    }
    if let Some(request) = event.request.as_mut() {
        request.url = None;
        request.data = None;
        request.query_string = None;
        request.cookies = None;
        request.headers.clear();
        request.env.clear();
    }
    event.message = event.message.map(|message| sanitize_native_text(&message));
    event.transaction = event
        .transaction
        .map(|transaction| sanitize_native_text(&transaction));
    event.culprit = event.culprit.map(|culprit| sanitize_native_text(&culprit));
    event.extra = sanitize_extra(event.extra);
    Some(event)
}

fn sanitize_stacktrace(stacktrace: &mut sentry::protocol::Stacktrace) {
    for frame in &mut stacktrace.frames {
        frame.abs_path = None;
        frame.pre_context.clear();
        frame.context_line = None;
        frame.post_context.clear();
        frame.vars.clear();
    }
    stacktrace.registers.clear();
}

fn sanitize_extra(
    extra: sentry::protocol::Map<String, sentry::protocol::Value>,
) -> sentry::protocol::Map<String, sentry::protocol::Value> {
    extra
        .into_iter()
        .filter_map(|(key, value)| {
            if is_sensitive_key(&key) {
                return Some((key, sentry::protocol::Value::String("[REDACTED]".into())));
            }
            if !is_safe_metadata_key(&key) {
                return None;
            }
            Some((key, sanitize_native_value(value)))
        })
        .collect()
}

fn sanitize_native_value(value: sentry::protocol::Value) -> sentry::protocol::Value {
    match value {
        sentry::protocol::Value::String(value) => {
            sentry::protocol::Value::String(sanitize_native_text(&value))
        }
        sentry::protocol::Value::Array(_) => sentry::protocol::Value::String("[REDACTED]".into()),
        sentry::protocol::Value::Object(value) => {
            sentry::protocol::Value::Object(sanitize_json_object(value))
        }
        value => value,
    }
}

fn sanitize_json_object(
    object: serde_json::Map<String, sentry::protocol::Value>,
) -> serde_json::Map<String, sentry::protocol::Value> {
    object
        .into_iter()
        .filter_map(|(key, value)| {
            if is_sensitive_key(&key) {
                return Some((key, sentry::protocol::Value::String("[REDACTED]".into())));
            }
            if !is_safe_metadata_key(&key) {
                return None;
            }
            Some((key, sanitize_native_value(value)))
        })
        .collect()
}

#[cfg(windows)]
fn sanitize_native_event(mut event: sentry_contrib_native::Event) -> sentry_contrib_native::Event {
    event.map = sanitize_native_map(event.map);
    event
}

#[cfg(windows)]
fn sanitize_native_map(
    map: std::collections::BTreeMap<String, sentry_contrib_native::Value>,
) -> std::collections::BTreeMap<String, sentry_contrib_native::Value> {
    map.into_iter()
        .filter_map(|(key, value)| {
            if is_sensitive_key(&key) {
                return Some((
                    key,
                    sentry_contrib_native::Value::String("[REDACTED]".into()),
                ));
            }
            if !is_safe_metadata_key(&key) && key != "exception" && key != "threads" {
                return None;
            }
            Some((key, sanitize_native_value_for_crash(value)))
        })
        .collect()
}

#[cfg(windows)]
fn sanitize_native_value_for_crash(
    value: sentry_contrib_native::Value,
) -> sentry_contrib_native::Value {
    match value {
        sentry_contrib_native::Value::String(value) => {
            sentry_contrib_native::Value::String(sanitize_native_text(&value))
        }
        sentry_contrib_native::Value::List(values) => sentry_contrib_native::Value::List(
            values
                .into_iter()
                .map(sanitize_native_value_for_crash)
                .collect(),
        ),
        sentry_contrib_native::Value::Map(value) => {
            sentry_contrib_native::Value::Map(sanitize_native_map(value))
        }
        value => value,
    }
}

fn sanitize_native_text(value: &str) -> String {
    let value = redact_sensitive_assignments(value);
    redact_personal_paths(&value).chars().take(2_000).collect()
}

fn redact_sensitive_assignments(value: &str) -> String {
    [
        "authorization",
        "password",
        "passcode",
        "secret",
        "token",
        "cookie",
        "session",
    ]
    .into_iter()
    .fold(value.to_string(), |current, key| {
        redact_assignments_for_key(&current, key)
    })
}

fn redact_assignments_for_key(value: &str, key: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;

    while let Some(found) = lower[cursor..].find(key) {
        let start = cursor + found;
        let after_key = start + key.len();
        let Some(separator) = lower[after_key..].find(|character: char| {
            character == '=' || character == ':' || character.is_ascii_whitespace()
        }) else {
            break;
        };
        let separator_end = after_key + separator + 1;
        let value_start = separator_end
            + lower[separator_end..]
                .chars()
                .take_while(|character| {
                    character.is_ascii_whitespace() || *character == '"' || *character == '\''
                })
                .map(char::len_utf8)
                .sum::<usize>();
        let value_end = value_start
            + lower[value_start..]
                .find(|character: char| {
                    character.is_ascii_whitespace() || ",;&}".contains(character)
                })
                .unwrap_or(lower.len() - value_start);
        if value_start >= value_end {
            cursor = separator_end;
            continue;
        }

        output.push_str(&value[cursor..value_start]);
        output.push_str("[REDACTED]");
        cursor = value_end;
    }

    output.push_str(&value[cursor..]);
    output
}

fn redact_personal_paths(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let Some((start, marker_len)) = find_personal_path(bytes, cursor) else {
            output.push_str(&value[cursor..]);
            break;
        };
        output.push_str(&value[cursor..start]);
        output.push_str("[user-path]");
        let mut end = start + marker_len;
        while end < bytes.len()
            && !matches!(
                bytes[end],
                b' ' | b'\t' | b'\r' | b'\n' | b'"' | b'\'' | b',' | b';' | b')' | b'}' | b']'
            )
        {
            end += 1;
        }
        cursor = end;
    }
    output
}

fn find_personal_path(bytes: &[u8], from: usize) -> Option<(usize, usize)> {
    let markers = [
        b"/Users/".as_slice(),
        b"/home/".as_slice(),
        b"\\Users\\".as_slice(),
        b"\\home\\".as_slice(),
    ];
    let mut best: Option<(usize, usize)> = None;
    for marker in markers {
        let Some(relative) = bytes[from..]
            .windows(marker.len())
            .position(|window| window.eq_ignore_ascii_case(marker))
        else {
            continue;
        };
        let marker_start = from + relative;
        let start = if marker_start >= 2
            && bytes[marker_start - 1] == b':'
            && bytes[marker_start - 2].is_ascii_alphabetic()
        {
            marker_start - 2
        } else {
            marker_start
        };
        if best.is_none_or(|(best_start, _)| start < best_start) {
            best = Some((start, marker_start + marker.len() - start));
        }
    }
    best
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = normalize_key(key);
    [
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
    ]
    .iter()
    .any(|part| normalized.contains(part))
}

fn is_safe_metadata_key(key: &str) -> bool {
    matches!(
        normalize_key(key).as_str(),
        "code"
            | "column"
            | "durationms"
            | "event"
            | "line"
            | "message"
            | "method"
            | "name"
            | "operation"
            | "path"
            | "provider"
            | "requestid"
            | "route"
            | "status"
            | "version"
    )
}

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{native_dsn, native_release, sanitize_native_text};

    #[test]
    fn native_observability_is_disabled_without_a_dsn() {
        assert!(native_dsn(None).is_none());
        assert!(native_dsn(Some("  ")).is_none());
    }

    #[test]
    fn native_release_uses_the_product_version() {
        assert_eq!(native_release("0.3.0"), "fuse-launcher@0.3.0");
    }

    #[test]
    fn native_text_redacts_multiple_secrets_without_leaking_or_panicking() {
        let sanitized = sanitize_native_text(
            "token=first-secret password=second-secret /Users/alice/fuse-launcher/config.json",
        );

        assert!(!sanitized.contains("first-secret"));
        assert!(!sanitized.contains("second-secret"));
        assert!(!sanitized.contains("/Users/alice"));
        assert!(sanitized.contains("[REDACTED]"));
        assert!(sanitized.contains("[user-path]"));
    }
}
