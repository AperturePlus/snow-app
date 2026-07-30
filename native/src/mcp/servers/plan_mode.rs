use napi::bindgen_prelude::*;
use serde_json::{json, Value};

use super::super::service::McpService;
use super::super::tools::McpTool;
use super::user_interaction::{UserQuestionCallback, UserQuestionCommand};

pub const SERVER_ID: &str = "plan-mode";
pub const TOOL_NAME: &str = "requestApproval";

const APPROVE_OPTION: &str = "Approve and execute the plan";
const KEEP_PLANNING_OPTION: &str = "Keep planning";

pub struct PlanModeService;

impl PlanModeService {
    pub fn new() -> Self {
        PlanModeService
    }

    pub async fn execute_async(
        &self,
        args: &Value,
        on_question: &UserQuestionCallback,
    ) -> napi::Result<Value> {
        let plan_summary = required_plan_summary(args)?;
        let command = UserQuestionCommand {
            question: plan_summary.clone(),
            options: vec![
                APPROVE_OPTION.to_string(),
                KEEP_PLANNING_OPTION.to_string(),
            ],
        };

        let promise = on_question
            .call_async_catch(command)
            .await
            .map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to dispatch Plan Mode approval to Electron: {error}"),
                )
            })?;
        let answer_json = promise.await.map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Plan Mode approval failed: {error}"),
            )
        })?;
        let answer: Value = serde_json::from_str(&answer_json).map_err(|error| {
            Error::new(
                Status::InvalidArg,
                format!("Plan Mode approval result must be valid JSON: {error}"),
            )
        })?;
        let answer = answer.as_object().ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "Plan Mode approval result must be a JSON object".to_string(),
            )
        })?;
        let cancelled = answer
            .get("cancelled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let selected_options = answer
            .get("selectedOptions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let approved = !cancelled
            && selected_options
                .iter()
                .any(|option| option.as_str() == Some(APPROVE_OPTION));

        Ok(json!({
            "approved": approved,
            "cancelled": cancelled,
            "planSummary": plan_summary,
        }))
    }
}

impl McpService for PlanModeService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![McpTool {
            server_id: SERVER_ID.to_string(),
            name: TOOL_NAME.to_string(),
            description: "Request the user's explicit approval to execute the completed implementation plan. In Plan Mode, call this dedicated tool after the plan is ready and before calling filesystem-replace_edit or filesystem-create. The tool returns a structured `approved` boolean; no wording or keyword in a normal chat response can unlock file editing. Call this tool by itself and wait for the user's decision."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "planSummary": {
                        "type": "string",
                        "minLength": 1,
                        "description": "A concise summary of the complete plan, including key changes and important risks, shown to the user before approval."
                    }
                },
                "required": ["planSummary"]
            }),
        }]
    }

    fn execute(&self, tool_name: &str, _args: &Value) -> napi::Result<Value> {
        match tool_name {
            TOOL_NAME => Err(Error::new(
                Status::GenericFailure,
                "requestApproval must be executed through the asynchronous Electron interaction bridge"
                    .to_string(),
            )),
            _ => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unknown tool: \"{tool_name}\" for MCP server \"{SERVER_ID}\". Available tools: [{SERVER_ID}-{TOOL_NAME}]"
                ),
            )),
        }
    }
}

fn required_plan_summary(args: &Value) -> napi::Result<String> {
    let summary = args
        .as_object()
        .and_then(|object| object.get("planSummary"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "planSummary is required for plan-mode-requestApproval".to_string(),
            )
        })?;

    Ok(summary.to_string())
}
