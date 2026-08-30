/// A value in the Valve KeyValues format.
///
/// The bounded parser only produces two shapes: a plain string, or an object
/// of alternating key/value pairs. Steam's `libraryfolders.vdf` and
/// `appmanifest_*.acf` files are object-shaped and keyed by unique IDs, so
/// duplicate keys keep the last value parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
pub enum ValveValue {
    String(String),
    Object(Vec<(String, ValveValue)>),
}

#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
impl ValveValue {
    /// Returns the string stored under `key`, when this value is an object
    /// and that entry is a string.
    pub fn string(&self, key: &str) -> Option<&str> {
        let entries = match self {
            ValveValue::Object(entries) => entries,
            ValveValue::String(_) => return None,
        };
        entries
            .iter()
            .find(|(entry_key, _)| entry_key == key)
            .and_then(|(_, value)| match value {
                ValveValue::String(value) => Some(value.as_str()),
                ValveValue::Object(_) => None,
            })
    }

    /// Returns the object stored under `key`, when this value is an object
    /// and that entry is an object.
    pub fn object(&self, key: &str) -> Option<&ValveValue> {
        let entries = match self {
            ValveValue::Object(entries) => entries,
            ValveValue::String(_) => return None,
        };
        entries
            .iter()
            .find(|(entry_key, _)| entry_key == key)
            .and_then(|(_, value)| match value {
                ValveValue::Object(_) => Some(value),
                ValveValue::String(_) => None,
            })
    }

    /// Iterates over the `(key, value)` pairs of this value.
    ///
    /// String values have no children and yield an empty iterator.
    pub fn children(&self) -> impl Iterator<Item = (&str, &ValveValue)> {
        let entries: &[(String, ValveValue)] = match self {
            ValveValue::Object(entries) => entries.as_slice(),
            ValveValue::String(_) => &[],
        };
        entries.iter().map(|(key, value)| (key.as_str(), value))
    }
}

/// A typed error for malformed Valve KeyValues input.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
pub enum ValveParseError {
    /// Input ended inside a string or while an object was still open.
    UnexpectedEndOfInput,
    /// A `{` or `}` appeared where a key or value was expected, with no
    /// matching brace.
    UnmatchedBrace,
    /// A key was read but the next token was not a value.
    MissingValue { key: String },
    /// Input nests deeper than the parser's recursion bound; parsing is
    /// rejected rather than overflowing the stack.
    NestingTooDeep,
}

impl std::fmt::Display for ValveParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ValveParseError::UnexpectedEndOfInput => {
                write!(f, "unexpected end of input while parsing valve keyvalues")
            }
            ValveParseError::UnmatchedBrace => {
                write!(f, "unmatched brace in valve keyvalues input")
            }
            ValveParseError::MissingValue { key } => {
                write!(f, "key {key:?} has no value in valve keyvalues input")
            }
            ValveParseError::NestingTooDeep => {
                write!(f, "valve keyvalues input nests too deeply")
            }
        }
    }
}

impl std::error::Error for ValveParseError {}
