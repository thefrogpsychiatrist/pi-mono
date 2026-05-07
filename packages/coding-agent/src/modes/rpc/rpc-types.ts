/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { SessionStats } from "../../core/agent-session.js";
import type { BashResult } from "../../core/bash-executor.js";
import type { CompactionResult } from "../../core/compaction/index.js";
import type {
	BlueprintApplyResult,
	BlueprintPreview,
	BlueprintRequest,
	PluginInstallRequest,
	PluginRemoveRequest,
	PluginRemoveResult,
	PluginSkillAuditEntry,
	PluginSkillAuditQuery,
	PluginSkillAuditState,
	PluginSkillCatalogQuery,
	PluginSkillCatalogResult,
	PluginSkillDiscoveryState,
	PluginSkillSettingsState,
	PluginSkillSettingsUpdate,
	PluginStatus,
	PluginToggleRequest,
	SkillBundleInstallRequest,
	SkillBundleRemoveRequest,
	SkillBundleRemoveResult,
	SkillStatus,
	SkillToggleRequest,
	SourceAuthConfig,
	SourceAuthRequest,
} from "../../core/plugin-skill-types.js";
import type { SourceInfo } from "../../core/source-info.js";

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "new_session"; parentSession?: string }

	// State
	| { id?: string; type: "get_state" }

	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }

	// Thinking
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }

	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }

	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }

	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }

	// Bash
	| { id?: string; type: "bash"; command: string }
	| { id?: string; type: "abort_bash" }

	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }

	// Messages
	| { id?: string; type: "get_messages" }

	// Commands (available for invocation via prompt)
	| { id?: string; type: "get_commands" }

	// Plugin/Skill management
	| { id?: string; type: "get_plugin_skill_state" }
	| { id?: string; type: "toggle_plugin"; request: PluginToggleRequest }
	| { id?: string; type: "toggle_skill"; request: SkillToggleRequest }
	| { id?: string; type: "get_plugin_skill_audit"; query?: PluginSkillAuditQuery }
	| { id?: string; type: "get_plugin_skill_catalog"; query?: PluginSkillCatalogQuery }
	| { id?: string; type: "install_plugin"; request: PluginInstallRequest }
	| { id?: string; type: "update_plugin"; source: string; actor?: string }
	| { id?: string; type: "remove_plugin"; request: PluginRemoveRequest }
	| { id?: string; type: "install_skill_bundle"; request: SkillBundleInstallRequest }
	| { id?: string; type: "remove_skill_bundle"; request: SkillBundleRemoveRequest }
	| { id?: string; type: "validate_plugin"; source: string; actor?: string }
	| { id?: string; type: "validate_skill"; path: string; actor?: string }
	| { id?: string; type: "get_plugin_skill_settings" }
	| { id?: string; type: "update_plugin_skill_settings"; request: PluginSkillSettingsUpdate }
	| { id?: string; type: "get_source_auth"; provider: SourceAuthRequest["provider"] }
	| { id?: string; type: "set_source_auth"; request: SourceAuthRequest }
	| { id?: string; type: "preview_blueprint"; request: BlueprintRequest }
	| { id?: string; type: "apply_blueprint"; request: BlueprintRequest };

// ============================================================================
// RPC Slash Command (for get_commands response)
// ============================================================================

/** A command available for invocation via prompt */
export interface RpcSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Human-readable description */
	description?: string;
	/** What kind of command this is */
	source: "extension" | "prompt" | "skill";
	/** Source metadata for the owning resource */
	sourceInfo: SourceInfo;
}

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

// Success responses with data
export type RpcResponse =
	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }

	// Model
	| {
			id?: string;
			type: "response";
			command: "set_model";
			success: true;
			data: Model<any>;
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_model";
			success: true;
			data: { model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_models";
			success: true;
			data: { models: Model<any>[] };
	  }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| {
			id?: string;
			type: "response";
			command: "cycle_thinking_level";
			success: true;
			data: { level: ThinkingLevel } | null;
	  }

	// Queue modes
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true; data: CompactionResult }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }

	// Retry
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }

	// Bash
	| { id?: string; type: "response"; command: "bash"; success: true; data: BashResult }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "fork"; success: true; data: { text: string; cancelled: boolean } }
	| { id?: string; type: "response"; command: "clone"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "get_fork_messages";
			success: true;
			data: { messages: Array<{ entryId: string; text: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }

	// Messages
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: AgentMessage[] } }

	// Commands
	| {
			id?: string;
			type: "response";
			command: "get_commands";
			success: true;
			data: { commands: RpcSlashCommand[] };
	  }

	// Plugin/Skill management
	| {
			id?: string;
			type: "response";
			command: "get_plugin_skill_state";
			success: true;
			data: PluginSkillDiscoveryState;
	  }
	| {
			id?: string;
			type: "response";
			command: "toggle_plugin";
			success: true;
			data: PluginStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "toggle_skill";
			success: true;
			data: SkillStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_plugin_skill_audit";
			success: true;
			data: { entries: PluginSkillAuditEntry[]; state: PluginSkillAuditState };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_plugin_skill_catalog";
			success: true;
			data: PluginSkillCatalogResult;
	  }
	| {
			id?: string;
			type: "response";
			command: "install_plugin";
			success: true;
			data: PluginStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "update_plugin";
			success: true;
			data: PluginStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "remove_plugin";
			success: true;
			data: PluginRemoveResult;
	  }
	| {
			id?: string;
			type: "response";
			command: "install_skill_bundle";
			success: true;
			data: SkillStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "remove_skill_bundle";
			success: true;
			data: SkillBundleRemoveResult;
	  }
	| {
			id?: string;
			type: "response";
			command: "validate_plugin";
			success: true;
			data: PluginStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "validate_skill";
			success: true;
			data: SkillStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_plugin_skill_settings";
			success: true;
			data: PluginSkillSettingsState;
	  }
	| {
			id?: string;
			type: "response";
			command: "update_plugin_skill_settings";
			success: true;
			data: PluginSkillSettingsState;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_source_auth";
			success: true;
			data: SourceAuthConfig;
	  }
	| {
			id?: string;
			type: "response";
			command: "set_source_auth";
			success: true;
			data: SourceAuthConfig;
	  }
	| {
			id?: string;
			type: "response";
			command: "preview_blueprint";
			success: true;
			data: BlueprintPreview;
	  }
	| {
			id?: string;
			type: "response";
			command: "apply_blueprint";
			success: true;
			data: BlueprintApplyResult;
	  }

	// Error response (any command can fail)
	| { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setStatus";
			statusKey: string;
			statusText: string | undefined;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines: string[] | undefined;
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
