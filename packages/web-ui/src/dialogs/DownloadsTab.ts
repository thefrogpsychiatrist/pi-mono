import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	getPluginSkillBackend,
	type PluginSkillCatalogEntry,
	type PluginSkillCatalogResult,
	type PluginSkillDiscoveryState,
	type PluginSkillFeatureFlags,
	type PluginSkillSettingsState,
	type SourceAuthConfig,
} from "../settings/plugin-skill-backend.js";
import { PluginSkillSettingsDomain } from "../settings/plugin-skill-settings-domain.js";
import { SettingsTab } from "./SettingsDialog.js";

@customElement("downloads-tab")
export class DownloadsTab extends SettingsTab {
	@state() private loading = false;
	@state() private errorMessage = "";
	@state() private catalog: PluginSkillCatalogResult | null = null;
	@state() private discovery: PluginSkillDiscoveryState | null = null;
	@state() private settingsState: PluginSkillSettingsState | null = null;
	@state() private sourceAuth: SourceAuthConfig | null = null;
	@state() private domain: PluginSkillSettingsDomain | null = null;
	@state() private catalogRemoteUrl = "";
	@state() private importedCatalogPath = "";
	@state() private auditRetentionDays = 90;
	@state() private githubToken = "";
	@state() private pluginSource = "";
	@state() private skillSource = "";
	@state() private skillName = "";
	@state() private diagnosticsExpanded = false;

	override async connectedCallback() {
		super.connectedCallback();
		const backend = getPluginSkillBackend();
		if (!backend) return;
		this.domain = new PluginSkillSettingsDomain(backend);
		await this.refresh();
	}

	getTabName(): string {
		return "Downloads";
	}

