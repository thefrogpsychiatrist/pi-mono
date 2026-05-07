import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
	type BlueprintPreset,
	type BlueprintPreview,
	getPluginSkillBackend,
} from "../settings/plugin-skill-backend.js";
import { PluginSkillSettingsDomain } from "../settings/plugin-skill-settings-domain.js";
import { SettingsTab } from "./SettingsDialog.js";

@customElement("blueprint-studio-tab")
export class BlueprintStudioTab extends SettingsTab {
	@state() private domain: PluginSkillSettingsDomain | null = null;
	@state() private enabled = false;
	@state() private loading = false;
	@state() private errorMessage = "";
	@state() private preset: BlueprintPreset = "plugin-core";
	@state() private name = "";
	@state() private description = "";
	@state() private targetDir = "";
	@state() private registerSource = true;
	@state() private enableAfterCreate = true;
	@state() private allowOverwrite = false;
	@state() private preview: BlueprintPreview | null = null;
	@state() private applyResultText = "";
	@state() private performanceText = "";

	override async connectedCallback() {
		super.connectedCallback();
		const backend = getPluginSkillBackend();
		if (!backend) return;
		this.domain = new PluginSkillSettingsDomain(backend);
		await this.refreshFeatureFlag();
	}

	getTabName(): string {
		return "Blueprint Studio";
	}

	private async refreshFeatureFlag() {
		if (!this.domain) return;
		this.loading = true;
		this.errorMessage = "";
		try {
			const settings = await this.domain.getSettings();
			this.enabled = settings.featureFlags.blueprintStudio;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	private async previewBlueprint() {
		if (!this.domain) return;
		this.errorMessage = "";
		this.applyResultText = "";
		try {
			this.preview = await this.domain.previewBlueprint({
				preset: this.preset,
				name: this.name,
				description: this.description || undefined,
				targetDir: this.targetDir || undefined,
				registerSource: this.registerSource,
				enableAfterCreate: this.enableAfterCreate,
				allowOverwrite: this.allowOverwrite,
				actor: "web-ui",
			});
			const perf = this.domain.getPerformanceSnapshot();
			this.performanceText = `Blueprint preview: ${perf.blueprintPreviewMs}ms`;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	private async applyBlueprint() {
		if (!this.domain) return;
		this.errorMessage = "";
		try {
			const result = await this.domain.applyBlueprint({
				preset: this.preset,
				name: this.name,
				description: this.description || undefined,
				targetDir: this.targetDir || undefined,
				registerSource: this.registerSource,
				enableAfterCreate: this.enableAfterCreate,
				allowOverwrite: this.allowOverwrite,
				actor: "web-ui",
			});
			this.applyResultText = `Created ${result.createdPaths.length} file(s).`;
			this.preview = null;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	render(): TemplateResult {
		if (!this.domain) {
			return html`<div class="text-sm text-muted-foreground">Blueprint Studio is available when a coding-agent RPC backend is connected.</div>`;
		}

		if (!this.enabled) {
			return html`
				<div class="text-sm text-muted-foreground border border-border rounded p-3">
					Enable the "Blueprint Studio" feature flag in Downloads tab to use this workflow.
				</div>
			`;
		}

		return html`
			<div class="flex flex-col gap-4">
				<div>
					<div class="text-sm font-semibold text-foreground">Blueprint Studio</div>
					<div class="text-xs text-muted-foreground">Generate plugin/skill scaffolds with preview + explicit apply.</div>
				</div>

				${this.loading ? html`<div class="text-xs text-muted-foreground">Loading blueprint settings...</div>` : ""}
				${this.performanceText ? html`<div class="text-xs text-muted-foreground">${this.performanceText}</div>` : ""}
				${
					this.errorMessage
						? html`<div class="text-sm text-red-600 border border-red-400/40 rounded p-2">${this.errorMessage}</div>`
						: ""
				}
				${this.applyResultText ? html`<div class="text-sm text-green-700 border border-green-300/40 rounded p-2">${this.applyResultText}</div>` : ""}

				<div class="border border-border rounded-lg p-3 space-y-2">
					<label class="text-xs text-muted-foreground">Preset</label>
					<select
						class="h-10 rounded-md border border-border bg-background px-2 text-sm"
						.value=${this.preset}
						@change=${(event: Event) => {
							this.preset = (event.target as HTMLSelectElement).value as BlueprintPreset;
						}}
					>
						<option value="plugin-core">Plugin Core</option>
						<option value="skill-core">Skill Core</option>
					</select>

					${Input({
						placeholder: "Name",
						value: this.name,
						onInput: (event: Event) => {
							this.name = (event.target as HTMLInputElement).value;
						},
					})}
					${Input({
						placeholder: "Description",
						value: this.description,
						onInput: (event: Event) => {
							this.description = (event.target as HTMLInputElement).value;
						},
					})}
					${Input({
						placeholder: "Target directory (optional)",
						value: this.targetDir,
						onInput: (event: Event) => {
							this.targetDir = (event.target as HTMLInputElement).value;
						},
					})}
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground">
							<input
								type="checkbox"
								.checked=${this.registerSource}
								@change=${(event: Event) => {
									this.registerSource = (event.target as HTMLInputElement).checked;
								}}
							/>
							Auto register source
						</label>
						<label class="text-xs text-muted-foreground">
							<input
								type="checkbox"
								.checked=${this.enableAfterCreate}
								@change=${(event: Event) => {
									this.enableAfterCreate = (event.target as HTMLInputElement).checked;
								}}
							/>
							Enable after create
						</label>
						<label class="text-xs text-muted-foreground">
							<input
								type="checkbox"
								.checked=${this.allowOverwrite}
								@change=${(event: Event) => {
									this.allowOverwrite = (event.target as HTMLInputElement).checked;
								}}
							/>
							Allow overwrite
						</label>
					</div>

					<div class="flex gap-2">
						${Button({ variant: "outline", size: "sm", onClick: () => this.previewBlueprint(), children: "Preview" })}
						${Button({
							variant: "default",
							size: "sm",
							onClick: () => this.applyBlueprint(),
							disabled: !this.preview,
							children: "Apply",
						})}
					</div>
				</div>

				${
					this.preview
						? html`
							<div class="border border-border rounded-lg p-3 space-y-2">
								<div class="text-sm font-semibold text-foreground">Preview</div>
								<div class="text-xs text-muted-foreground">Target: ${this.preview.resolvedTargetDir}</div>
								<div class="text-xs text-muted-foreground">${this.preview.summary}</div>
								${
									this.preview.warnings.length > 0
										? html`<div class="text-xs text-amber-600">${this.preview.warnings.join(" | ")}</div>`
										: ""
								}
								<div class="space-y-2">
									${this.preview.files.map(
										(file) => html`
											<div class="border border-border rounded p-2">
												<div class="text-xs text-muted-foreground break-all">${file.path}</div>
												<pre class="text-xs overflow-auto max-h-64 bg-secondary/20 p-2 rounded">${file.content}</pre>
											</div>
										`,
									)}
								</div>
							</div>
						`
						: ""
				}
			</div>
		`;
	}
}
