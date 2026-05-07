import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import {
	type AutomationDefaultsSettings,
	type GuidedOnboardingState,
	getAppStorage,
	i18n,
	type MobileUiState,
	SettingsTab,
	type TouchFirstFeatureFlags,
} from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

const DEFAULT_TOUCH_FIRST_FLAGS: TouchFirstFeatureFlags = {
	touchFirstShell: false,
	automationDefaults: false,
	guidedOnboarding: false,
};

const DEFAULT_AUTOMATION_DEFAULTS: AutomationDefaultsSettings = {
	defaultConversationStyle: "default",
	defaultOrchestrationMode: "single-agent",
	defaultStartupSurface: "chat",
	autoApplyFirstLocalModelForRoles: false,
};

const DEFAULT_GUIDED_ONBOARDING_STATE: GuidedOnboardingState = {
	completed: false,
	completedSteps: {
		mode: false,
		provider: false,
		roleMapping: false,
		firstRun: false,
	},
};

@customElement("touch-first-settings-tab")
export class TouchFirstSettingsTab extends SettingsTab {
	@state() private loading = false;
	@state() private saveMessage = "";
	@state() private touchFirstFeatureFlags: TouchFirstFeatureFlags = { ...DEFAULT_TOUCH_FIRST_FLAGS };
	@state() private automationDefaults: AutomationDefaultsSettings = { ...DEFAULT_AUTOMATION_DEFAULTS };
	@state() private guidedOnboardingState: GuidedOnboardingState = { ...DEFAULT_GUIDED_ONBOARDING_STATE };
	@state() private mobileUiState: MobileUiState = { activeTab: "chat", timelineSheetOpen: false };

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadState();
	}

	getTabName(): string {
		return i18n("Touch-First");
	}

	private async loadState() {
		this.loading = true;
		this.saveMessage = "";
		try {
			const storage = getAppStorage();
			const flags = await storage.settings.get<TouchFirstFeatureFlags>("touchFirst.featureFlags");
			const defaults = await storage.settings.get<AutomationDefaultsSettings>("touchFirst.automationDefaults");
			const onboarding = await storage.settings.get<GuidedOnboardingState>("touchFirst.guidedOnboardingState");
			const mobileUiState = await storage.settings.get<MobileUiState>("touchFirst.mobileUiState");
			this.touchFirstFeatureFlags = flags ?? { ...DEFAULT_TOUCH_FIRST_FLAGS };
			this.automationDefaults = defaults ?? { ...DEFAULT_AUTOMATION_DEFAULTS };
			this.guidedOnboardingState = onboarding ?? { ...DEFAULT_GUIDED_ONBOARDING_STATE };
			this.mobileUiState = mobileUiState ?? { activeTab: "chat", timelineSheetOpen: false };
		} finally {
			this.loading = false;
		}
	}

	private async saveState() {
		const storage = getAppStorage();
		await storage.settings.set("touchFirst.featureFlags", this.touchFirstFeatureFlags);
		await storage.settings.set("touchFirst.automationDefaults", this.automationDefaults);
		await storage.settings.set("touchFirst.guidedOnboardingState", this.guidedOnboardingState);
		await storage.settings.set("touchFirst.mobileUiState", this.mobileUiState);
		this.saveMessage = i18n("Touch-first settings saved.");
	}

	private async resetOnboarding() {
		this.guidedOnboardingState = {
			completed: false,
			completedSteps: {
				mode: false,
				provider: false,
				roleMapping: false,
				firstRun: false,
			},
		};
		await this.saveState();
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted-foreground">
					${i18n(
						"Configure touch-first rollout flags and automation defaults. These options are default-off for safe staged rollout.",
					)}
				</p>
				${this.loading ? html`<div class="text-xs text-muted-foreground">${i18n("Loading touch-first settings...")}</div>` : ""}
				<div class="border border-border rounded-lg p-3 space-y-3">
					<div class="text-sm font-semibold text-foreground">${i18n("Feature Flags")}</div>
					<label class="text-xs text-muted-foreground flex items-center justify-between gap-2">
						<span>${i18n("Enable touch-first mobile shell")}</span>
						<input
							type="checkbox"
							.checked=${this.touchFirstFeatureFlags.touchFirstShell}
							@change=${(event: Event) => {
								this.touchFirstFeatureFlags = {
									...this.touchFirstFeatureFlags,
									touchFirstShell: (event.target as HTMLInputElement).checked,
								};
							}}
						/>
					</label>
					<label class="text-xs text-muted-foreground flex items-center justify-between gap-2">
						<span>${i18n("Enable automation defaults pack")}</span>
						<input
							type="checkbox"
							.checked=${this.touchFirstFeatureFlags.automationDefaults}
							@change=${(event: Event) => {
								this.touchFirstFeatureFlags = {
									...this.touchFirstFeatureFlags,
									automationDefaults: (event.target as HTMLInputElement).checked,
								};
							}}
						/>
					</label>
					<label class="text-xs text-muted-foreground flex items-center justify-between gap-2">
						<span>${i18n("Enable guided first-run onboarding")}</span>
						<input
							type="checkbox"
							.checked=${this.touchFirstFeatureFlags.guidedOnboarding}
							@change=${(event: Event) => {
								this.touchFirstFeatureFlags = {
									...this.touchFirstFeatureFlags,
									guidedOnboarding: (event.target as HTMLInputElement).checked,
								};
							}}
						/>
					</label>
				</div>

				<div class="border border-border rounded-lg p-3 space-y-3">
					<div class="text-sm font-semibold text-foreground">${i18n("Automation Defaults")}</div>
					<div class="grid grid-cols-1 gap-2">
						<label class="text-xs text-muted-foreground">${i18n("Default conversation style")}</label>
						<select
							class="text-xs bg-background border border-border rounded px-2 py-1"
							.value=${this.automationDefaults.defaultConversationStyle}
							@change=${(event: Event) => {
								this.automationDefaults = {
									...this.automationDefaults,
									defaultConversationStyle: (event.target as HTMLSelectElement)
										.value as AutomationDefaultsSettings["defaultConversationStyle"],
								};
							}}
						>
							<option value="default">${i18n("Default")}</option>
							<option value="caveman">${i18n("Caveman")}</option>
						</select>
					</div>
					<div class="grid grid-cols-1 gap-2">
						<label class="text-xs text-muted-foreground">${i18n("Default orchestration mode")}</label>
						<select
							class="text-xs bg-background border border-border rounded px-2 py-1"
							.value=${this.automationDefaults.defaultOrchestrationMode}
							@change=${(event: Event) => {
								this.automationDefaults = {
									...this.automationDefaults,
									defaultOrchestrationMode: (event.target as HTMLSelectElement)
										.value as AutomationDefaultsSettings["defaultOrchestrationMode"],
								};
							}}
						>
							<option value="single-agent">${i18n("Single agent")}</option>
							<option value="sequential">${i18n("Sequential")}</option>
						</select>
					</div>
					<div class="grid grid-cols-1 gap-2">
						<label class="text-xs text-muted-foreground">${i18n("Default startup surface")}</label>
						<select
							class="text-xs bg-background border border-border rounded px-2 py-1"
							.value=${this.automationDefaults.defaultStartupSurface}
							@change=${(event: Event) => {
								this.automationDefaults = {
									...this.automationDefaults,
									defaultStartupSurface: (event.target as HTMLSelectElement)
										.value as AutomationDefaultsSettings["defaultStartupSurface"],
								};
							}}
						>
							<option value="chat">${i18n("Chat")}</option>
							<option value="timeline">${i18n("Timeline")}</option>
							<option value="run-ops">${i18n("Run Ops")}</option>
						</select>
					</div>
					<label class="text-xs text-muted-foreground flex items-center justify-between gap-2">
						<span>${i18n("Auto-apply first local model for all specialist roles")}</span>
						<input
							type="checkbox"
							.checked=${this.automationDefaults.autoApplyFirstLocalModelForRoles}
							@change=${(event: Event) => {
								this.automationDefaults = {
									...this.automationDefaults,
									autoApplyFirstLocalModelForRoles: (event.target as HTMLInputElement).checked,
								};
							}}
						/>
					</label>
				</div>

				<div class="border border-border rounded-lg p-3 space-y-3">
					<div class="text-sm font-semibold text-foreground">${i18n("Guided Onboarding State")}</div>
					<div class="text-xs text-muted-foreground">
						${i18n("Completed")}: ${this.guidedOnboardingState.completed ? i18n("yes") : i18n("no")}
					</div>
					<div class="text-xs text-muted-foreground">
						${i18n("Steps")}: mode=${this.guidedOnboardingState.completedSteps.mode ? "1" : "0"}, provider=${
							this.guidedOnboardingState.completedSteps.provider ? "1" : "0"
						}, roleMapping=${this.guidedOnboardingState.completedSteps.roleMapping ? "1" : "0"}, firstRun=${
							this.guidedOnboardingState.completedSteps.firstRun ? "1" : "0"
						}
					</div>
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => void this.resetOnboarding(),
						children: i18n("Reset Onboarding"),
					})}
				</div>

				<div class="flex items-center gap-2">
					${Button({
						variant: "default",
						size: "sm",
						onClick: () => void this.saveState(),
						children: i18n("Save Touch-First Settings"),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						onClick: () => void this.loadState(),
						children: i18n("Reload"),
					})}
				</div>
				${this.saveMessage ? html`<div class="text-xs text-muted-foreground">${this.saveMessage}</div>` : ""}
			</div>
		`;
	}
}
