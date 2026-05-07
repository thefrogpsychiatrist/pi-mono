export type PluginSkillStatus = "enabled" | "disabled";
export type PluginSkillAuditResult = "success" | "blocked" | "error";
export type PluginSkillDomain = "plugin" | "skill";
export type PluginSkillAuditAction =
	| "enable"
	| "disable"
	| "validate"
	| "install"
	| "update"
	| "remove"
	| "preview_blueprint"
	| "apply_blueprint";

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
	action: PluginSkillAuditAction;
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

export interface PluginSkillFeatureFlags {
	marketplaceLifecycle: boolean;
	catalogRemoteFallback: boolean;
	blueprintStudio: boolean;
}

export interface PluginSkillDiscoveryState {
	plugins: PluginStatus[];
	skills: SkillStatus[];
	audit: PluginSkillAuditState;
	allowlistedRoots: string[];
	featureFlags: PluginSkillFeatureFlags;
}

export type CatalogEntryType = "plugin" | "skill-bundle";
export type CatalogSource = "bundled" | "remote" | "imported";

interface BaseCatalogEntry {
	id: string;
	type: CatalogEntryType;
	title: string;
	description: string;
	source: string;
	version: string;
	sourceOrigin: CatalogSource;
	sha256?: string;
	maxBytes?: number;
}

export interface PluginCatalogEntry extends BaseCatalogEntry {
	type: "plugin";
}

export interface SkillBundleCatalogEntry extends BaseCatalogEntry {
	type: "skill-bundle";
	defaultSkillName?: string;
}

export type PluginSkillCatalogEntry = PluginCatalogEntry | SkillBundleCatalogEntry;

export interface CatalogMergeState {
	sources: CatalogSource[];
	entryCount: number;
	conflictCount: number;
	remoteFetchError?: string;
	remoteFetchedAt?: string;
}

export interface PluginSkillCatalogResult {
	entries: PluginSkillCatalogEntry[];
	mergeState: CatalogMergeState;
}

export interface PluginSkillSettingsState {
	featureFlags: PluginSkillFeatureFlags;
	catalogRemoteUrl?: string;
	importedCatalogPath?: string;
	auditRetentionDays: number;
}

export interface SourceAuthConfig {
	provider: "github";
	hasToken: boolean;
	updatedAt?: string;
}

export type BlueprintPreset = "plugin-core" | "skill-core";

export interface BlueprintPreviewFile {
	path: string;
	content: string;
}

export interface BlueprintPreview {
	preset: BlueprintPreset;
	resolvedTargetDir: string;
	files: BlueprintPreviewFile[];
	warnings: string[];
	summary: string;
}

export interface BlueprintApplyResult {
	preset: BlueprintPreset;
	createdPaths: string[];
	registeredSource?: string;
	enabledTarget?: string;
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
	getCatalog(query?: { remoteUrl?: string; importedCatalogPath?: string }): Promise<PluginSkillCatalogResult>;
	installPlugin(request: {
		source?: string;
		catalogId?: string;
		enabled?: boolean;
		actor?: string;
	}): Promise<PluginStatus>;
	updatePlugin(request: { source: string; actor?: string }): Promise<PluginStatus>;
	removePlugin(request: {
		source: string;
		actor?: string;
	}): Promise<{ removed: boolean; plugin?: PluginStatus; orphanWarnings: string[] }>;
	installSkillBundle(request: {
		name?: string;
		source?: string;
		catalogId?: string;
		enabled?: boolean;
		actor?: string;
	}): Promise<SkillStatus>;
	removeSkillBundle(request: { path: string; actor?: string }): Promise<{ removed: boolean; path: string }>;
	validatePlugin(request: { source: string; actor?: string }): Promise<PluginStatus>;
	validateSkill(request: { path: string; actor?: string }): Promise<SkillStatus>;
	getSettings(): Promise<PluginSkillSettingsState>;
	updateSettings(request: {
		featureFlags?: Partial<PluginSkillFeatureFlags>;
		catalogRemoteUrl?: string;
		importedCatalogPath?: string;
		auditRetentionDays?: number;
	}): Promise<PluginSkillSettingsState>;
	getSourceAuth(provider: "github"): Promise<SourceAuthConfig>;
	setSourceAuth(request: { provider: "github"; token?: string }): Promise<SourceAuthConfig>;
	previewBlueprint(request: {
		preset: BlueprintPreset;
		name: string;
		description?: string;
		targetDir?: string;
		registerSource?: boolean;
		enableAfterCreate?: boolean;
		allowOverwrite?: boolean;
		actor?: string;
	}): Promise<BlueprintPreview>;
	applyBlueprint(request: {
		preset: BlueprintPreset;
		name: string;
		description?: string;
		targetDir?: string;
		registerSource?: boolean;
		enableAfterCreate?: boolean;
		allowOverwrite?: boolean;
		actor?: string;
	}): Promise<BlueprintApplyResult>;
}

let backend: PluginSkillBackend | null = null;

export function setPluginSkillBackend(nextBackend: PluginSkillBackend | null): void {
	backend = nextBackend;
}

export function getPluginSkillBackend(): PluginSkillBackend | null {
	return backend;
}
