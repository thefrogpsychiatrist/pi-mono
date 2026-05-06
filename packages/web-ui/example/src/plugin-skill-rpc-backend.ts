import type {
	PluginSkillAuditResult,
	PluginSkillBackend,
	PluginSkillDiscoveryState,
	PluginStatus,
	SkillStatus,
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
		const response = (await this.bridge.request({ type: "get_plugin_skill_state" })) as PluginSkillDiscoveryState;
		return response;
	}

	async togglePlugin(request: { source: string; enabled: boolean; actor?: string }): Promise<PluginStatus> {
		const response = (await this.bridge.request({ type: "toggle_plugin", request })) as PluginStatus;
		return response;
	}

	async toggleSkill(request: { path: string; enabled: boolean; actor?: string }): Promise<SkillStatus> {
		const response = (await this.bridge.request({ type: "toggle_skill", request })) as SkillStatus;
		return response;
	}

	async getAuditEntries(query?: {
		search?: string;
		domain?: "plugin" | "skill";
		result?: PluginSkillAuditResult;
		limit?: number;
	}): Promise<{
		entries: Array<{
			id: string;
			timestamp: string;
			actor: string;
			domain: "plugin" | "skill";
			action: "enable" | "disable" | "validate";
			targetId: string;
			targetLabel: string;
			result: "success" | "blocked" | "error";
			reason?: string;
		}>;
		state: { filePath: string; retentionDays: number; totalEntries: number };
	}> {
		const response = (await this.bridge.request({ type: "get_plugin_skill_audit", query })) as {
			entries: Array<{
				id: string;
				timestamp: string;
				actor: string;
				domain: "plugin" | "skill";
				action: "enable" | "disable" | "validate";
				targetId: string;
				targetLabel: string;
				result: "success" | "blocked" | "error";
				reason?: string;
			}>;
			state: { filePath: string; retentionDays: number; totalEntries: number };
		};
		return response;
	}
}

export function createPluginSkillBackendFromWindow(): PluginSkillBackend | null {
	const bridge = window.__PI_STUDIO_RPC__;
	if (!bridge || typeof bridge.request !== "function") {
		return null;
	}
	return new WindowPluginSkillBackend(bridge);
}
