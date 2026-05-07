import type {
	BlueprintApplyResult,
	BlueprintPreset,
	BlueprintPreview,
	PluginSkillAuditEntry,
	PluginSkillAuditResult,
	PluginSkillBackend,
	PluginSkillCatalogResult,
	PluginSkillDiscoveryState,
	PluginSkillFeatureFlags,
	PluginSkillSettingsState,
	PluginStatus,
	SkillStatus,
	SourceAuthConfig,
} from "./plugin-skill-backend.js";

export interface PluginSkillPerformanceSnapshot {
	settingsOpenMs: number;
	catalogLoadMs: number;
	installDispatchMs: number;
	blueprintPreviewMs: number;
}

export interface PluginSkillDomainState {
	discovery: PluginSkillDiscoveryState;
	auditEntries: PluginSkillAuditEntry[];
	settings: PluginSkillSettingsState;
	catalog: PluginSkillCatalogResult;
	sourceAuth: SourceAuthConfig;
	performance: PluginSkillPerformanceSnapshot;
}

const EMPTY_PERF: PluginSkillPerformanceSnapshot = {
	settingsOpenMs: 0,
	catalogLoadMs: 0,
	installDispatchMs: 0,
	blueprintPreviewMs: 0,
};

export class PluginSkillSettingsDomain {
	private perf: PluginSkillPerformanceSnapshot = { ...EMPTY_PERF };

	constructor(private readonly backend: PluginSkillBackend) {}

	getPerformanceSnapshot(): PluginSkillPerformanceSnapshot {
		return { ...this.perf };
	}

	async loadState(options?: {
		auditLimit?: number;
		catalogRemoteUrl?: string;
		catalogImportedCatalogPath?: string;
	}): Promise<PluginSkillDomainState> {
		const start = performance.now();
		const [discovery, settings, sourceAuth, auditEntries, catalog] = await Promise.all([
			this.backend.getState(),
			this.backend.getSettings(),
			this.backend.getSourceAuth("github"),
			this.backend
				.getAuditEntries({
					domain: "plugin",
					limit: options?.auditLimit ?? 200,
				})
				.then((result) => result.entries),
			this.timeCatalogLoad({
				remoteUrl: options?.catalogRemoteUrl,
				importedCatalogPath: options?.catalogImportedCatalogPath,
			}),
		]);
		this.perf.settingsOpenMs = Math.round(performance.now() - start);
		return {
			discovery,
			settings,
			sourceAuth,
			auditEntries,
			catalog,
			performance: this.getPerformanceSnapshot(),
		};
	}

	async refreshCatalog(query?: {
		remoteUrl?: string;
		importedCatalogPath?: string;
	}): Promise<PluginSkillCatalogResult> {
		return this.timeCatalogLoad(query);
	}

	async getSettings(): Promise<PluginSkillSettingsState> {
		return this.backend.getSettings();
	}

	async setFeatureFlags(flags: Partial<PluginSkillFeatureFlags>): Promise<PluginSkillSettingsState> {
		return this.backend.updateSettings({ featureFlags: flags });
	}

	async saveCatalogSettings(request: {
		catalogRemoteUrl?: string;
		importedCatalogPath?: string;
		auditRetentionDays?: number;
	}): Promise<PluginSkillSettingsState> {
		return this.backend.updateSettings(request);
	}

	async saveGithubToken(token?: string): Promise<SourceAuthConfig> {
		return this.backend.setSourceAuth({ provider: "github", token });
	}

	async installPlugin(request: {
		source?: string;
		catalogId?: string;
		enabled?: boolean;
		actor?: string;
	}): Promise<PluginStatus> {
		const start = performance.now();
		const plugin = await this.backend.installPlugin(request);
		this.perf.installDispatchMs = Math.round(performance.now() - start);
		return plugin;
	}

	async updatePlugin(request: { source: string; actor?: string }): Promise<PluginStatus> {
		return this.backend.updatePlugin(request);
	}

	async removePlugin(request: { source: string; actor?: string }): Promise<{
		removed: boolean;
		plugin?: PluginStatus;
		orphanWarnings: string[];
	}> {
		return this.backend.removePlugin(request);
	}

	async installSkillBundle(request: {
		name?: string;
		source?: string;
		catalogId?: string;
		enabled?: boolean;
		actor?: string;
	}): Promise<SkillStatus> {
		return this.backend.installSkillBundle(request);
	}

	async removeSkillBundle(request: { path: string; actor?: string }): Promise<{ removed: boolean; path: string }> {
		return this.backend.removeSkillBundle(request);
	}

	async previewBlueprint(request: {
		preset: BlueprintPreset;
		name: string;
		description?: string;
		targetDir?: string;
		registerSource?: boolean;
		enableAfterCreate?: boolean;
		allowOverwrite?: boolean;
		actor?: string;
	}): Promise<BlueprintPreview> {
		const start = performance.now();
		const preview = await this.backend.previewBlueprint(request);
		this.perf.blueprintPreviewMs = Math.round(performance.now() - start);
		return preview;
	}

	async applyBlueprint(request: {
		preset: BlueprintPreset;
		name: string;
		description?: string;
		targetDir?: string;
		registerSource?: boolean;
		enableAfterCreate?: boolean;
		allowOverwrite?: boolean;
		actor?: string;
	}): Promise<BlueprintApplyResult> {
		return this.backend.applyBlueprint(request);
	}

	async getAuditEntries(query?: {
		search?: string;
		domain?: "plugin" | "skill";
		result?: PluginSkillAuditResult;
		limit?: number;
	}): Promise<PluginSkillAuditEntry[]> {
		const result = await this.backend.getAuditEntries(query);
		return result.entries;
	}

	private async timeCatalogLoad(query?: {
		remoteUrl?: string;
		importedCatalogPath?: string;
	}): Promise<PluginSkillCatalogResult> {
		const start = performance.now();
		const catalog = await this.backend.getCatalog(query);
		this.perf.catalogLoadMs = Math.round(performance.now() - start);
		return catalog;
	}
}
