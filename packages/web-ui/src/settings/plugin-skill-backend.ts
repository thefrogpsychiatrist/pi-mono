export type PluginSkillStatus = "enabled" | "disabled";
export type PluginSkillAuditResult = "success" | "blocked" | "error";
export type PluginSkillDomain = "plugin" | "skill";

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
	validation: SkillValidationResult;
}

export interface PluginSkillAuditEntry {
	id: string;
	timestamp: string;
	actor: string;
	domain: PluginSkillDomain;
	action: "enable" | "disable" | "validate";
	targetId: string;
	targetLabel: string;
	result: PluginSkillAuditResult;
	reason?: string;
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

export interface PluginSkillBackend {
	getState(): Promise<PluginSkillDiscoveryState>;
	togglePlugin(request: { source: string; enabled: boolean; actor?: string }): Promise<PluginStatus>;
	toggleSkill(request: { path: string; enabled: boolean; actor?: string }): Promise<SkillStatus>;
	getAuditEntries(query?: {
		search?: string;
		domain?: PluginSkillDomain;
		result?: PluginSkillAuditResult;
		limit?: number;
	}): Promise<{ entries: PluginSkillAuditEntry[]; state: PluginSkillAuditState }>;
}

let backend: PluginSkillBackend | null = null;

export function setPluginSkillBackend(nextBackend: PluginSkillBackend | null): void {
	backend = nextBackend;
}

export function getPluginSkillBackend(): PluginSkillBackend | null {
	return backend;
}
