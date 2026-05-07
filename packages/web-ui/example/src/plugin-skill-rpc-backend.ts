import type {
	BlueprintApplyResult,
	BlueprintPreset,
	BlueprintPreview,
	PluginSkillAuditEntry,
	PluginSkillAuditResult,
	PluginSkillAuditState,
	PluginSkillBackend,
	PluginSkillCatalogResult,
	PluginSkillDiscoveryState,
	PluginSkillDomain,
	PluginSkillFeatureFlags,
	PluginSkillSettingsState,
	PluginStatus,
	SkillStatus,
	SourceAuthConfig,
} from "@mariozechner/pi-web-ui";

interface PiStudioRpcBridge {
	request(payload: { type: string; [key: string]: unknown }): Promise<unknown>;
}

declare global {
	interface Window {
		__PI_STUDIO_RPC__?: PiStudioRpcBridge;
	}
}

class WindowPluginSkillBackend implements PluginSkillBackend {
	constructor(private readonly bridge: PiStudioRpcBridge) {}

	async getState(): Promise<PluginSkillDiscoveryState> {
		return (await this.bridge.request({ type: "get_plugin_skill_state" })) as PluginSkillDiscoveryState;
	}

	async togglePlugin(request: { source: string; enabled: boolean; actor?: string }): Promise<PluginStatus> {
		return (await this.bridge.request({ type: "toggle_plugin", request })) as PluginStatus;
	}

	async toggleSkill(request: { path: string; enabled: boolean; actor?: string }): Promise<SkillStatus> {
		return (await this.bridge.request({ type: "toggle_skill", request })) as SkillStatus;
	}

	async getAuditEntries(query?: {
		search?: string;
		domain?: PluginSkillDomain;
		result?: PluginSkillAuditResult;
		limit?: number;
	}): Promise<{
		entries: PluginSkillAuditEntry[];
		state: PluginSkillAuditState;
	}> {
		return (await this.bridge.request({ type: "get_plugin_skill_audit", query })) as {
			entries: PluginSkillAuditEntry[];
			state: PluginSkillAuditState;
		};
	}

	async getCatalog(query?: { remoteUrl?: string; importedCatalogPath?: string }): Promise<PluginSkillCatalogResult> {
		return (await this.bridge.request({ type: "get_plugin_skill_catalog", query })) as PluginSkillCatalogResult;
	}

	async installPlugin(request: {
		source?: string;
		catalogId?: string;
		enabled?: boolean;
		actor?: string;
	}): Promise<PluginStatus> {
		return (await this.bridge.request({ type: "install_plugin", request })) as PluginStatus;
	}

	async updatePlugin(request: { source: string; actor?: string }): Promise<PluginStatus> {
		return (await this.bridge.request({
			type: "update_plugin",
			source: request.source,
			actor: request.actor,
		})) as PluginStatus;
	}

	async removePlugin(request: {
		source: string;
		actor?: string;
	}): Promise<{ removed: boolean; plugin?: PluginStatus; orphanWarnings: string[] }> {
		return (await this.bridge.request({ type: "remove_plugin", request })) as {
			removed: boolean;
			plugin?: PluginStatus;
			orphanWarnings: string[];
		};
	}

	async installSkillBundle(request: {
		name?: string;
		source?: string;
		catalogId?: string;
		enabled?: boolean;
		actor?: string;
	}): Promise<SkillStatus> {
		return (await this.bridge.request({ type: "install_skill_bundle", request })) as SkillStatus;
	}

	async removeSkillBundle(request: { path: string; actor?: string }): Promise<{ removed: boolean; path: string }> {
		return (await this.bridge.request({ type: "remove_skill_bundle", request })) as {
			removed: boolean;
			path: string;
		};
	}

	async validatePlugin(request: { source: string; actor?: string }): Promise<PluginStatus> {
		return (await this.bridge.request({
			type: "validate_plugin",
			source: request.source,
			actor: request.actor,
		})) as PluginStatus;
	}

	async validateSkill(request: { path: string; actor?: string }): Promise<SkillStatus> {
		return (await this.bridge.request({
			type: "validate_skill",
			path: request.path,
			actor: request.actor,
		})) as SkillStatus;
	}

	async getSettings(): Promise<PluginSkillSettingsState> {
		return (await this.bridge.request({ type: "get_plugin_skill_settings" })) as PluginSkillSettingsState;
	}

	async updateSettings(request: {
		featureFlags?: Partial<PluginSkillFeatureFlags>;
		catalogRemoteUrl?: string;
		importedCatalogPath?: string;
		auditRetentionDays?: number;
	}): Promise<PluginSkillSettingsState> {
		return (await this.bridge.request({ type: "update_plugin_skill_settings", request })) as PluginSkillSettingsState;
	}

	async getSourceAuth(provider: "github"): Promise<SourceAuthConfig> {
		return (await this.bridge.request({ type: "get_source_auth", provider })) as SourceAuthConfig;
	}

	async setSourceAuth(request: { provider: "github"; token?: string }): Promise<SourceAuthConfig> {
		return (await this.bridge.request({ type: "set_source_auth", request })) as SourceAuthConfig;
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
		return (await this.bridge.request({ type: "preview_blueprint", request })) as BlueprintPreview;
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
		return (await this.bridge.request({ type: "apply_blueprint", request })) as BlueprintApplyResult;
	}
}

export function createPluginSkillBackendFromWindow(): PluginSkillBackend | null {
	const bridge = window.__PI_STUDIO_RPC__;
	if (!bridge || typeof bridge.request !== "function") {
		return null;
	}
	return new WindowPluginSkillBackend(bridge);
}
