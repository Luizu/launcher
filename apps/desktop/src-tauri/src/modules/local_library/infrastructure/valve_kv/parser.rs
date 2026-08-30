use crate::modules::local_library::domain::valve_value::{ValveParseError, ValveValue};
use crate::modules::local_library::infrastructure::valve_kv::tokenizer::{Token, Tokenizer};

/// Bounded parser for the Valve KeyValues format used by Steam's
/// `libraryfolders.vdf` and `appmanifest_*.acf` files.
///
/// The parser understands quoted strings (with `\\` and `\"` escapes),
/// unquoted tokens, `{`/`}` objects, whitespace, and `//` line comments.
/// Malformed structure is rejected with a typed [`ValveParseError`] rather
/// than guessed at; there is no scripting support. Duplicate keys keep the
/// last value, which is safe for the object-shaped scanner files.
#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
pub struct ValveKeyValueParser;

#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
impl ValveKeyValueParser {
    /// Maximum allowed object nesting depth. Real Steam files nest only
    /// about four to six levels; the cap keeps recursion bounded so a
    /// deeply nested hostile input is rejected with a typed error instead
    /// of overflowing the stack.
    const MAX_NESTING_DEPTH: usize = 64;

    /// Parses a sequence of top-level key/value pairs into an object value.
    pub fn parse(input: &str) -> Result<ValveValue, ValveParseError> {
        let mut tokenizer = Tokenizer::new(input);
        let mut root = Vec::new();
        while let Some(token) = tokenizer.next_token()? {
            match token {
                Token::String(key) => {
                    let value = Self::parse_value(&mut tokenizer, &key, 0)?;
                    Self::insert(&mut root, key, value);
                }
                Token::LBrace | Token::RBrace => {
                    return Err(ValveParseError::UnmatchedBrace);
                }
            }
        }
        Ok(ValveValue::Object(root))
    }

    /// Parses the value that must follow `key`: a string, an object, or a
    /// typed error when the value is missing. `depth` is the nesting level
    /// of the object currently being parsed (0 at the top level).
    fn parse_value(
        tokenizer: &mut Tokenizer<'_>,
        key: &str,
        depth: usize,
    ) -> Result<ValveValue, ValveParseError> {
        match tokenizer.next_token()? {
            Some(Token::String(value)) => Ok(ValveValue::String(value)),
            Some(Token::LBrace) => Self::parse_object(tokenizer, depth + 1),
            Some(Token::RBrace) | None => Err(ValveParseError::MissingValue {
                key: key.to_string(),
            }),
        }
    }

    /// Parses `{ key value ... }` into an object value, rejecting input
    /// that nests deeper than [`Self::MAX_NESTING_DEPTH`].
    fn parse_object(
        tokenizer: &mut Tokenizer<'_>,
        depth: usize,
    ) -> Result<ValveValue, ValveParseError> {
        if depth > Self::MAX_NESTING_DEPTH {
            return Err(ValveParseError::NestingTooDeep);
        }
        let mut entries = Vec::new();
        loop {
            match tokenizer.next_token()? {
                Some(Token::RBrace) => return Ok(ValveValue::Object(entries)),
                Some(Token::String(key)) => {
                    let value = Self::parse_value(tokenizer, &key, depth)?;
                    Self::insert(&mut entries, key, value);
                }
                Some(Token::LBrace) => return Err(ValveParseError::UnmatchedBrace),
                None => return Err(ValveParseError::UnexpectedEndOfInput),
            }
        }
    }

