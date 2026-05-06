import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { getModels, getProviders, type Model } from "@mariozechner/pi-ai";
import {
	type AutoDiscoveryProviderType,
	discoverModels,
	getAppStorage,
	type LocalProviderSetup,
	SettingsTab,
	type SpecialistRoleModelMap,
} from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

const ROLES = ["planner", "coder", "reviewer", "summarizer"] as const;
type RoleKey = (typeof ROLES)[number];

@customElement("local-role-mapping-tab")
export class LocalRoleMappingTab extends SettingsTab {
	@state() private availableModels: Model<any>[] = [];
	@state() private specialistRoleModelMap: SpecialistRoleModelMap = {};
	@state() private localProviderSetup: LocalProviderSetup | null = null;
	@state() private loading = false;
	@state() private saveMessage = "";
	@state() private localProviderNames = new Set<string>();

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadState();
	}

	getTabName(): string {
		return "Agent Roles";
	}

	private modelKey(model: Model<any>): string {
		return `${model.provider}::${model.id}`;
	}

	private async loadState() {
		this.loading = true;
		this.saveMessage = "";
		try {
			const storage = getAppStorage();
			const map = await storage.settings.get<SpecialistRoleModelMap>("orchestration.specialistRoleModelMap");
			const setup = await storage.settings.get<LocalProviderSetup>("orchestration.localProviderSetup");
			this.specialistRoleModelMap = map ?? {};
			this.localProviderSetup = setup;
			this.availableModels = await this.loadAvailableModels();
		} finally {
			this.loading = false;
		}
	}

	private async loadAvailableModels(): Promise<Model<any>[]> {
		const allModels: Model<any>[] = [];
		const providers = getProviders();
		for (const provider of providers) {
			const models = getModels(provider as any);
			allModels.push(...models);
		}

		const storage = getAppStorage();
		const customProviders = await storage.customProviders.getAll();
		this.localProviderNames = new Set(customProviders.map((provider) => provider.name));

		for (const provider of customProviders) {
			const isAutoDiscovery =
				provider.type === "ollama" ||
				provider.type === "llama.cpp" ||
				provider.type === "vllm" ||
				provider.type === "lmstudio" ||
				provider.type === "ollama-cloud";
			if (isAutoDiscovery) {
				try {
					const models = await discoverModels(
						provider.type as AutoDiscoveryProviderType,
						provider.baseUrl,
						provider.apiKey,
						{
							ollamaCloudMode: provider.ollamaCloudMode,
						},
					);
					allModels.push(...models.map((model) => ({ ...model, provider: provider.name })));
				} catch (_err) {
					// Ignore failed endpoints and continue with available sources.
				}
			} else if (provider.models?.length) {
				allModels.push(...provider.models);
			}
		}

		return allModels.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
	}

	private setRoleMapping(role: RoleKey, key: string) {
		if (!key) {
			delete this.specialistRoleModelMap[role];
			this.specialistRoleModelMap = { ...this.specialistRoleModelMap };
			return;
		}
		const splitAt = key.indexOf("::");
		if (splitAt === -1) return;
		const provider = key.slice(0, splitAt);
		const modelId = key.slice(splitAt + 2);
		this.specialistRoleModelMap = {
			...this.specialistRoleModelMap,
			[role]: { provider, modelId },
		};
	}

	private applyFirstLocalModelForAllRoles() {
		const firstLocalModel = this.availableModels.find((model) => this.localProviderNames.has(model.provider));
		if (!firstLocalModel) {
			this.saveMessage = "No local provider model available yet.";
			return;
		}
		this.specialistRoleModelMap = {
			planner: { provider: firstLocalModel.provider, modelId: firstLocalModel.id },
			coder: { provider: firstLocalModel.provider, modelId: firstLocalModel.id },
			reviewer: { provider: firstLocalModel.provider, modelId: firstLocalModel.id },
			summarizer: { provider: firstLocalModel.provider, modelId: firstLocalModel.id },
		};
		this.saveMessage = "";
	}

	private async saveMappings() {
		const storage = getAppStorage();
		await storage.settings.set("orchestration.specialistRoleModelMap", this.specialistRoleModelMap);
		this.saveMessage = "Role mapping saved.";
	}

	private renderRoleSelector(role: RoleKey): TemplateResult {
		const selected = this.specialistRoleModelMap[role];
		const selectedKey = selected ? `${selected.provider}::${selected.modelId}` : "";
		return html`
			<div class="flex items-center gap-3">
				<label class="w-28 text-sm capitalize text-foreground">${role}</label>
				<select
					class="flex-1 text-sm bg-background border border-border rounded px-2 py-1"
					.value=${selectedKey}
					@change=${(e: Event) => this.setRoleMapping(role, (e.target as HTMLSelectElement).value)}
				>
					<option value="">Use current model</option>
					${this.availableModels.map((model) => {
						const key = this.modelKey(model);
						return html`<option value=${key}>${model.provider}/${model.id}</option>`;
					})}
				</select>
			</div>
		`;
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted-foreground">
					Map sequential specialist roles to exact models. If a role has no mapping, sequential mode falls back to
					the current active model.
				</p>
				${
					this.localProviderSetup
						? html`<div class="text-xs text-muted-foreground border border-border rounded p-2">
							Last local setup: ${this.localProviderSetup.selectedProviderType ?? "n/a"} at
							${this.localProviderSetup.completedAt}
						</div>`
						: ""
				}
				${this.loading ? html`<div class="text-sm text-muted-foreground">Loading models...</div>` : ""}
				${ROLES.map((role) => this.renderRoleSelector(role))}
				<div class="flex items-center gap-2">
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => this.applyFirstLocalModelForAllRoles(),
						children: "Use First Local Model For All Roles",
					})}
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => this.loadState(),
						children: "Reload Models",
					})}
					${Button({
						variant: "default",
						size: "sm",
						onClick: () => this.saveMappings(),
						children: "Save Mapping",
					})}
				</div>
				${this.saveMessage ? html`<div class="text-xs text-muted-foreground">${this.saveMessage}</div>` : ""}
			</div>
		`;
	}
}
