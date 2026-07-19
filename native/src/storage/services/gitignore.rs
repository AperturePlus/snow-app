use std::fs;
use std::path::{Path, PathBuf};

/// A compiled .gitignore matcher that supports the most common gitignore
/// patterns: simple globs, directory-only patterns (trailing `/`), negation
/// (`!`), root-anchored patterns (leading `/`), and double-wildcards (`**`).
///
/// This is intentionally a lightweight implementation — it does not aim for
/// 100% git compatibility, but covers the patterns typically found in real
/// projects (node_modules, dist, *.log, .env, etc.).
#[derive(Debug, Clone)]
pub struct GitignoreMatcher {
    patterns: Vec<GitignorePattern>,
}

#[derive(Debug, Clone)]
struct GitignorePattern {
    negated: bool,
    dir_only: bool,
    anchored: bool,
    segments: Vec<String>,
}

impl GitignoreMatcher {
    /// Build a matcher by reading `.gitignore` files from the given root
    /// directory and all of its parent directories (mirroring git behaviour
    /// where parent `.gitignore` files also apply).
    pub fn from_project_root(root: &Path) -> Self {
        let mut patterns = Vec::new();

        // Walk up from root to collect parent .gitignore files.
        let mut ancestors: Vec<PathBuf> = root.ancestors().map(Path::to_path_buf).collect();
        ancestors.reverse(); // outermost first

        for ancestor in &ancestors {
            let gitignore = ancestor.join(".gitignore");
            if gitignore.is_file() {
                if let Ok(content) = fs::read_to_string(&gitignore) {
                    Self::parse_into(&content, &mut patterns);
                }
            }
        }

        // Also read root .gitignore again to ensure it takes precedence
        // (patterns are evaluated in order; later patterns win for negation).
        let root_gitignore = root.join(".gitignore");
        if root_gitignore.is_file() {
            if let Ok(content) = fs::read_to_string(&root_gitignore) {
                Self::parse_into(&content, &mut patterns);
            }
        }

        Self { patterns }
    }

    fn parse_into(content: &str, patterns: &mut Vec<GitignorePattern>) {
        for line in content.lines() {
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // Remove trailing whitespace and trailing backslash escapes
            let line = line.trim_end_matches('\\').trim_end();
            if line.is_empty() {
                continue;
            }

            let mut raw = line.to_string();
            let mut negated = false;
            let mut dir_only = false;
            let mut anchored = false;

            if raw.starts_with('!') {
                negated = true;
                raw = raw[1..].to_string();
            }

            if raw.ends_with('/') {
                dir_only = true;
                raw = raw.trim_end_matches('/').to_string();
            }

            if raw.starts_with('/') {
                anchored = true;
                raw = raw.trim_start_matches('/').to_string();
            }

            if raw.is_empty() {
                continue;
            }

            // If the pattern contains a `/` (other than leading), it is
            // implicitly anchored.
            if raw.contains('/') {
                anchored = true;
            }

            let segments: Vec<String> = raw.split('/').map(String::from).collect();

            patterns.push(GitignorePattern {
                negated,
                dir_only,
                anchored,
                segments,
            });
        }
    }

    /// Returns `true` if the given relative path should be ignored.
    ///
    /// `relative_path` should use forward slashes (`/`) as separators and
    /// be relative to the project root. `is_dir` indicates whether the path
    /// is a directory.
    pub fn is_ignored(&self, relative_path: &str, is_dir: bool) -> bool {
        let path_parts: Vec<&str> = relative_path.split('/').collect();
        let mut ignored = false;

        for pattern in &self.patterns {
            if pattern.dir_only && !is_dir {
                continue;
            }

            if Self::pattern_matches(pattern, &path_parts) {
                ignored = !pattern.negated;
            }
        }

        ignored
    }

    fn pattern_matches(pattern: &GitignorePattern, path_parts: &[&str]) -> bool {
        let seg_count = pattern.segments.len();
        let path_count = path_parts.len();

        if pattern.anchored {
            // Anchored: match from the root only
            if seg_count > path_count {
                return false;
            }
            for (i, seg) in pattern.segments.iter().enumerate() {
                if !Self::segment_matches(seg, path_parts[i]) {
                    return false;
                }
            }
            // If pattern has fewer segments, it matches the directory prefix
            // and everything under it.
            true
        } else {
            // Non-anchored: match at any depth.
            // Try matching starting at each possible position.
            if seg_count > path_count {
                return false;
            }
            for start in 0..=(path_count - seg_count) {
                let mut all_match = true;
                for (i, seg) in pattern.segments.iter().enumerate() {
                    if !Self::segment_matches(seg, path_parts[start + i]) {
                        all_match = false;
                        break;
                    }
                }
                if all_match {
                    return true;
                }
            }
            false
        }
    }

    fn segment_matches(pattern_seg: &str, path_seg: &str) -> bool {
        if pattern_seg == "**" {
            return true;
        }

        // Convert glob to regex-like matching manually for * and ?
        Self::glob_match(pattern_seg, path_seg)
    }

    /// Simple glob matcher supporting `*` (any chars except none required) and
    /// `?` (exactly one char). Does not handle character classes `[abc]`.
    fn glob_match(pattern: &str, text: &str) -> bool {
        let p: Vec<char> = pattern.chars().collect();
        let t: Vec<char> = text.chars().collect();
        Self::glob_match_inner(&p, 0, &t, 0)
    }

    fn glob_match_inner(p: &[char], pi: usize, t: &[char], ti: usize) -> bool {
        if pi == p.len() {
            return ti == t.len();
        }

        match p[pi] {
            '*' => {
                // Try matching zero or more characters
                if Self::glob_match_inner(p, pi + 1, t, ti) {
                    return true;
                }
                if ti < t.len() && Self::glob_match_inner(p, pi, t, ti + 1) {
                    return true;
                }
                false
            }
            '?' => {
                if ti < t.len() {
                    Self::glob_match_inner(p, pi + 1, t, ti + 1)
                } else {
                    false
                }
            }
            c => {
                if ti < t.len() && t[ti] == c {
                    Self::glob_match_inner(p, pi + 1, t, ti + 1)
                } else {
                    false
                }
            }
        }
    }
}
