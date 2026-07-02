use napi_derive::napi;

use crate::storage::services::git::{
    GitBranch, GitCheckoutResult, GitCommitResult, GitDiffResult, GitPushPullResult,
    GitStageResult, GitStatusResult,
};
use crate::storage::services::git_watcher::{GitChangeCallback};

#[napi]
pub async fn get_git_status(repo_path: String) -> napi::Result<GitStatusResult> {
    crate::storage::services::git::get_git_status(&repo_path)
}

#[napi]
pub async fn get_git_branches(repo_path: String) -> napi::Result<Vec<GitBranch>> {
    crate::storage::services::git::get_git_branches(&repo_path)
}

#[napi]
pub async fn git_stage_files(repo_path: String, file_paths: Vec<String>) -> napi::Result<GitStageResult> {
    crate::storage::services::git::stage_files(&repo_path, &file_paths)
}

#[napi]
pub async fn git_unstage_files(repo_path: String, file_paths: Vec<String>) -> napi::Result<GitStageResult> {
    crate::storage::services::git::unstage_files(&repo_path, &file_paths)
}

#[napi]
pub async fn git_stage_all(repo_path: String) -> napi::Result<GitStageResult> {
    crate::storage::services::git::stage_all(&repo_path)
}

#[napi]
pub async fn git_unstage_all(repo_path: String) -> napi::Result<GitStageResult> {
    crate::storage::services::git::unstage_all(&repo_path)
}

#[napi]
pub async fn git_commit(repo_path: String, message: String) -> napi::Result<GitCommitResult> {
    crate::storage::services::git::commit_changes(&repo_path, &message)
}

#[napi]
pub async fn git_push(repo_path: String) -> napi::Result<GitPushPullResult> {
    crate::storage::services::git::push_changes(&repo_path)
}

#[napi]
pub async fn git_pull(repo_path: String) -> napi::Result<GitPushPullResult> {
    crate::storage::services::git::pull_changes(&repo_path)
}

#[napi]
pub async fn git_checkout(repo_path: String, branch_name: String) -> napi::Result<GitCheckoutResult> {
    crate::storage::services::git::checkout_branch(&repo_path, &branch_name)
}

#[napi]
pub async fn git_file_diff(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> napi::Result<GitDiffResult> {
    crate::storage::services::git::get_file_diff(&repo_path, &file_path, staged)
}

#[napi(
    ts_args_type = "repoPath: string, onChange: (repoPath: string) => void",
    ts_return_type = "void"
)]
pub fn start_git_watch(
    repo_path: String,
    on_change: GitChangeCallback,
) -> napi::Result<()> {
    crate::storage::services::git_watcher::start_git_watch(repo_path, on_change)
}

#[napi]
pub fn stop_git_watch(repo_path: String) -> napi::Result<()> {
    crate::storage::services::git_watcher::stop_git_watch(repo_path)
}
