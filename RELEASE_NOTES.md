# Release Notes

## v0.1.12

## New Features

- **macOS Unsigned Update Flow**: Implemented a full update pipeline for unsigned macOS builds — generates a `latest-mac.json` manifest with SHA-256 checksums per architecture, fetches and verifies updates in Rust before applying, and falls back to ad-hoc identity signing so unsigned builds can auto-update without a Developer ID certificate.
- **On-Demand Bash Subprocess Cancellation**: Every bash command now streams a `tool_execution` ID, enabling a Stop button in the UI and allowing session abort/rollback to kill the entire process tree of a running command.
- **WSL Git Support**: Git commands now run through `wsl.exe` when the configured terminal shell is WSL, with proper argument quoting and UNC path conversion.

## Improvements

- **Non-SSE Stream Retries Moved to Rust**: The entire Gemini/Responses request+stream cycle is wrapped in a single retry loop so non-SSE responses (HTTP 200 JSON errors or empty streams) are retried at the Rust level instead of being returned to the JS agent loop.
- **Git Commands Offloaded to Blocking Pool**: NAPI git exports now use `spawn_blocking`, preventing repo operations from blocking the async runtime.
- **Conversation History Load Deduplication**: Switching away and back while a conversation's initial history is still loading no longer discards the in-flight result or issues a duplicate re-fetch — selections share a single load promise and cache the result for instant reuse.
- **Session-Scoped Working Directories**: Tool execution, checkpoint creation, and hook cwd are now bound to the session's own directory rather than the runtime active directory, keeping checkpoints consistent even after switching projects.
- **Plan Mode Approval Migration**: Migrated Plan Mode approval from the standalone plan-mode server to the unified `app-control` request-approval flow.
- **TODO Panel Rework**: Replaced checkbox multi-select with inline add and click-to-cycle status for a cleaner, faster workflow.
- **File Type Icons**: Added file type icons in right-panel tabs and the diff viewer.
- **Release Notes Automation**: GitHub Releases now automatically extracts version-specific changelog content from `RELEASE_NOTES.md` instead of relying on manual input that was lost on tag-triggered builds.

## Bug Fixes

- **Reasoning Item Round-Tripping**: Added `collect_reasoning_items` to properly preserve reasoning output items across requests when `store: false`, preventing reasoning context loss in multi-turn conversations.
