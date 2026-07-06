use std::path::PathBuf;

use napi_derive::napi;

#[napi(object)]
pub struct DetectedTerminal {
    pub name: String,
    pub path: String,
    pub family: String,
}

const POWERSHELL_CORE_PATHS: &[&str] = &[
    r"C:\Program Files\PowerShell\7\pwsh.exe",
    r"C:\Program Files\PowerShell\6\pwsh.exe",
];

/// Well-known Git Bash installation roots across common drives.
/// Each entry is (drive_letter) — we build `<drive>:\Program Files\Git` and
/// `<drive>:\Program Files (x86)\Git` from them.
const GIT_BASH_DRIVES: &[char] = &['C', 'D'];

fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

fn check_executable_in_path(exe: &str, path_env: &str) -> Option<String> {
    let sep = if is_windows() { ';' } else { ':' };
    let extensions: &[&str] = if is_windows() {
        &["", ".exe", ".bat", ".cmd"]
    } else {
        &[""]
    };

    for dir in path_env.split(sep) {
        if dir.is_empty() {
            continue;
        }
        for ext in extensions {
            let mut candidate = PathBuf::from(dir);
            candidate.push(format!("{}{}", exe, ext));
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Try to locate Git Bash by deriving the Git root from `git.exe` in PATH.
/// If `git.exe` is at `<root>\cmd\git.exe`, then `bash.exe` is at
/// `<root>\bin\bash.exe`.
fn find_git_bash_from_git_in_path(path_env: &str) -> Option<String> {
    let git_exe = check_executable_in_path("git", path_env)?;
    // git_exe = <root>\cmd\git.exe  →  parent.parent = <root>
    let git_path = PathBuf::from(&git_exe);
    let root = git_path
        .parent() // <root>\cmd
        .and_then(|p| p.parent())?; // <root>
    let bash = root.join("bin").join("bash.exe");
    if bash.exists() {
        Some(bash.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Check well-known Git Bash installation directories across drives.
fn find_git_bash_well_known() -> Option<String> {
    for drive in GIT_BASH_DRIVES {
        for prog in &["Program Files", "Program Files (x86)"] {
            let bash = PathBuf::from(format!("{}:\\{}\\Git\\bin\\bash.exe", drive, prog));
            if bash.exists() {
                return Some(bash.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn detect_windows_terminals() -> Vec<DetectedTerminal> {
    let mut results: Vec<DetectedTerminal> = Vec::new();
    let path_env = std::env::var("PATH").unwrap_or_default();

    // PowerShell Core (pwsh.exe) at well-known paths
    for core_path in POWERSHELL_CORE_PATHS {
        if PathBuf::from(core_path).exists() {
            results.push(DetectedTerminal {
                name: "PowerShell Core".to_string(),
                path: core_path.to_string(),
                family: "powershell".to_string(),
            });
        }
    }

    // Windows built-in candidates via PATH lookup
    let windows_candidates: &[(&str, &str, &str)] = &[
        ("PowerShell", "powershell.exe", "powershell"),
        ("Command Prompt", "cmd.exe", "cmd"),
        ("WSL Bash", "wsl.exe", "posix"),
    ];

    for (name, exe, family) in windows_candidates {
        if let Some(found) = check_executable_in_path(exe, &path_env) {
            results.push(DetectedTerminal {
                name: name.to_string(),
                path: found,
                family: family.to_string(),
            });
        }
    }

    // Git Bash — try deriving from git.exe location in PATH first
    if let Some(bash_path) = find_git_bash_from_git_in_path(&path_env) {
        let already_listed = results.iter().any(|r| r.path == bash_path);
        if !already_listed {
            results.push(DetectedTerminal {
                name: "Git Bash".to_string(),
                path: bash_path,
                family: "posix".to_string(),
            });
        }
    }

    // Git Bash — fallback to well-known installation paths
    if !results.iter().any(|r| r.name == "Git Bash") {
        if let Some(bash_path) = find_git_bash_well_known() {
            results.push(DetectedTerminal {
                name: "Git Bash".to_string(),
                path: bash_path,
                family: "posix".to_string(),
            });
        }
    }

    // COMSPEC fallback
    if let Ok(comspec) = std::env::var("COMSPEC") {
        if !comspec.is_empty() && PathBuf::from(&comspec).exists() {
            let already_listed = results.iter().any(|r| r.path == comspec);
            if !already_listed {
                results.push(DetectedTerminal {
                    name: "Command Prompt".to_string(),
                    path: comspec,
                    family: "cmd".to_string(),
                });
            }
        }
    }

    results
}

fn detect_posix_terminals() -> Vec<DetectedTerminal> {
    let mut results: Vec<DetectedTerminal> = Vec::new();
    let path_env = std::env::var("PATH").unwrap_or_default();

    let posix_candidates: &[(&str, &str, &str)] = &[
        ("zsh", "zsh", "posix"),
        ("bash", "bash", "posix"),
        ("fish", "fish", "posix"),
        ("sh", "sh", "posix"),
    ];

    for (name, exe, family) in posix_candidates {
        if let Some(found) = check_executable_in_path(exe, &path_env) {
            let already_listed = results.iter().any(|r| r.path == found);
            if !already_listed {
                results.push(DetectedTerminal {
                    name: name.to_string(),
                    path: found,
                    family: family.to_string(),
                });
            }
        }
    }

    // $SHELL fallback
    if let Ok(shell_env) = std::env::var("SHELL") {
        if !shell_env.is_empty() && PathBuf::from(&shell_env).exists() {
            let already_listed = results.iter().any(|r| r.path == shell_env);
            if !already_listed {
                results.push(DetectedTerminal {
                    name: "Default shell ($SHELL)".to_string(),
                    path: shell_env,
                    family: "posix".to_string(),
                });
            }
        }
    }

    results
}

#[napi]
pub fn detect_terminals() -> napi::Result<Vec<DetectedTerminal>> {
    let terminals = if is_windows() {
        detect_windows_terminals()
    } else {
        detect_posix_terminals()
    };
    Ok(terminals)
}
