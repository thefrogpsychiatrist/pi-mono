import type { PathMetadata } from "./package-manager.js";

export type PluginSkillDomain = "plugin" | "skill";
export type PluginSkillStatus = "enabled" | "disabled";
export type PluginSkillToggleAction = "enable" | "disable";
export type PluginSkillAuditResult = "success" | "blocked" | "error";

export interface PluginValidationResult {
	valid: boolean;
	checkedAt: string;
	errors: string[];
	warnings: string[];
}

export interface SkillValidationResult {
	valid: boolean;
	checkedAt: string;
	errors: string[];
	warnings: string[];
}

export interface PluginStatus {
	id: string;
	source: string;
	scope: "user";
	status: PluginSkillStatus;
	installedPath?: string;
	resources: {
		total: number;
		enabled: number;
		extensions: number;
		skills: number;
		prompts: number;
		themes: number;
	};
	validation: PluginValidationResult;
}

export interface SkillStatus {
	id: string;
	name: string;
	path: string;
	scope: "user";
	status: PluginSkillStatus;
	origin: "package" | "top-level";
	pluginSource?: string;
	metadata: PathMetadata;
	validation: SkillValidationResult;
}

export interface PluginToggleRequest {
	source: string;
	enabled: boolean;
	actor?: string;
}

export interface SkillToggleRequest {
	path: string;
	enabled: boolean;
	actor?: string;
}

export interface PluginSkillAuditEntry {
	id: string;
	timestamp: string;
	actor: string;
	domain: PluginSkillDomain;
	action: PluginSkillToggleAction | "validate";
	targetId: string;
	targetLabel: string;
	result: PluginSkillAuditResult;
	reason?: string;
}

export interface PluginSkillAuditQuery {
	search?: string;
	domain?: PluginSkillDomain;
	result?: PluginSkillAuditResult;
	limit?: number;
}

export interface PluginSkillAuditState {
	filePath: string;
	retentionDays: number;
	totalEntries: number;
}

export interface PluginSkillDiscoveryState {
	plugins: PluginStatus[];
	skills: SkillStatus[];
	audit: PluginSkillAuditState;
	allowlistedRoots: string[];
}
