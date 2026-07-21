use napi_derive::napi;

use crate::api::commit_message::generate_commit_message_stream;
use crate::api::responses::{ResponsesApiResult, ResponsesApiStreamCallback};
use crate::storage::services::git::{
    GitBranch, GitCheckoutResult, GitCommitFile, GitCommitResult, GitDiffResult,
    GitLogEntry, GitPushPullResult, GitStageResult, GitStatusResult,
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
pub async fn git_create_branch(
    repo_path: String,
    branch_name: String,
) -> napi::Result<GitCheckoutResult> {
    crate::storage::services::git::create_branch(&repo_path, &branch_name)
}

#[napi]
pub async fn git_file_diff(
    repo_path: String,
    file_path: String,
    staged: bool,
) -> napi::Result<GitDiffResult> {
    crate::storage::services::git::get_file_diff(&repo_path, &file_path, staged)
}

#[napi]
pub async fn git_discard_changes(
    repo_path: String,
    file_paths: Vec<String>,
) -> napi::Result<GitStageResult> {
    crate::storage::services::git::discard_changes(&repo_path, &file_paths)
}

#[napi]
pub async fn get_git_log(
    repo_path: String,
    skip: i32,
    limit: i32,
) -> napi::Result<Vec<GitLogEntry>> {
    crate::storage::services::git::get_git_log(&repo_path, skip, limit)
}

#[napi]
pub async fn get_git_commit_files(
    repo_path: String,
    hash: String,
) -> napi::Result<Vec<GitCommitFile>> {
    crate::storage::services::git::get_commit_files(&repo_path, &hash)
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

/// Generate a commit message from the staged diff using the active API
/// config's **basic model**. Dispatches to whichever provider (chat /
/// responses / anthropic / gemini) the active config specifies.
///
/// - `repoPath`: git repository path (used to run `git diff --cached`)
/// - `onChunk`: streaming callback receiving `ResponsesApiStreamChunk`
/// - `streamId`: unique stream id for cancellation support
///
/// Returns the full `ResponsesApiResult` (`.content` holds the message).
#[napi(
    ts_args_type = "repoPath: string, onChunk: (chunk: ResponsesApiStreamChunk) => void, streamId: string",
    ts_return_type = "Promise<ResponsesApiResult>"
)]
pub async fn generate_commit_message(
    repo_path: String,
    on_chunk: ResponsesApiStreamCallback,
    stream_id: String,
) -> napi::Result<ResponsesApiResult> {
    // 1. Get staged diff (blocking git command in spawn_blocking)
    let staged_diff = tokio::task::spawn_blocking(move || {
        crate::storage::services::git::get_staged_diff(&repo_path)
    })
    .await
    .map_err(|join_error| {
        napi::Error::from_reason(format!("Failed to get staged diff: {join_error}"))
    })??;

    if staged_diff.trim().is_empty() {
        return Err(napi::Error::from_reason(
            "No staged changes found. Please stage your changes first.",
        ));
    }

    // 2. Register cancellation token
    let cancel_token = crate::api::cancel::create_and_register(&stream_id);

    // 3. Stream commit message generation
    let result = generate_commit_message_stream(staged_diff, on_chunk, cancel_token).await;

    // 4. Unregister stream
    crate::api::cancel::unregister_stream(&stream_id);

    result
}

