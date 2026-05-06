import { i18n } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { DialogBase } from "@mariozechner/mini-lit/dist/DialogBase.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { Switch } from "@mariozechner/mini-lit/dist/Switch.js";
import type { Model } from "@mariozechner/pi-ai";
import { html, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { getAppStorage } from "../storage/app-storage.js";
import type { CustomProvider } from "../storage/stores/custom-providers-store.js";
import type { SpecialistRoleModelMap } from "../storage/types.js";
import { discoverModels } from "../utils/model-discovery.js";

type LocalWizardType = "ollama" | "llama.cpp";
type WizardStatus = "idle" | "testing" | "connected" | "error";

export class LocalProvidersWizardDialog extends DialogBase {
	@state() private selectedType: LocalWizardType = "ollama";
	@state() private providerName = "Ollama Local";
	@state() private baseUrl = "http://localhost:11434";
	@state() private apiKey = "";
	@state() private status: WizardStatus = "idle";
	@state() private statusMessage = "";
	@state() private discoveredModels: Model<any>[] = [];
	@state() private applyFirstModelForAllRoles = true;
	@state() private autoSwitchActiveModel = true;

	private onSaveCallback?: () => void;

	protected modalWidth = "min(840px, 92vw)";
	protected modalHeight = "min(760px, 92vh)";

	static async open(onSave?: () => void) {
		const dialog = new LocalProvidersWizardDialog();
		dialog.onSaveCallback = onSave;
		document.body.appendChild(dialog);
		dialog.open();
		dialog.requestUpdate();
	}

	private selectType(type: LocalWizardType) {
		this.selectedType = type;
		if (type === "ollama") {
			this.providerName = "Ollama Local";
			this.baseUrl = "http://localhost:11434";
		} else {
			this.providerName = "llama.cpp Local";
			this.baseUrl = "http://localhost:8080";
		}
		this.status = "idle";
		this.statusMessage = "";
		this.discoveredModels = [];
	}

	private getProviderCommandHint(type: LocalWizardType): string {
		if (type === "ollama") {
			return "Run `ollama serve` and ensure models are pulled with `ollama pull <model>`.";
		}
		return "Run llama.cpp server with OpenAI-compatible endpoints, e.g. `llama-server --port 8080`.";
	}

	private getFriendlyError(type: LocalWizardType, baseUrl: string, err: unknown): string {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("Failed to fetch")) {
			return `${type} server is unreachable at ${baseUrl}. Confirm it is running and accessible from your browser.`;
		}
		if (message.includes("HTTP 404") || message.includes("/v1/models")) {
			return `${type} endpoint did not expose /v1/models at ${baseUrl}. Check base URL and server mode.`;
		}
		if (message.includes("CORS") || message.includes("NetworkError")) {
			return `Browser blocked access to ${baseUrl}. Check CORS/proxy settings in the app.`;
		}
		return message;
	}

	private async testAndDiscover() {
		this.status = "testing";
		this.statusMessage = "";
		this.discoveredModels = [];
		try {
			const models = await discoverModels(this.selectedType, this.baseUrl, this.apiKey || undefined);
			if (!models.length) {
				this.status = "error";
				this.statusMessage = "Server connected but no models were discovered.";
				return;
			}
			this.discoveredModels = models.map((model) => ({
				...model,
				provider: this.providerName,
			}));
			this.status = "connected";
			this.statusMessage = `Connected. Discovered ${this.discoveredModels.length} model(s).`;
		} catch (err) {
			this.status = "error";
			this.statusMessage = this.getFriendlyError(this.selectedType, this.baseUrl, err);
		}
	}

	private pickModelForRole(models: Model<any>[], role: keyof SpecialistRoleModelMap): Model<any> | undefined {
		if (models.length === 0) return undefined;
		const byName = (keywords: string[]) =>
			models.find((model) => {
				const name = `${model.id} ${model.name}`.toLowerCase();
				return keywords.some((keyword) => name.includes(keyword));
			});
		const reasoningModel = models.find((model) => model.reasoning);
		switch (role) {
			case "planner":
				return reasoningModel ?? byName(["instruct", "reason", "think"]) ?? models[0];
			case "coder":
				return byName(["code", "coder", "dev", "instruct"]) ?? models[0];
			case "reviewer":
				return reasoningModel ?? byName(["review", "judge", "critic"]) ?? models[0];
			case "summarizer":
				return byName(["mini", "small", "summary", "lite"]) ?? models[0];
			default:
				return models[0];
		}
	}

	private async saveProvider() {
		if (!this.providerName || !this.baseUrl) {
			alert("Provider name and base URL are required.");
			return;
		}
		if (!this.discoveredModels.length) {
			alert("Run Test Connection first and discover at least one model.");
			return;
		}

		const storage = getAppStorage();
		const existingProviders = await storage.customProviders.getAll();
		const existing = existingProviders.find((p) => p.type === this.selectedType && p.baseUrl === this.baseUrl);
		const providerId = existing?.id ?? crypto.randomUUID();

		const provider: CustomProvider = {
			id: providerId,
			name: this.providerName,
			type: this.selectedType,
			baseUrl: this.baseUrl,
			apiKey: this.apiKey || undefined,
			models: undefined,
		};
		await storage.customProviders.set(provider);

		const localProviderSetup = {
			completedAt: new Date().toISOString(),
			selectedProviderId: provider.id,
			selectedProviderType: this.selectedType,
			usedFirstModelForAllRoles: this.applyFirstModelForAllRoles,
			autoSwitchedToLocalModel: this.autoSwitchActiveModel,
			selectedModelId: this.discoveredModels[0]?.id,
			selectedProviderName: provider.name,
		};
		await storage.settings.set("orchestration.localProviderSetup", localProviderSetup);
		if (this.autoSwitchActiveModel && this.discoveredModels[0]) {
			await storage.settings.set("orchestration.activeLocalModel", {
				provider: this.discoveredModels[0].provider,
				modelId: this.discoveredModels[0].id,
			});
		}

		if (this.applyFirstModelForAllRoles && this.discoveredModels[0]) {
			const first = this.discoveredModels[0];
			const roleMap: SpecialistRoleModelMap = {
				planner: { provider: first.provider, modelId: first.id },
				coder: { provider: first.provider, modelId: first.id },
				reviewer: { provider: first.provider, modelId: first.id },
				summarizer: { provider: first.provider, modelId: first.id },
			};
			await storage.settings.set("orchestration.specialistRoleModelMap", roleMap);
		} else {
			const planner = this.pickModelForRole(this.discoveredModels, "planner");
			const coder = this.pickModelForRole(this.discoveredModels, "coder");
			const reviewer = this.pickModelForRole(this.discoveredModels, "reviewer");
			const summarizer = this.pickModelForRole(this.discoveredModels, "summarizer");
			const roleMap: SpecialistRoleModelMap = {};
			if (planner) roleMap.planner = { provider: planner.provider, modelId: planner.id };
			if (coder) roleMap.coder = { provider: coder.provider, modelId: coder.id };
			if (reviewer) roleMap.reviewer = { provider: reviewer.provider, modelId: reviewer.id };
			if (summarizer) roleMap.summarizer = { provider: summarizer.provider, modelId: summarizer.id };
			await storage.settings.set("orchestration.specialistRoleModelMap", roleMap);
		}

		this.onSaveCallback?.();
		this.close();
	}

	protected override renderContent(): TemplateResult {
		const statusColor =
			this.status === "connected"
				? "text-green-600"
				: this.status === "error"
					? "text-red-600"
					: this.status === "testing"
						? "text-yellow-600"
						: "text-muted-foreground";

		return html`
			<div class="flex flex-col h-full overflow-hidden">
				<div class="p-6 border-b border-border">
					<h2 class="text-lg font-semibold text-foreground">Set Up Local Models</h2>
					<p class="text-sm text-muted-foreground mt-2">
						Guided setup for Ollama and llama.cpp with auto-discovery and role mapping defaults.
					</p>
				</div>

				<div class="flex-1 overflow-y-auto p-6 space-y-4">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						<button
							class="border rounded-lg p-4 text-left ${this.selectedType === "ollama" ? "border-primary bg-primary/5" : "border-border"}"
							@click=${() => this.selectType("ollama")}
						>
							<div class="font-medium">Ollama</div>
							<div class="text-xs text-muted-foreground mt-1">http://localhost:11434</div>
						</button>
						<button
							class="border rounded-lg p-4 text-left ${this.selectedType === "llama.cpp" ? "border-primary bg-primary/5" : "border-border"}"
							@click=${() => this.selectType("llama.cpp")}
						>
							<div class="font-medium">llama.cpp</div>
							<div class="text-xs text-muted-foreground mt-1">http://localhost:8080</div>
						</button>
					</div>

					<div class="text-xs text-muted-foreground">${this.getProviderCommandHint(this.selectedType)}</div>

					<div class="space-y-2">
						<label class="text-sm font-medium text-foreground">${i18n("Provider Name")}</label>
						${Input({
							value: this.providerName,
							onInput: (e: Event) => {
								this.providerName = (e.target as HTMLInputElement).value;
							},
						})}
					</div>

					<div class="space-y-2">
						<label class="text-sm font-medium text-foreground">${i18n("Base URL")}</label>
						${Input({
							value: this.baseUrl,
							onInput: (e: Event) => {
								this.baseUrl = (e.target as HTMLInputElement).value;
							},
						})}
					</div>

					<div class="space-y-2">
						<label class="text-sm font-medium text-foreground">API Key (optional)</label>
						${Input({
							type: "password",
							value: this.apiKey,
							onInput: (e: Event) => {
								this.apiKey = (e.target as HTMLInputElement).value;
							},
						})}
					</div>

					<div class="flex items-center justify-between border border-border rounded-lg p-3">
						<div>
							<div class="text-sm font-medium text-foreground">Use first discovered model for all roles</div>
							<div class="text-xs text-muted-foreground">planner, coder, reviewer, summarizer</div>
						</div>
						${Switch({
							checked: this.applyFirstModelForAllRoles,
							onChange: (checked: boolean) => {
								this.applyFirstModelForAllRoles = checked;
							},
						})}
					</div>

					<div class="flex items-center justify-between border border-border rounded-lg p-3">
						<div>
							<div class="text-sm font-medium text-foreground">Auto-switch active model to local</div>
							<div class="text-xs text-muted-foreground">Use first discovered local model after setup.</div>
						</div>
						${Switch({
							checked: this.autoSwitchActiveModel,
							onChange: (checked: boolean) => {
								this.autoSwitchActiveModel = checked;
							},
						})}
					</div>

					<div class="space-y-2">
						${Button({
							variant: "outline",
							onClick: () => this.testAndDiscover(),
							disabled: this.status === "testing" || !this.baseUrl,
							children: this.status === "testing" ? i18n("Testing...") : i18n("Test Connection"),
						})}
						${this.statusMessage ? html`<div class="text-sm ${statusColor}">${this.statusMessage}</div>` : ""}
						${
							this.discoveredModels.length
								? html`
									<div class="text-xs text-muted-foreground">
										Discovered models:
										<ul class="list-disc pl-4 mt-1">
											${this.discoveredModels.slice(0, 8).map((m) => html`<li>${m.id}</li>`)}
											${
												this.discoveredModels.length > 8
													? html`<li>...${this.discoveredModels.length - 8} ${i18n("more")}</li>`
													: ""
											}
										</ul>
									</div>
								`
								: ""
						}
					</div>
				</div>

				<div class="p-6 border-t border-border flex justify-end gap-2">
					${Button({ variant: "ghost", onClick: () => this.close(), children: i18n("Cancel") })}
					${Button({
						variant: "default",
						onClick: () => this.saveProvider(),
						disabled: !this.discoveredModels.length,
						children: "Save Setup",
					})}
				</div>
			</div>
		`;
	}
}

customElements.define("local-providers-wizard-dialog", LocalProvidersWizardDialog);
