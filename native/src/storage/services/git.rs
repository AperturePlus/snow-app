use std::path::Path;
use std::process::Command;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ===== NAPI Types =====

#[napi(object)]
pub struct GitFileStatus {
    pub path: String,
    pub old_path: Option<String>,
    pub index_status: String,
    pub workdir_status: String,
    pub status: String,
}

#[napi(object)]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub current_branch: String,
    pub upstream: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub files: Vec<GitFileStatus>,
    pub staged_count: i32,
    pub unstaged_count: i32,
    pub untracked_count: i32,
}

#[napi(object)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub remote_name: Option<String>,
}

#[napi(object)]
pub struct GitDiffResult {
    pub content: String,
    pub is_binary: bool,
}

#[napi(object)]
pub struct GitStageResult {
    pub success: bool,
    pub message: String,
}

#[napi(object)]
pub struct GitCommitResult {
    pub success: bool,
    pub message: String,
    pub hash: Option<String>,
}

#[napi(object)]
pub struct GitPushPullResult {
    pub success: bool,
    pub message: String,
}

#[napi(object)]
pub struct GitCheckoutResult {
    pub success: bool,
    pub message: String,
}

// ===== Internal helpers =====

fn run_git(repo_path: &str, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(repo_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .map_err(|e| Error::from_reason(format!("Failed to execute git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let err_msg = if stderr.is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(Error::from_reason(err_msg));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn is_git_repo(repo_path: &str) -> bool {
    Path::new(repo_path).join(".git").exists()
}

fn parse_status_char(c: char) -> String {
    if c == ' ' {
        return String::new();
    }
    c.to_string()
}

fn derive_display_status(index_status: &str, workdir_status: &str) -> String {
    if index_status == "R" {
        return "R".to_string();
    }
    if index_status == "C" {
        return "C".to_string();
    }
    if workdir_status == "?" {
        return "U".to_string();
    }
    if workdir_status == "!" {
        return "I".to_string();
    }
    if index_status == "A" {
        return "A".to_string();
    }
    if index_status == "M" {
        return "M".to_string();
    }
    if index_status == "D" {
        return "D".to_string();
    }
    if workdir_status == "M" {
        return "M".to_string();
    }
    if workdir_status == "D" {
        return "D".to_string();
    }
    if !index_status.is_empty() && !workdir_status.is_empty() {
        return "MM".to_string();
    }
    if !index_status.is_empty() {
        return index_status.to_string();
    }
    if !workdir_status.is_empty() {
        return workdir_status.to_string();
    }
    "?".to_string()
}

// ===== Public API =====

pub fn get_git_status(repo_path: &str) -> Result<GitStatusResult> {
    if !is_git_repo(repo_path) {
        return Ok(GitStatusResult {
            is_repo: false,
            current_branch: String::new(),
            upstream: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
        });
    }

    let status_out = run_git(repo_path, &["status", "--porcelain=v1", "-b", "--find-renames"])?;
    let lines: Vec<&str> = status_out.lines().filter(|l| !l.is_empty()).collect();

    let mut current_branch = String::new();
    let mut upstream: Option<String> = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files: Vec<GitFileStatus> = Vec::new();

    for line in &lines {
        if line.starts_with("## ") {
            let branch_part = &line[3..];

            // Parse upstream
            if let Some(idx) = branch_part.find("...") {
                let after = &branch_part[idx + 3..];
                let upstream_name = after.split_whitespace().next().unwrap_or("");
                if !upstream_name.is_empty() {
                    upstream = Some(upstream_name.to_string());
                }
            }

            // Parse ahead/behind
            let lower = branch_part.to_lowercase();
            if let Some(ahead_pos) = lower.find("ahead ") {
                let rest = &branch_part[ahead_pos + 6..];
                if let Some(end) = rest.find(|c: char| !c.is_ascii_digit()) {
                    ahead = rest[..end].parse().unwrap_or(0);
                } else {
                    ahead = rest.parse().unwrap_or(0);
                }
            }
            if let Some(behind_pos) = lower.find("behind ") {
                let rest = &branch_part[behind_pos + 7..];
                if let Some(end) = rest.find(|c: char| !c.is_ascii_digit()) {
                    behind = rest[..end].parse().unwrap_or(0);
                } else {
                    behind = rest.parse().unwrap_or(0);
                }
            }

            // Parse branch name
            let branch_name_raw: &str = if let Some(idx) = branch_part.find("...") {
                &branch_part[..idx]
            } else {
                let end = branch_part.find(' ').unwrap_or(branch_part.len());
                &branch_part[..end]
            };

            if branch_name_raw.starts_with("HEAD") {
                current_branch = "HEAD".to_string();
            } else {
                current_branch = branch_name_raw.to_string();
            }
            continue;
        }

        // File status lines: XY <path>
        if line.len() < 3 {
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let index_status = parse_status_char(chars[0]);
        let workdir_status = parse_status_char(chars[1]);
        let rest = &line[3..];

        let mut file_path = rest.to_string();
        let mut old_path: Option<String> = None;

        if let Some(arrow_idx) = rest.find(" -> ") {
            old_path = Some(rest[..arrow_idx].to_string());
            file_path = rest[arrow_idx + 4..].to_string();
        }

        // Strip surrounding quotes
        if file_path.starts_with('"') && file_path.ends_with('"') && file_path.len() >= 2 {
            file_path = file_path[1..file_path.len() - 1].to_string();
        }

        files.push(GitFileStatus {
            path: file_path,
            old_path,
            index_status: chars[0].to_string(),
            workdir_status: chars[1].to_string(),
            status: derive_display_status(&index_status, &workdir_status),
        });
    }

    let mut staged_count = 0;
    let mut unstaged_count = 0;
    let mut untracked_count = 0;

    for f in &files {
        if f.workdir_status == "?" || f.workdir_status == "!" {
            untracked_count += 1;
        } else {
            if !f.index_status.is_empty() && f.index_status != " " && f.index_status != "?" {
                staged_count += 1;
            }
            if !f.workdir_status.is_empty() && f.workdir_status != " " && f.workdir_status != "?" {
                unstaged_count += 1;
            }
        }
    }

    Ok(GitStatusResult {
        is_repo: true,
        current_branch,
        upstream,
        ahead,
        behind,
        files,
        staged_count,
        unstaged_count,
        untracked_count,
    })
}

pub fn get_git_branches(repo_path: &str) -> Result<Vec<GitBranch>> {
    if !is_git_repo(repo_path) {
        return Ok(Vec::new());
    }

    let output = run_git(
        repo_path,
        &[
            "branch",
            "--list",
            "--all",
            "--format=%(HEAD)%(refname:short) %(objectname:short) %(upstream:short)",
        ],
    )?;

    let mut branches: Vec<GitBranch> = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_current = trimmed.starts_with('*');
        let rest = if is_current {
            trimmed[1..].trim_start()
        } else {
            trimmed
        };

        let parts: Vec<&str> = rest.split_whitespace().collect();
        let name = match parts.first() {
            Some(n) => *n,
            None => continue,
        };

        if name == "HEAD" {
            continue;
        }

        let is_remote = name.contains('/');
        let remote_name = if is_remote {
            let slash_idx = name.find('/').unwrap();
            Some(name[..slash_idx].to_string())
        } else {
            None
        };

        branches.push(GitBranch {
            name: name.to_string(),
            is_current,
            is_remote,
            remote_name,
        });
    }

    Ok(branches)
}

pub fn stage_files(repo_path: &str, file_paths: &[String]) -> Result<GitStageResult> {
    if file_paths.is_empty() {
        return Ok(GitStageResult {
            success: true,
            message: "No files to stage".to_string(),
        });
    }

    let args: Vec<&str> = file_paths.iter().map(|s| s.as_str()).collect();
    let mut full_args = vec!["add", "--"];
    full_args.extend(args);

    match run_git(repo_path, &full_args) {
        Ok(_) => Ok(GitStageResult {
            success: true,
            message: "Files staged successfully".to_string(),
        }),
        Err(e) => Ok(GitStageResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn unstage_files(repo_path: &str, file_paths: &[String]) -> Result<GitStageResult> {
    if file_paths.is_empty() {
        return Ok(GitStageResult {
            success: true,
            message: "No files to unstage".to_string(),
        });
    }

    let args: Vec<&str> = file_paths.iter().map(|s| s.as_str()).collect();
    let mut full_args = vec!["reset", "HEAD", "--"];
    full_args.extend(args);

    match run_git(repo_path, &full_args) {
        Ok(_) => Ok(GitStageResult {
            success: true,
            message: "Files unstaged successfully".to_string(),
        }),
        Err(e) => Ok(GitStageResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn stage_all(repo_path: &str) -> Result<GitStageResult> {
    match run_git(repo_path, &["add", "--all"]) {
        Ok(_) => Ok(GitStageResult {
            success: true,
            message: "All changes staged".to_string(),
        }),
        Err(e) => Ok(GitStageResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn unstage_all(repo_path: &str) -> Result<GitStageResult> {
    match run_git(repo_path, &["reset", "HEAD"]) {
        Ok(_) => Ok(GitStageResult {
            success: true,
            message: "All changes unstaged".to_string(),
        }),
        Err(e) => Ok(GitStageResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn commit_changes(repo_path: &str, message: &str) -> Result<GitCommitResult> {
    if message.trim().is_empty() {
        return Ok(GitCommitResult {
            success: false,
            message: "Commit message is required".to_string(),
            hash: None,
        });
    }

    match run_git(repo_path, &["commit", "-m", message]) {
        Ok(_) => {
            let hash = run_git(repo_path, &["rev-parse", "HEAD"])
                .ok()
                .and_then(|s| {
                    let trimmed = s.trim();
                    if trimmed.len() >= 8 {
                        Some(trimmed[..8].to_string())
                    } else {
                        Some(trimmed.to_string())
                    }
                });

            Ok(GitCommitResult {
                success: true,
                message: "Commit successful".to_string(),
                hash,
            })
        }
        Err(e) => Ok(GitCommitResult {
            success: false,
            message: format!("{e}"),
            hash: None,
        }),
    }
}

pub fn push_changes(repo_path: &str) -> Result<GitPushPullResult> {
    match run_git(repo_path, &["push"]) {
        Ok(stdout) => {
            let msg = if stdout.trim().is_empty() {
                "Push successful".to_string()
            } else {
                stdout.trim().to_string()
            };
            Ok(GitPushPullResult {
                success: true,
                message: msg,
            })
        }
        Err(e) => Ok(GitPushPullResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn pull_changes(repo_path: &str) -> Result<GitPushPullResult> {
    match run_git(repo_path, &["pull"]) {
        Ok(stdout) => {
            let msg = if stdout.trim().is_empty() {
                "Pull successful".to_string()
            } else {
                stdout.trim().to_string()
            };
            Ok(GitPushPullResult {
                success: true,
                message: msg,
            })
        }
        Err(e) => Ok(GitPushPullResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn checkout_branch(repo_path: &str, branch_name: &str) -> Result<GitCheckoutResult> {
    // If the branch name contains '/', it's a remote tracking branch (e.g. "origin/main").
    // Running `git checkout origin/main` would enter detached HEAD state.
    // Instead, extract the local branch name and create a tracking branch.
    if let Some(slash_idx) = branch_name.find('/') {
        let local_name = &branch_name[slash_idx + 1..];

        if !local_name.is_empty() {
            // First, try to checkout the local branch (it may already exist).
            if let Ok(_) = run_git(repo_path, &["checkout", local_name]) {
                return Ok(GitCheckoutResult {
                    success: true,
                    message: format!("Switched to {local_name}"),
                });
            }

            // Local branch doesn't exist; create a new tracking branch.
            match run_git(repo_path, &["checkout", "-b", local_name, branch_name]) {
                Ok(_) => {
                    return Ok(GitCheckoutResult {
                        success: true,
                        message: format!("Switched to {local_name} (tracking {branch_name})"),
                    })
                }
                Err(e) => {
                    return Ok(GitCheckoutResult {
                        success: false,
                        message: format!("{e}"),
                    })
                }
            }
        }
    }

    // Local branch: checkout directly.
    match run_git(repo_path, &["checkout", branch_name]) {
        Ok(_) => Ok(GitCheckoutResult {
            success: true,
            message: format!("Switched to {branch_name}"),
        }),
        Err(e) => Ok(GitCheckoutResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

pub fn get_file_diff(repo_path: &str, file_path: &str, staged: bool) -> Result<GitDiffResult> {
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", file_path]
    } else {
        vec!["diff", "--", file_path]
    };

    match run_git(repo_path, &args) {
        Ok(stdout) => {
            if stdout.contains("Binary files") {
                // Git's heuristic may falsely flag text files as binary
                // (e.g. files containing NUL bytes). Retry with --text
                // to force a text-mode diff.
                let text_args: Vec<&str> = if staged {
                    vec!["diff", "--cached", "--text", "--", file_path]
                } else {
                    vec!["diff", "--text", "--", file_path]
                };
                match run_git(repo_path, &text_args) {
                    Ok(text_diff) if !text_diff.is_empty() => {
                        return Ok(GitDiffResult {
                            content: text_diff,
                            is_binary: false,
                        });
                    }
                    _ => {
                        return Ok(GitDiffResult {
                            content: "Binary file - diff not available".to_string(),
                            is_binary: true,
                        });
                    }
                }
            }

            // If no diff and not staged, try untracked file diff
            if !staged && stdout.is_empty() {
                let no_index_args = vec!["diff", "--no-index", "--text", "/dev/null", file_path];
                let full_diff = run_git(repo_path, &no_index_args).unwrap_or_default();
                if !full_diff.is_empty() {
                    return Ok(GitDiffResult {
                        content: full_diff,
                        is_binary: false,
                    });
                }
            }

            Ok(GitDiffResult {
                content: stdout,
                is_binary: false,
            })
        }
        Err(e) => Ok(GitDiffResult {
            content: format!("{e}"),
            is_binary: false,
        }),
    }
}
