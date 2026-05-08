import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import type { VisibleReasoningLevel } from "@mariozechner/pi-agent-core";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getAppStorage } from "../storage/app-storage.js";
import type { ComposerProductivitySettings } from "../storage/types.js";
import { SettingsTab } from "./SettingsDialog.js";

export const DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS: ComposerProductivitySettings = {
	defaultReasoningLevel: "off",
	enterToSend: true,
	slashCommandsEnabled: true,
	promptHistoryEnabled: true,
	draftAutosaveEnabled: true,
	contextInspectorEnabled: true,
	defaultExportFormat: "json",
	uiDensity: "comfortable",
	notificationsEnabled: true,
	diagnosticsExpanded: false,
	cacheControlsEnabled: true,
	experimentalFeaturesEnabled: false,
};

@customElement("productivity-settings-tab")
export class ProductivitySettingsTab extends SettingsTab {
	@state() private settings: ComposerProductivitySettings = { ...DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS };
	@state() private loading = true;
	@state() private saved = false;

	override async connectedCallback() {
		super.connectedCallback();
		try {
			const stored = await getAppStorage().settings.get<ComposerProductivitySettings>(
				"studio.composerProductivitySettings",
			);
			this.settings = { ...DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS, ...(stored ?? {}) };
		} finally {
			this.loading = false;
		}
	}

	getTabName(): string {
		return "Productivity";
	}

	private updateSettings(patch: Partial<ComposerProductivitySettings>): void {
		this.settings = { ...this.settings, ...patch };
		this.saved = false;
	}

	private async save(): Promise<void> {
		await getAppStorage().settings.set("studio.composerProductivitySettings", this.settings);
		this.saved = true;
	}

	private renderToggle(key: keyof ComposerProductivitySettings, label: string, description: string): TemplateResult {
		const checked = Boolean(this.settings[key]);
		return html`
			<label class="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
				<span>
					<span class="block text-sm font-medium text-foreground">${label}</span>
					<span class="block text-xs text-muted-foreground">${description}</span>
				</span>
				<input
					type="checkbox"
					class="mt-1 h-4 w-4"
					.checked=${checked}
					@change=${(event: Event) => this.updateSettings({ [key]: (event.target as HTMLInputElement).checked })}
				/>
			</label>
		`;
	}

	render(): TemplateResult {
		if (this.loading) return html`<div class="text-sm text-muted-foreground">Loading productivity settings...</div>`;
		const selectClass = "w-full rounded-md border border-border bg-background px-2 py-2 text-sm";
		return html`
			<div class="space-y-5">
				<div>
					<h3 class="text-sm font-semibold text-foreground">Composer Defaults</h3>
					<p class="text-xs text-muted-foreground">
						Tune the composer, slash palette, reasoning defaults, and power-user diagnostics.
					</p>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					<label class="space-y-1">
						<span class="text-xs text-muted-foreground">Default reasoning</span>
						<select
							class=${selectClass}
							@change=${(event: Event) =>
								this.updateSettings({
									defaultReasoningLevel: (event.target as HTMLSelectElement).value as VisibleReasoningLevel,
								})}
						>
							<option value="off" ?selected=${this.settings.defaultReasoningLevel === "off"}>Off</option>
							<option value="low" ?selected=${this.settings.defaultReasoningLevel === "low"}>Low</option>
							<option value="medium" ?selected=${this.settings.defaultReasoningLevel === "medium"}>Medium</option>
							<option value="high" ?selected=${this.settings.defaultReasoningLevel === "high"}>High</option>
							<option value="xhigh" ?selected=${this.settings.defaultReasoningLevel === "xhigh"}>Extra High</option>
						</select>
					</label>
					<label class="space-y-1">
						<span class="text-xs text-muted-foreground">Default export format</span>
						<select
							class=${selectClass}
							@change=${(event: Event) =>
								this.updateSettings({
									defaultExportFormat: (event.target as HTMLSelectElement).value as "json" | "markdown",
								})}
						>
							<option value="json" ?selected=${this.settings.defaultExportFormat === "json"}>JSON</option>
							<option value="markdown" ?selected=${this.settings.defaultExportFormat === "markdown"}>Markdown</option>
						</select>
					</label>
					<label class="space-y-1">
						<span class="text-xs text-muted-foreground">UI density</span>
						<select
							class=${selectClass}
							@change=${(event: Event) =>
								this.updateSettings({
									uiDensity: (event.target as HTMLSelectElement).value as "comfortable" | "compact",
								})}
						>
							<option value="comfortable" ?selected=${this.settings.uiDensity === "comfortable"}>Comfortable</option>
							<option value="compact" ?selected=${this.settings.uiDensity === "compact"}>Compact</option>
						</select>
					</label>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					${this.renderToggle("enterToSend", "Enter sends", "Use Shift+Enter for a newline.")}
					${this.renderToggle("slashCommandsEnabled", "Slash commands", "Open a Codex-like command palette with /.")}
					${this.renderToggle("promptHistoryEnabled", "Prompt history", "Navigate prior prompts from an empty composer.")}
					${this.renderToggle("draftAutosaveEnabled", "Draft autosave", "Restore unfinished prompts per session.")}
					${this.renderToggle("contextInspectorEnabled", "Context inspector", "Show lightweight token/file context before send.")}
					${this.renderToggle("notificationsEnabled", "Notifications", "Show run state and command feedback toasts.")}
					${this.renderToggle("diagnosticsExpanded", "Expanded diagnostics", "Expose technical status details by default.")}
					${this.renderToggle("cacheControlsEnabled", "Cache controls", "Show local cache/troubleshooting controls.")}
					${this.renderToggle("experimentalFeaturesEnabled", "Experimental features", "Enable hidden productivity experiments.")}
				</div>

				<div class="flex items-center gap-3">
					${Button({ variant: "default", size: "sm", children: "Save Productivity Settings", onClick: () => void this.save() })}
					${this.saved ? html`<span class="text-xs text-muted-foreground">Saved.</span>` : ""}
				</div>
			</div>
		`;
	}
}
