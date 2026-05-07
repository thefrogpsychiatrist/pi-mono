import type { PathMetadata } from "./package-manager.js";

export type PluginSkillDomain = "plugin" | "skill";
export type PluginSkillStatus = "enabled" | "disabled";
export type PluginSkillToggleAction = "enable" | "disable";
export type PluginSkillAuditAction =
	| PluginSkillToggleAction
	| "validate"
	| "install"
	| "update"
	| "remove"
	| "preview_blueprint"
	| "apply_blueprint";
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

export interface PluginInstallRequest {
	source?: string;
	catalogId?: string;
	enabled?: boolean;
	actor?: string;
}

export interface PluginUpdateRequest {
	source: string;
	actor?: string;
}

export interface PluginRemoveRequest {
	source: string;
	actor?: string;
}

export interface SkillBundleInstallRequest {
	name?: string;
	source?: string;
	catalogId?: string;
	enabled?: boolean;
	actor?: string;
}

export interface SkillBundleRemoveRequest {
	path: string;
	actor?: string;
}

export interface PluginRemoveResult {
	removed: boolean;
	plugin?: PluginStatus;
	orphanWarnings: string[];
}

export interface SkillBundleRemoveResult {
	removed: boolean;
	path: string;
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

export interface PluginSkillCatalogQuery {
	remoteUrl?: string;
	importedCatalogPath?: string;
}

export interface PluginSkillCatalogResult {
	entries: PluginSkillCatalogEntry[];
	mergeState: CatalogMergeState;
}

export interface SourceAuthConfig {
	provider: "github";
	hasToken: boolean;
	updatedAt?: string;
}

export interface SourceAuthRequest {
	provider: "github";
	token?: string;
}

export type BlueprintPreset = "plugin-core" | "skill-core";

export interface BlueprintRequest {
	preset: BlueprintPreset;
	name: string;
	description?: string;
	targetDir?: string;
	registerSource?: boolean;
	enableAfterCreate?: boolean;
	allowOverwrite?: boolean;
	actor?: string;
}

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

export interface PluginSkillSettingsUpdate {
	featureFlags?: Partial<PluginSkillFeatureFlags>;
	catalogRemoteUrl?: string;
	importedCatalogPath?: string;
	auditRetentionDays?: number;
}

export interface PluginSkillSettingsState {
	featureFlags: PluginSkillFeatureFlags;
	catalogRemoteUrl?: string;
	importedCatalogPath?: string;
	auditRetentionDays: number;
}