	private async refresh() {
		if (!this.domain) return;
		this.loading = true;
		this.errorMessage = "";
		try {
			const state = await this.domain.loadState();
			this.discovery = state.discovery;
			this.settingsState = state.settings;
			this.sourceAuth = state.sourceAuth;
			this.catalog = state.catalog;
			this.catalogRemoteUrl = state.settings.catalogRemoteUrl ?? "";
			this.importedCatalogPath = state.settings.importedCatalogPath ?? "";
			this.auditRetentionDays = state.settings.auditRetentionDays;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	private async saveSettings() {
		if (!this.domain) return;
		try {
			this.settingsState = await this.domain.saveCatalogSettings({
				catalogRemoteUrl: this.catalogRemoteUrl,
				importedCatalogPath: this.importedCatalogPath,
				auditRetentionDays: this.auditRetentionDays,
			});
			this.catalog = await this.domain.refreshCatalog({
				remoteUrl: this.catalogRemoteUrl,
				importedCatalogPath: this.importedCatalogPath,
			});
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private async setFeatureFlag(key: keyof PluginSkillFeatureFlags, value: boolean) {
		if (!this.domain) return;
		try {
			const settings = await this.domain.setFeatureFlags({ [key]: value });
			this.settingsState = settings;
			await this.refresh();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private async saveGithubToken() {
		if (!this.domain) return;
		try {
			this.sourceAuth = await this.domain.saveGithubToken(this.githubToken || undefined);
			this.githubToken = "";
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private async installEntry(entry: PluginSkillCatalogEntry) {
		if (!this.domain) return;
		try {
			if (entry.type === "plugin") {
				await this.domain.installPlugin({ catalogId: entry.id, enabled: true, actor: "web-ui" });
			} else {
				await this.domain.installSkillBundle({ catalogId: entry.id, enabled: true, actor: "web-ui" });
			}
			await this.refresh();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private async installPluginFromSource() {
		if (!this.domain || !this.pluginSource.trim()) return;
		try {
			await this.domain.installPlugin({
				source: this.pluginSource.trim(),
				enabled: true,
				actor: "web-ui",
			});
			this.pluginSource = "";
			await this.refresh();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private async installSkillFromSource() {
		if (!this.domain || !this.skillSource.trim()) return;
		try {
			await this.domain.installSkillBundle({
				source: this.skillSource.trim(),
				name: this.skillName.trim() || undefined,
				enabled: true,
				actor: "web-ui",
			});
			this.skillSource = "";
			this.skillName = "";
			await this.refresh();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private renderFeatureFlags(): TemplateResult {
		const flags = this.settingsState?.featureFlags;
		if (!flags) return html``;
		return html`
			<div class="border border-border rounded-lg p-3 space-y-3">
				<div class="text-sm font-semibold text-foreground">Feature Flags</div>
				${this.renderFlagRow("Marketplace lifecycle", "marketplaceLifecycle", flags.marketplaceLifecycle)}
				${this.renderFlagRow("Catalog remote fallback", "catalogRemoteFallback", flags.catalogRemoteFallback)}
				${this.renderFlagRow("Blueprint Studio", "blueprintStudio", flags.blueprintStudio)}
			</div>
		`;
	}

	private renderFlagRow(label: string, key: keyof PluginSkillFeatureFlags, value: boolean): TemplateResult {
		return html`
			<div class="flex items-center justify-between gap-2">
				<div class="text-xs text-muted-foreground">${label}</div>
				<input type="checkbox" .checked=${value} @change=${(event: Event) => this.setFeatureFlag(key, (event.target as HTMLInputElement).checked)} />
			</div>
		`;
	}

	private renderCatalog(): TemplateResult {
		if (!this.catalog) return html``;
		return html`
			<div class="border border-border rounded-lg p-3 space-y-3">
				<div class="flex items-center justify-between">
					<div class="text-sm font-semibold text-foreground">Catalog</div>
					${Button({ variant: "outline", size: "sm", onClick: () => this.refresh(), children: "Refresh" })}
				</div>
				<div class="text-xs text-muted-foreground">
					Sources: ${this.catalog.mergeState.sources.join(", ")} • Entries: ${this.catalog.mergeState.entryCount} • Conflicts:
					${this.catalog.mergeState.conflictCount}
				</div>
				${
					this.catalog.mergeState.remoteFetchError
						? html`<div class="text-xs text-red-600">${this.catalog.mergeState.remoteFetchError}</div>`
						: ""
				}
				<div class="space-y-2">
					${this.catalog.entries.map(
						(entry) => html`
							<div class="border border-border rounded-md p-2 space-y-1">
								<div class="text-sm text-foreground font-medium">${entry.title}</div>
								<div class="text-xs text-muted-foreground">${entry.description}</div>
								<div class="text-xs text-muted-foreground">
									${entry.type} • ${entry.version} • ${entry.sourceOrigin}
								</div>
								<div class="text-xs text-muted-foreground break-all">${entry.source}</div>
								<div class="flex gap-2">
									${Button({
										variant: "default",
										size: "sm",
										onClick: () => this.installEntry(entry),
										children: entry.type === "plugin" ? "Install Plugin" : "Install Skill",
									})}
								</div>
							</div>
						`,
					)}
				</div>
			</div>
		`;
	}

	private renderDiagnostics(): TemplateResult {
		if (!this.domain) return html``;
		const perf = this.domain.getPerformanceSnapshot();
		const remoteError = this.catalog?.mergeState.remoteFetchError;
		return html`
			<div class="border border-border rounded-lg p-3 space-y-2">
				<div class="text-sm font-semibold text-foreground">Diagnostics</div>
				<div class="text-xs text-muted-foreground">
					Settings open ${perf.settingsOpenMs}ms • Catalog load ${perf.catalogLoadMs}ms • Install dispatch
					${perf.installDispatchMs}ms • Blueprint preview ${perf.blueprintPreviewMs}ms
				</div>
				${
					remoteError
						? html`<div class="text-xs text-red-600">Remote catalog: ${remoteError}</div>`
						: html`<div class="text-xs text-muted-foreground">Remote catalog: healthy or not configured.</div>`
				}
				<div>
					${Button({
						variant: "ghost",
						size: "sm",
						onClick: () => {
							this.diagnosticsExpanded = !this.diagnosticsExpanded;
						},
						children: this.diagnosticsExpanded ? "Hide Raw Detail" : "Show Raw Detail",
					})}
				</div>
				${
					this.diagnosticsExpanded
						? html`<pre class="text-xs overflow-auto max-h-64 bg-secondary/20 p-2 rounded">${JSON.stringify(
								{
									perf,
									catalogMergeState: this.catalog?.mergeState,
									featureFlags: this.settingsState?.featureFlags,
									sourceAuth: this.sourceAuth,
								},
								null,
								2,
							)}</pre>`
						: ""
				}
			</div>
		`;
	}

	render(): TemplateResult {
		if (!this.domain) {
			return html`<div class="text-sm text-muted-foreground">Downloads are available when a coding-agent RPC backend is connected.</div>`;
		}

		const lifecycleEnabled = this.settingsState?.featureFlags.marketplaceLifecycle ?? false;
		return html`
			<div class="flex flex-col gap-4">
				<div class="text-sm font-semibold text-foreground">Marketplace and Download Controls</div>
				${this.loading ? html`<div class="text-xs text-muted-foreground">Loading marketplace state...</div>` : ""}
				${
					this.discovery
						? html`<div class="text-xs text-muted-foreground">
							Discovered: ${this.discovery.plugins.length} plugins, ${this.discovery.skills.length} skills
						</div>`
						: ""
				}
				${
					this.errorMessage
						? html`<div class="text-sm text-red-600 border border-red-400/40 rounded p-2">${this.errorMessage}</div>`
						: ""
				}
				${this.renderFeatureFlags()}

				<div class="border border-border rounded-lg p-3 space-y-2">
					<div class="text-sm font-semibold text-foreground">Catalog Settings</div>
					${Input({
						placeholder: "Remote catalog URL",
						value: this.catalogRemoteUrl,
						onInput: (event: Event) => {
							this.catalogRemoteUrl = (event.target as HTMLInputElement).value;
						},
					})}
					${Input({
						placeholder: "Imported catalog file path",
						value: this.importedCatalogPath,
						onInput: (event: Event) => {
							this.importedCatalogPath = (event.target as HTMLInputElement).value;
						},
					})}
					<div class="flex items-center gap-2">
						<label class="text-xs text-muted-foreground">Audit retention (days)</label>
						<input
							type="number"
							min="7"
							max="365"
							class="h-10 rounded-md border border-border bg-background px-2 text-sm w-24"
							.value=${String(this.auditRetentionDays)}
							@input=${(event: Event) => {
								this.auditRetentionDays = Number((event.target as HTMLInputElement).value);
							}}
						/>
					</div>
					${Button({ variant: "outline", size: "sm", onClick: () => this.saveSettings(), children: "Save Catalog Settings" })}
				</div>

				<div class="border border-border rounded-lg p-3 space-y-2">
					<div class="text-sm font-semibold text-foreground">Manual Source Install</div>
					<div class="text-xs text-muted-foreground">
						Install directly from a package source or local path when catalog discovery is unavailable.
					</div>
					${Input({
						placeholder: "Plugin source (npm:, git:, https:, or local path)",
						value: this.pluginSource,
						onInput: (event: Event) => {
							this.pluginSource = (event.target as HTMLInputElement).value;
						},
					})}
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => this.installPluginFromSource(),
						disabled: !lifecycleEnabled || !this.pluginSource.trim(),
						children: "Install Plugin Source",
					})}
					${Input({
						placeholder: "Skill source (url/path)",
						value: this.skillSource,
						onInput: (event: Event) => {
							this.skillSource = (event.target as HTMLInputElement).value;
						},
					})}
					${Input({
						placeholder: "Skill name override (optional)",
						value: this.skillName,
						onInput: (event: Event) => {
							this.skillName = (event.target as HTMLInputElement).value;
						},
					})}
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => this.installSkillFromSource(),
						disabled: !lifecycleEnabled || !this.skillSource.trim(),
						children: "Install Skill Source",
					})}
				</div>

				<div class="border border-border rounded-lg p-3 space-y-2">
					<div class="text-sm font-semibold text-foreground">GitHub Source Auth</div>
					<div class="text-xs text-muted-foreground">Token stored locally. Current token configured: ${this.sourceAuth?.hasToken ? "yes" : "no"}</div>
					${Input({
						type: "password",
						placeholder: "GitHub token",
						value: this.githubToken,
						onInput: (event: Event) => {
							this.githubToken = (event.target as HTMLInputElement).value;
						},
					})}
					<div class="flex gap-2">
						${Button({ variant: "outline", size: "sm", onClick: () => this.saveGithubToken(), children: "Save Token" })}
						${Button({
							variant: "ghost",
							size: "sm",
							onClick: () => {
								this.githubToken = "";
								void this.domain?.saveGithubToken(undefined).then(() => this.refresh());
							},
							children: "Clear Token",
						})}
					</div>
				</div>

				${lifecycleEnabled ? this.renderCatalog() : html`<div class="text-xs text-muted-foreground border border-border rounded p-3">Enable marketplace lifecycle flag to activate install/update/remove actions.</div>`}
				${this.renderDiagnostics()}
			</div>
		`;
	}
}
