use crate::modules::local_library::domain::valve_value::ValveParseError;

/// A lexical token in the Valve KeyValues format.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
pub(crate) enum Token {
    String(String),
    LBrace,
    RBrace,
}

/// Splits Valve KeyValues input into tokens.
///
/// Handles quoted strings (decoding `\\` and `\"`), unquoted tokens, `{` and
/// `}` braces, whitespace, and `//` line comments. Quoted strings may carry
/// any UTF-8 text; unquoted tokens run until whitespace, a brace, or a
/// comment. An unterminated string is reported as
/// [`ValveParseError::UnexpectedEndOfInput`].
#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
pub(crate) struct Tokenizer<'a> {
    input: &'a [u8],
    pos: usize,
}

#[allow(dead_code)] // consumed by Task 5 composition root (via the manifest reader)
impl<'a> Tokenizer<'a> {
    pub(crate) fn new(input: &'a str) -> Self {
        // Strip a leading UTF-8 byte-order mark. Windows Notepad writes one
        // when saving UTF-8, and it would otherwise merge into the first
        // unquoted token, silently corrupting the root key.
        let input = input.strip_prefix('\u{feff}').unwrap_or(input);
        Self {
            input: input.as_bytes(),
            pos: 0,
        }
    }

    /// Returns the next token, or `None` at end of input.
    pub(crate) fn next_token(&mut self) -> Result<Option<Token>, ValveParseError> {
        self.skip_whitespace_and_comments();
        let Some(&byte) = self.input.get(self.pos) else {
            return Ok(None);
        };
        match byte {
            b'{' => {
                self.pos += 1;
                Ok(Some(Token::LBrace))
            }
            b'}' => {
                self.pos += 1;
                Ok(Some(Token::RBrace))
            }
            b'"' => self.read_quoted_string().map(Some),
            _ => self.read_unquoted_token().map(Some),
        }
    }

    fn skip_whitespace_and_comments(&mut self) {
        loop {
            while self
                .input
                .get(self.pos)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                self.pos += 1;
            }
            if self.input[self.pos..].starts_with(b"//") {
                while let Some(byte) = self.input.get(self.pos) {
                    if *byte == b'\n' {
                        break;
                    }
                    self.pos += 1;
                }
                continue;
            }
            break;
        }
    }

    /// Reads a quoted string; `self.pos` points at the opening quote.
    fn read_quoted_string(&mut self) -> Result<Token, ValveParseError> {
        self.pos += 1;
        let mut bytes = Vec::new();
        loop {
            let Some(&byte) = self.input.get(self.pos) else {
                return Err(ValveParseError::UnexpectedEndOfInput);
            };
            self.pos += 1;
            match byte {
                b'"' => return Ok(Token::String(self.utf8_string(bytes))),
                b'\\' => {
                    let Some(&escaped) = self.input.get(self.pos) else {
                        return Err(ValveParseError::UnexpectedEndOfInput);
                    };
                    self.pos += 1;
                    match escaped {
                        b'\\' => bytes.push(b'\\'),
                        b'"' => bytes.push(b'"'),
                        // Unknown escapes are kept verbatim; the bounded
                        // parser only decodes backslashes and quotes.
                        other => {
                            bytes.push(b'\\');
                            bytes.push(other);
                        }
                    }
                }
                byte => bytes.push(byte),
            }
        }
    }

    /// Reads an unquoted token; `self.pos` points at its first byte.
    fn read_unquoted_token(&mut self) -> Result<Token, ValveParseError> {
        let start = self.pos;
        while let Some(&byte) = self.input.get(self.pos) {
            if byte.is_ascii_whitespace()
                || byte == b'{'
                || byte == b'}'
                || (byte == b'/' && self.input.get(self.pos + 1) == Some(&b'/'))
            {
                break;
            }
            self.pos += 1;
        }
        Ok(Token::String(
            self.utf8_string(self.input[start..self.pos].to_vec()),
        ))
    }

    fn utf8_string(&self, bytes: Vec<u8>) -> String {
        // The input is a &str and tokens only ever split at ASCII delimiters,
        // so the collected bytes stay valid UTF-8.
        String::from_utf8(bytes).expect("input is valid UTF-8")
    }
}

#[cfg(test)]
mod tests {
    use super::{Token, Tokenizer};
    use crate::modules::local_library::domain::valve_value::ValveParseError;

    fn tokens(input: &str) -> Result<Vec<Token>, ValveParseError> {
        let mut tokenizer = Tokenizer::new(input);
        let mut tokens = Vec::new();
        while let Some(token) = tokenizer.next_token()? {
            tokens.push(token);
        }
        Ok(tokens)
    }

    #[test]
    fn tokenizes_braces_quoted_and_unquoted_tokens() {
        assert_eq!(
            tokens(r#"{"a" b}"#).unwrap(),
            vec![
                Token::LBrace,
                Token::String("a".into()),
                Token::String("b".into()),
                Token::RBrace,
            ]
        );
    }

    #[test]
    fn skips_whitespace_and_line_comments() {
        assert_eq!(
            tokens("// lead\n\"a\" // trailing\n\t\"b\"").unwrap(),
            vec![Token::String("a".into()), Token::String("b".into())]
        );
    }

    #[test]
    fn decodes_escaped_backslashes_and_quotes_in_strings() {
        assert_eq!(
            tokens(r#""C:\\Steam" "say \"hi\"""#).unwrap(),
            vec![
                Token::String(r#"C:\Steam"#.into()),
                Token::String("say \"hi\"".into()),
            ]
        );
    }

    #[test]
    fn strips_a_leading_utf8_bom() {
        assert_eq!(
            tokens("\u{feff}\"a\"").unwrap(),
            vec![Token::String("a".into())]
        );
        assert_eq!(
            tokens("\u{feff}unquoted").unwrap(),
            vec![Token::String("unquoted".into())]
        );
    }

    #[test]
    fn rejects_an_unterminated_string() {
        assert_eq!(
            tokens(r#""unterminated"#).unwrap_err(),
            ValveParseError::UnexpectedEndOfInput
        );
    }
}