    /// Records `(key, value)`, keeping the last value for a duplicate key.
    fn insert(entries: &mut Vec<(String, ValveValue)>, key: String, value: ValveValue) {
        if let Some(entry) = entries.iter_mut().find(|(existing, _)| *existing == key) {
            entry.1 = value;
        } else {
            entries.push((key, value));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ValveKeyValueParser;
    use crate::modules::local_library::domain::valve_value::{ValveParseError, ValveValue};

    #[test]
    fn parses_nested_library_folders_and_escaped_windows_paths() {
        let input = include_str!("../../../../../tests/fixtures/libraryfolders.vdf");
        let value = ValveKeyValueParser::parse(input).unwrap();
        let folders = value.object("libraryfolders").unwrap();
        let first = folders.object("0").unwrap();

        assert_eq!(first.string("path"), Some("C:\\Program Files (x86)\\Steam"));
        assert!(first.object("apps").unwrap().string("730").is_some());
    }

    #[test]
    fn parses_an_app_manifest_without_treating_numbers_as_special_tokens() {
        let input = include_str!("../../../../../tests/fixtures/appmanifest_730.acf");
        let value = ValveKeyValueParser::parse(input).unwrap();
        let app = value.object("AppState").unwrap();

        assert_eq!(app.string("appid"), Some("730"));
        assert_eq!(app.string("StateFlags"), Some("4"));
    }

    #[test]
    fn iterates_children_as_key_value_pairs() {
        let input = include_str!("../../../../../tests/fixtures/libraryfolders.vdf");
        let value = ValveKeyValueParser::parse(input).unwrap();

        assert_eq!(value.children().count(), 1);
        let (root_key, root_value) = value.children().next().unwrap();
        assert_eq!(root_key, "libraryfolders");
        assert_eq!(root_value.children().count(), 3);

        assert_eq!(ValveValue::String("x".into()).children().count(), 0);
    }

    #[test]
    fn rejects_a_stray_closing_brace() {
        assert_eq!(
            ValveKeyValueParser::parse("}").unwrap_err(),
            ValveParseError::UnmatchedBrace
        );
    }

    #[test]
    fn rejects_a_key_without_a_value() {
        assert_eq!(
            ValveKeyValueParser::parse("\"key\"").unwrap_err(),
            ValveParseError::MissingValue { key: "key".into() }
        );
        assert_eq!(
            ValveKeyValueParser::parse("\"key\" }").unwrap_err(),
            ValveParseError::MissingValue { key: "key".into() }
        );
    }

    #[test]
    fn rejects_an_unclosed_object() {
        assert_eq!(
            ValveKeyValueParser::parse("\"key\" {").unwrap_err(),
            ValveParseError::UnexpectedEndOfInput
        );
    }

    #[test]
    fn rejects_an_unterminated_string() {
        assert_eq!(
            ValveKeyValueParser::parse("\"key\" \"unterminated").unwrap_err(),
            ValveParseError::UnexpectedEndOfInput
        );
    }

    #[test]
    fn keeps_the_last_value_for_duplicate_keys() {
        let value = ValveKeyValueParser::parse("\"appid\" \"1\" \"appid\" \"730\"").unwrap();
        assert_eq!(value.string("appid"), Some("730"));
    }

    #[test]
    fn ignores_line_comments() {
        let value = ValveKeyValueParser::parse("// header\n\"appid\" \"730\" // trailing").unwrap();
        assert_eq!(value.string("appid"), Some("730"));
    }

    #[test]
    fn parses_empty_objects() {
        let value = ValveKeyValueParser::parse("\"Mounteds\" {}").unwrap();
        assert!(value.object("Mounteds").is_some());
        assert_eq!(value.object("Mounteds").unwrap().children().count(), 0);
    }

    #[test]
    fn rejects_deeply_nested_input_with_a_typed_error() {
        let input = "\"k\" {".repeat(10_000);
        assert_eq!(
            ValveKeyValueParser::parse(&input).unwrap_err(),
            ValveParseError::NestingTooDeep
        );
    }

    #[test]
    fn resolves_the_root_object_after_a_leading_utf8_bom() {
        let fixture = include_str!("../../../../../tests/fixtures/libraryfolders.vdf");
        let value = ValveKeyValueParser::parse(&format!("\u{feff}{fixture}")).unwrap();
        assert!(value.object("libraryfolders").is_some());
    }

    #[test]
    fn parses_crlf_fixture_with_crlf_line_comments() {
        let fixture = include_str!("../../../../../tests/fixtures/libraryfolders.vdf");
        let input = format!(
            "// library folders, crlf\r\n{}",
            fixture.replace('\n', "\r\n")
        );
        let value = ValveKeyValueParser::parse(&input).unwrap();
        let folders = value.object("libraryfolders").unwrap();
        let first = folders.object("0").unwrap();

        assert_eq!(first.string("path"), Some("C:\\Program Files (x86)\\Steam"));
        assert!(first.object("apps").unwrap().string("730").is_some());
    }
}
