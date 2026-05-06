import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	getPluginSkillBackend,
	type PluginSkillBackend,
	type PluginSkillDiscoveryState,
	type SkillStatus,
} from "../settings/plugin-skill-backend.js";
import { SettingsTab } from "./SettingsDialog.js";

@customElement("skills-tab")
export class SkillsTab extends SettingsTab {
	@state() private backend: PluginSkillBackend | null = null;
	@state() private discoveryState: PluginSkillDiscoveryState | null = null;
	@state() private loading = false;
	@state() private errorMessage = "";
	@state() private search = "";

	override async connectedCallback() {
		super.connectedCallback();
		this.backend = getPluginSkillBackend();
		await this.refresh();
	}

	getTabName(): string {
		return "Skills";
	}

	private async refresh() {
		if (!this.backend) return;
		this.loading = true;
		this.errorMessage = "";
		try {
			this.discoveryState = await this.backend.getState();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	private filteredSkills(): SkillStatus[] {
		const allSkills = this.discoveryState?.skills ?? [];
		const query = this.search.trim().toLowerCase();
		if (!query) {
			return allSkills;
		}
		return allSkills.filter((skill) => {
			const text = `${skill.name} ${skill.path} ${skill.pluginSource ?? ""}`.toLowerCase();
			return text.includes(query);
		});
	}

	private async toggleSkill(skill: SkillStatus, enable: boolean) {
		if (!this.backend) return;
		const decision = window.confirm(
			`${enable ? "Enable" : "Disable"} skill "${skill.name}"?\n\nThis action is recorded in the local audit log.`,
		);
		if (!decision) return;
		try {
			await this.backend.toggleSkill({
				path: skill.path,
				enabled: enable,
				actor: "web-ui",
			});
			await this.refresh();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private renderSkillCard(skill: SkillStatus): TemplateResult {
		const isEnabled = skill.status === "enabled";
		const validationColor = skill.validation.valid ? "text-green-600" : "text-red-600";
		return html`
			<div class="border border-border rounded-lg p-3 flex flex-col gap-2">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<div class="text-sm font-semibold text-foreground">${skill.name}</div>
						<div class="text-xs text-muted-foreground break-all">${skill.path}</div>
					</div>
					${Button({
						variant: isEnabled ? "outline" : "default",
						size: "sm",
						onClick: () => this.toggleSkill(skill, !isEnabled),
						children: isEnabled ? "Disable" : "Enable",
					})}
				</div>
				<div class="text-xs text-muted-foreground">
					Origin: ${skill.origin}${skill.pluginSource ? ` (${skill.pluginSource})` : ""}
				</div>
				<div class="text-xs ${validationColor}">
					Validation: ${skill.validation.valid ? "passed" : "failed"} (${new Date(skill.validation.checkedAt).toLocaleString()})
				</div>
				${
					skill.validation.errors.length > 0
						? html`<div class="text-xs text-red-600">${skill.validation.errors.join("; ")}</div>`
						: ""
				}
				${
					skill.validation.warnings.length > 0
						? html`<div class="text-xs text-amber-600">${skill.validation.warnings.join("; ")}</div>`
						: ""
				}
			</div>
		`;
	}

	render(): TemplateResult {
		if (!this.backend) {
			return html`
				<div class="text-sm text-muted-foreground">
					Skill management is available when a coding-agent RPC backend is connected.
				</div>
			`;
		}

		const skills = this.filteredSkills();
		return html`
			<div class="flex flex-col gap-4">
				<div class="flex items-center justify-between">
					<div>
						<div class="text-sm font-semibold text-foreground">User-Global Skills</div>
						<div class="text-xs text-muted-foreground">
							Skill state and validation are resolved by the coding-agent RPC backend.
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

				${Input({
					placeholder: "Search skills by name or path",
					value: this.search,
					onInput: (event: Event) => {
						this.search = (event.target as HTMLInputElement).value;
					},
				})}

				<div class="flex flex-col gap-3">
					${
						skills.length === 0
							? html`<div class="text-sm text-muted-foreground border border-border rounded p-3">No skills found.</div>`
							: skills.map((skill) => this.renderSkillCard(skill))
					}
				</div>
			</div>
		`;
	}
}
