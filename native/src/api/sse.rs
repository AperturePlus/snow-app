/// Find the earliest SSE event separator in a byte buffer.
///
/// SSE events are separated by `\n\n` (LF line endings) or `\r\n\r\n`
/// (CRLF line endings). Some API servers use CRLF, which `str::find("\n\n")`
/// cannot match because the two `\n` bytes are separated by `\r`.
///
/// Using a `Vec<u8>` buffer instead of a `String` also avoids data
/// corruption when a TCP chunk boundary falls inside a multi-byte UTF-8
/// sequence (e.g. Chinese characters in tool-call arguments). With
/// `String::from_utf8_lossy` the incomplete bytes would be replaced by
/// U+FFFD, producing invalid JSON and causing the entire SSE event —
/// potentially the one carrying a `function.name` delta — to be silently
/// skipped, which in turn makes the agent loop terminate early.
///
/// Returns `(position, length)` of the separator, or `None` if not found.
pub(crate) fn find_sse_separator(buffer: &[u8]) -> Option<(usize, usize)> {
    let lf_pos = buffer.windows(2).position(|w| w == b"\n\n");
    let crlf_pos = buffer.windows(4).position(|w| w == b"\r\n\r\n");
    match (lf_pos, crlf_pos) {
        (Some(lf), Some(crlf)) => {
            if crlf < lf {
                Some((crlf, 4))
            } else {
                Some((lf, 2))
            }
        }
        (Some(lf), None) => Some((lf, 2)),
        (None, Some(crlf)) => Some((crlf, 4)),
        (None, None) => None,
    }
}
