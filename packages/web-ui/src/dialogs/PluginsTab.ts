import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	getPluginSkillBackend,
	type PluginSkillAuditEntry,
	type PluginSkillAuditResult,
	type PluginSkillBackend,
	type PluginSkillDiscoveryState,
	type PluginStatus,
} from "../settings/plugin-skill-backend.js";
import { SettingsTab } from "./SettingsDialog.js";

@customElement("plugins-tab")
export class PluginsTab extends SettingsTab {
	@state() private backend: PluginSkillBackend | null = null;
	@state() private discoveryState: PluginSkillDiscoveryState | null = null;
	@state() private auditEntries: PluginSkillAuditEntry[] = [];
	@state() private loading = false;
	@state() private errorMessage = "";
	@state() private auditSearch = "";
	@state() private auditResultFilter: "all" | PluginSkillAuditResult = "all";

	override async connectedCallback() {
		super.connectedCallback();
		this.backend = getPluginSkillBackend();
		await this.refresh();
	}

	getTabName(): string {
		return "Plugins";
	}

	private async refresh() {
		if (!this.backend) return;
		this.loading = true;
		this.errorMessage = "";
		try {
			this.discoveryState = await this.backend.getState();
			const audit = await this.backend.getAuditEntries({ domain: "plugin", limit: 200 });
			this.auditEntries = audit.entries;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	private async togglePlugin(plugin: PluginStatus, enable: boolean) {
		if (!this.backend) return;
		const decision = window.confirm(
			`${enable ? "Enable" : "Disable"} plugin "${plugin.source}"?\n\nThis action is recorded in the local audit log.`,
		);
		if (!decision) return;
		try {
			await this.backend.togglePlugin({
				source: plugin.source,
				enabled: enable,
				actor: "web-ui",
			});
			await this.refresh();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private filteredAuditEntries(): PluginSkillAuditEntry[] {
		const query = this.auditSearch.trim().toLowerCase();
		return this.auditEntries.filter((entry) => {
			if (this.auditResultFilter !== "all" && entry.result !== this.auditResultFilter) {
				return false;
			}
			if (!query) {
				return true;
			}
			const text = `${entry.targetLabel} ${entry.actor} ${entry.reason ?? ""}`.toLowerCase();
			return text.includes(query);
		});
	}

	private renderPluginCard(plugin: PluginStatus): TemplateResult {
		const isEnabled = plugin.status === "enabled";
		const validationColor = plugin.validation.valid ? "text-green-600" : "text-red-600";
		return html`
			<div class="border border-border rounded-lg p-3 flex flex-col gap-2">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<div class="text-sm font-semibold text-foreground break-all">${plugin.source}</div>
						<div class="text-xs text-muted-foreground break-all">${plugin.installedPath ?? "No installed path"}</div>
					</div>
					${Button({
						variant: isEnabled ? "outline" : "default",
						size: "sm",
						onClick: () => this.togglePlugin(plugin, !isEnabled),
						children: isEnabled ? "Disable" : "Enable",
					})}
				</div>
				<div class="text-xs text-muted-foreground">
					Resources: ${plugin.resources.enabled}/${plugin.resources.total} enabled • ext ${plugin.resources.extensions} •
					skills ${plugin.resources.skills} • prompts ${plugin.resources.prompts} • themes ${plugin.resources.themes}
				</div>
				<div class="text-xs ${validationColor}">
					Validation: ${plugin.validation.valid ? "passed" : "failed"} (${new Date(plugin.validation.checkedAt).toLocaleString()})
				</div>
				${
					plugin.validation.errors.length > 0
						? html`<div class="text-xs text-red-600">${plugin.validation.errors.join("; ")}</div>`
						: ""
				}
				${
					plugin.validation.warnings.length > 0
						? html`<div class="text-xs text-amber-600">${plugin.validation.warnings.join("; ")}</div>`
						: ""
				}
			</div>
		`;
	}

	private renderAudit(): TemplateResult {
		const entries = this.filteredAuditEntries();
		return html`
			<div class="flex flex-col gap-3 border border-border rounded-lg p-3">
				<div class="text-sm font-semibold text-foreground">Audit Log (Last 90 Days)</div>
				<div class="flex flex-col md:flex-row gap-2">
					<div class="flex-1">
						${Input({
							placeholder: "Search actor, plugin, reason...",
							value: this.auditSearch,
							onInput: (event: Event) => {
								this.auditSearch = (event.target as HTMLInputElement).value;
							},
						})}
					</div>
					<select
						class="h-10 rounded-md border border-border bg-background px-2 text-sm"
						.value=${this.auditResultFilter}
						@change=${(event: Event) => {
							this.auditResultFilter = (event.target as HTMLSelectElement).value as
								| "all"
								| PluginSkillAuditResult;
						}}
					>
						<option value="all">All Results</option>
						<option value="success">Success</option>
						<option value="blocked">Blocked</option>
						<option value="error">Error</option>
					</select>
				</div>
				<div class="max-h-64 overflow-auto border border-border rounded-md">
					${
						entries.length === 0
							? html`<div class="text-xs text-muted-foreground p-3">No entries found.</div>`
							: entries.map(
									(entry) => html`
										<div class="p-2 border-b last:border-b-0 border-border text-xs">
											<div class="flex items-center justify-between gap-2">
												<span class="font-medium">${entry.action.toUpperCase()} ${entry.targetLabel}</span>
												<span class="text-muted-foreground">${new Date(entry.timestamp).toLocaleString()}</span>
											</div>
											<div class="text-muted-foreground">${entry.actor} • ${entry.result}</div>
											${entry.reason ? html`<div class="text-red-600">${entry.reason}</div>` : ""}
										</div>
									`,
								)
					}
				</div>
			</div>
		`;
	}

	render(): TemplateResult {
		if (!this.backend) {
			return html`
				<div class="flex flex-col gap-3">
					<div class="text-sm text-muted-foreground">
						Plugin management is available when a coding-agent RPC backend is connected.
					</div>
				</div>
			`;
		}

		return html`
			<div class="flex flex-col gap-4">
				<div class="flex items-center justify-between">
					<div>
						<div class="text-sm font-semibold text-foreground">User-Global Plugin Controls</div>
						<div class="text-xs text-muted-foreground">
							Discovery and toggles are backed by coding-agent resource resolution and settings.
						</div>
					</div>
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => this.refresh(),
						disabled: this.loading,
						children: this.loading ? "Refreshing..." : "Refresh",
					})}
				</div>

				${
					this.errorMessage
						? html`<div class="text-sm text-red-600 border border-red-400/40 rounded p-2">${this.errorMessage}</div>`
						: ""
				}

				<div class="text-xs text-muted-foreground">
					Allowlisted roots:
					${
						this.discoveryState?.allowlistedRoots?.length
							? this.discoveryState.allowlistedRoots.join(", ")
							: "No roots discovered yet."
					}
				</div>

				<div class="flex flex-col gap-3">
					${
						!this.discoveryState || this.discoveryState.plugins.length === 0
							? html`<div class="text-sm text-muted-foreground border border-border rounded p-3">
								No user-global plugins discovered.
							</div>`
							: this.discoveryState.plugins.map((plugin) => this.renderPluginCard(plugin))
					}
				</div>

				${this.renderAudit()}
			</div>
		`;
	}
}
