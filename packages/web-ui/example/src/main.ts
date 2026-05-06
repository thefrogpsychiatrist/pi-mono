import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import {
	Agent,
	type AgentMessage,
	type AgentSpecialistRole,
	type ConversationStyle,
	classifyTask,
	type HandoffEvent,
	type OrchestrationMode,
	type SequentialStep,
	specialistSystemInstruction,
} from "@mariozechner/pi-agent-core";
import { getModel, getModels, getProviders, type Model, type Usage } from "@mariozechner/pi-ai";
import {
	type AgentState,
	ApiKeyPromptDialog,
	AppStorage,
	type AutoDiscoveryProviderType,
	ChatPanel,
	CustomProvidersStore,
	createJavaScriptReplTool,
	discoverModels,
	getPluginSkillBackend,
	IndexedDBStorageBackend,
	type LocalProviderSetup,
	type OrchestrationStepTelemetry,
	type OrchestrationTelemetrySummary,
	type OrchestrationTrace,
	type PluginSkillSnapshot,
	PluginsTab,
	ProviderKeysStore,
	ProvidersModelsTab,
	ProxyTab,
	type RunBudgetSettings,
	SessionListDialog,
	SessionsStore,
	SettingsDialog,
	SettingsStore,
	type SettingsTab,
	SkillsTab,
	type SnapshotExportMetadata,
	type SpecialistRoleModelMap,
	type ConversationStyle as StoredConversationStyle,
	setAppStorage,
	setPluginSkillBackend,
} from "@mariozechner/pi-web-ui";
import { html, render, type TemplateResult } from "lit";
import { Download, History, Play, Plus, Settings, Sparkles } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import "./LocalRoleMappingTab.js";
import { createSystemNotification, customConvertToLlm, registerCustomMessageRenderers } from "./custom-messages.js";
import { createPluginSkillBackendFromWindow } from "./plugin-skill-rpc-backend.js";

registerCustomMessageRenderers();

const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const configs = [
	settings.getConfig(),
	SessionsStore.getMetadataConfig(),
	providerKeys.getConfig(),
	customProviders.getConfig(),
	sessions.getConfig(),
];

const backend = new IndexedDBStorageBackend({
	dbName: "pi-web-ui-example",
	version: 3,
	stores: configs,
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
customProviders.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);
setPluginSkillBackend(createPluginSkillBackendFromWindow());

type RouteStepPlan = SequentialStep & {
	selectedProvider?: string;
	selectedModelId?: string;
	retries: number;
	estimatedContextTokens: number;
};

interface ActiveLocalModelSelection {
	provider: string;
	modelId: string;
}

interface SequentialFailureState {
	index: number;
	errorMessage: string;
	overrideRole: AgentSpecialistRole;
	overrideModelId?: string;
	overrideProvider?: string;
}

interface SequentialRunState {
	input: string;
	steps: RouteStepPlan[];
	index: number;
	previousSummary: string;
	routingReason: string;
}

interface PromptTemplate {
	id: string;
	label: string;
	description: string;
	text: string;
	mode: OrchestrationMode;
}

interface ToastMessage {
	id: string;
	text: string;
	variant: "default" | "destructive";
}

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DEFAULT_BUDGET_SETTINGS: RunBudgetSettings = {
	enabled: false,
	maxTokens: 12000,
	maxCost: 0.5,
	onExceed: "confirm",
};

const PROMPT_TEMPLATES: PromptTemplate[] = [
	{
		id: "ui-pass",
		label: "UI Product Pass",
		description: "Plan + implement a full UI pass with acceptance checks.",
		mode: "sequential",
		text: "Build a full UI product pass with deterministic routing, telemetry, and regression validation.",
	},
	{
		id: "bug-triage",
		label: "Bug Triage",
		description: "Trace root cause, implement a fix, and review risks.",
		mode: "sequential",
		text: "Investigate this bug, identify root cause, implement the fix, and provide regression risks and coverage gaps.",
	},
	{
		id: "single-quick",
		label: "Quick Single-Agent",
		description: "Fast direct answer with minimal orchestration overhead.",
		mode: "single-agent",
		text: "Give a direct technical answer with concrete next actions.",
	},
];

let currentSessionId: string | undefined;
let currentTitle = "";
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;
let conversationStyle: ConversationStyle = "default";
let orchestrationMode: OrchestrationMode = "single-agent";
let orchestrationTrace: OrchestrationTrace = { steps: [], events: [], contextStrategy: "auto-context" };
let orchestrationTelemetry: OrchestrationTelemetrySummary | null = null;
let activeSpecialist: AgentSpecialistRole | null = null;
let localProviderSetup: LocalProviderSetup | null = null;
let specialistRoleModelMap: SpecialistRoleModelMap = {};
let runBudgetSettings: RunBudgetSettings = { ...DEFAULT_BUDGET_SETTINGS };
let snapshotExportMetadata: SnapshotExportMetadata | null = null;
let pluginSkillSnapshot: PluginSkillSnapshot | null = null;
let availableModelsCache: Model<any>[] = [];
let pendingSequentialInput: string | null = null;
let routeDraft: RouteStepPlan[] = [];
let routeReason = "";
let activeRunState: SequentialRunState | null = null;
let sequentialFailure: SequentialFailureState | null = null;
let selectedTemplateId = PROMPT_TEMPLATES[0]?.id ?? "";
let toasts: ToastMessage[] = [];
let onboardingHints = {
	orchestration: true,
	providers: true,
	budgets: true,
};

const generateTitle = (messages: AgentMessage[]): string => {
	const firstUserMsg = messages.find((m) => m.role === "user" || m.role === "user-with-attachments");
	if (!firstUserMsg || (firstUserMsg.role !== "user" && firstUserMsg.role !== "user-with-attachments")) return "";
	const content = firstUserMsg.content;
	const text =
		typeof content === "string"
			? content
			: content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join(" ");
	const trimmed = text.trim();
	if (!trimmed) return "";
	const sentenceEnd = trimmed.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 50) return trimmed.substring(0, sentenceEnd + 1);
	return trimmed.length <= 50 ? trimmed : `${trimmed.substring(0, 47)}...`;
};

const shouldSaveSession = (messages: AgentMessage[]): boolean => {
	const hasUserMsg = messages.some((m) => m.role === "user" || m.role === "user-with-attachments");
	const hasAssistantMsg = messages.some((m) => m.role === "assistant");
	return hasUserMsg && hasAssistantMsg;
};

function cloneUsage(usage: Usage): Usage {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: {
			input: usage.cost.input,
			output: usage.cost.output,
			cacheRead: usage.cost.cacheRead,
			cacheWrite: usage.cost.cacheWrite,
			total: usage.cost.total,
		},
	};
}

function addUsage(target: Usage, increment: Usage): Usage {
	return {
		input: target.input + increment.input,
		output: target.output + increment.output,
		cacheRead: target.cacheRead + increment.cacheRead,
		cacheWrite: target.cacheWrite + increment.cacheWrite,
		totalTokens: target.totalTokens + increment.totalTokens,
		cost: {
			input: target.cost.input + increment.cost.input,
			output: target.cost.output + increment.cost.output,
			cacheRead: target.cost.cacheRead + increment.cost.cacheRead,
			cacheWrite: target.cost.cacheWrite + increment.cost.cacheWrite,
			total: target.cost.total + increment.cost.total,
		},
	};
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function caveManPrefix(input: string): string {
	if (conversationStyle === "default") return input;
	return `Use caveman speaking style: short phrases, minimal grammar, no fluff, keep technical accuracy.\n\nUser request:\n${input}`;
}

function addToast(text: string, variant: "default" | "destructive" = "default"): void {
	const id = crypto.randomUUID();
	toasts = [...toasts, { id, text, variant }];
	window.setTimeout(() => {
		toasts = toasts.filter((toast) => toast.id !== id);
		renderApp();
	}, 3200);
}

function toSequentialStep(step: RouteStepPlan): SequentialStep {
	return {
		id: step.id,
		role: step.role,
		title: step.title,
		status: step.status,
		task: step.task,
		resultSummary: step.resultSummary,
	};
}

function pushOrchestrationMessage(step: RouteStepPlan, reason: string, fromRole?: AgentSpecialistRole): void {
	const serializableStep = toSequentialStep(step);
	const handoff: HandoffEvent = {
		stepId: serializableStep.id,
		fromRole,
		toRole: serializableStep.role,
		reason,
		timestamp: Date.now(),
	};
	orchestrationTrace.events.push(handoff);
	agent.state.messages.push({
		role: "orchestration",
		timestamp: handoff.timestamp,
		step: serializableStep,
		handoffReason: reason,
		fromRole,
		toRole: serializableStep.role,
	});
	void agent.emitOrchestrationTransition(handoff, serializableStep);
}

function summarizeLatestAssistantMessage(): string {
	for (let i = agent.state.messages.length - 1; i >= 0; i--) {
		const message = agent.state.messages[i];
		if (message.role === "assistant") {
			const text = message.content
				.filter((chunk): chunk is { type: "text"; text: string } => chunk.type === "text")
				.map((chunk) => chunk.text)
				.join(" ")
				.trim();
			return text.length <= 280 ? text : `${text.slice(0, 277)}...`;
		}
	}
	return "";
}

function getLatestAssistantUsage(): Usage {
	for (let i = agent.state.messages.length - 1; i >= 0; i--) {
		const message = agent.state.messages[i];
		if (message.role === "assistant") {
			return cloneUsage(message.usage);
		}
	}
	return cloneUsage(EMPTY_USAGE);
}

async function loadAvailableModels(): Promise<Model<any>[]> {
	const models: Model<any>[] = [];
	for (const provider of getProviders()) {
		models.push(...getModels(provider));
	}

	const customProviderList = await storage.customProviders.getAll();
	for (const provider of customProviderList) {
		const isAutoDiscovery =
			provider.type === "ollama" ||
			provider.type === "llama.cpp" ||
			provider.type === "vllm" ||
			provider.type === "lmstudio" ||
			provider.type === "ollama-cloud";
		if (isAutoDiscovery) {
			try {
				const discovered = await discoverModels(
					provider.type as AutoDiscoveryProviderType,
					provider.baseUrl,
					provider.apiKey,
					{
						ollamaCloudMode: provider.ollamaCloudMode,
					},
				);
				models.push(...discovered.map((model) => ({ ...model, provider: provider.name })));
			} catch (_err) {
				// Ignore discovery failures and continue with available models.
			}
		} else if (provider.models?.length) {
			models.push(...provider.models);
		}
	}

	return models;
}

async function refreshAvailableModels(): Promise<void> {
	availableModelsCache = await loadAvailableModels();
}

async function loadOrchestrationSettings() {
	localProviderSetup =
		(await storage.settings.get<LocalProviderSetup>("orchestration.localProviderSetup")) ?? localProviderSetup;
	specialistRoleModelMap =
		(await storage.settings.get<SpecialistRoleModelMap>("orchestration.specialistRoleModelMap")) ??
		specialistRoleModelMap;
	runBudgetSettings =
		(await storage.settings.get<RunBudgetSettings>("orchestration.runBudgetSettings")) ?? runBudgetSettings;
	snapshotExportMetadata =
		(await storage.settings.get<SnapshotExportMetadata>("orchestration.snapshotExportMetadata")) ??
		snapshotExportMetadata;
	pluginSkillSnapshot =
		(await storage.settings.get<PluginSkillSnapshot>("orchestration.pluginSkillSnapshot")) ?? pluginSkillSnapshot;
	const hints = await storage.settings.get<typeof onboardingHints>("orchestration.onboardingHints");
	if (hints) onboardingHints = hints;
	const templateId = await storage.settings.get<string>("orchestration.selectedTemplateId");
	if (templateId) selectedTemplateId = templateId;
}

async function persistOrchestrationSettings() {
	await storage.settings.set("orchestration.runBudgetSettings", runBudgetSettings);
	await storage.settings.set("orchestration.onboardingHints", onboardingHints);
	await storage.settings.set("orchestration.selectedTemplateId", selectedTemplateId);
	if (snapshotExportMetadata) {
		await storage.settings.set("orchestration.snapshotExportMetadata", snapshotExportMetadata);
	}
	if (pluginSkillSnapshot) {
		await storage.settings.set("orchestration.pluginSkillSnapshot", pluginSkillSnapshot);
	}
}

async function syncPluginSkillSnapshot(): Promise<void> {
	const backend = getPluginSkillBackend();
	if (!backend) return;
	try {
		const state = await backend.getState();
		pluginSkillSnapshot = {
			lastSyncedAt: new Date().toISOString(),
			pluginCount: state.plugins.length,
			skillCount: state.skills.length,
			auditEntries: state.audit.totalEntries,
		};
		await storage.settings.set("orchestration.pluginSkillSnapshot", pluginSkillSnapshot);
	} catch (_error) {
		// Leave snapshot untouched if backend is unavailable.
	}
}

function resolveRoleMappedModel(
	role: AgentSpecialistRole,
	models: Model<any>[],
	map: SpecialistRoleModelMap,
): Model<any> | undefined {
	const selection = map[role];
	if (!selection) return undefined;
	return models.find((model) => model.provider === selection.provider && model.id === selection.modelId);
}

function resolveSelectedModelForStep(step: RouteStepPlan): Model<any> | undefined {
	if (step.selectedProvider && step.selectedModelId) {
		return availableModelsCache.find(
			(model) => model.provider === step.selectedProvider && model.id === step.selectedModelId,
		);
	}
	return undefined;
}

function evaluateBudgetGuardrails(): boolean {
	if (!runBudgetSettings.enabled || !orchestrationTelemetry) return true;
	const overTokens = orchestrationTelemetry.totalUsage.totalTokens > runBudgetSettings.maxTokens;
	const overCost = orchestrationTelemetry.totalUsage.cost.total > runBudgetSettings.maxCost;
	if (!overTokens && !overCost) return true;
	const reason = `Budget limit exceeded (tokens ${orchestrationTelemetry.totalUsage.totalTokens}/${runBudgetSettings.maxTokens}, cost ${orchestrationTelemetry.totalUsage.cost.total.toFixed(4)}/${runBudgetSettings.maxCost.toFixed(4)}).`;
	if (runBudgetSettings.onExceed === "stop") {
		addToast(reason, "destructive");
		orchestrationTrace.abortedReason = reason;
		orchestrationTelemetry.runStatus = "aborted";
		orchestrationTelemetry.runCompletedAt = Date.now();
		return false;
	}
	const shouldContinue = window.confirm(`${reason}\nContinue the sequential run?`);
	if (!shouldContinue) {
		orchestrationTrace.abortedReason = "User stopped run after budget threshold confirmation.";
		orchestrationTelemetry.runStatus = "aborted";
		orchestrationTelemetry.runCompletedAt = Date.now();
	}
	return shouldContinue;
}

function buildRouteDraft(input: string): RouteStepPlan[] {
	const selectedRule = classifyTask(input);
	routeReason = selectedRule.reason;
	return selectedRule.steps.map((step, index) => {
		const mapped = resolveRoleMappedModel(step.role, availableModelsCache, specialistRoleModelMap);
		return {
			id: `step-${index + 1}`,
			role: step.role,
			title: step.title,
			status: "queued",
			task: input,
			retries: 0,
			estimatedContextTokens: estimateTokens(input),
			selectedModelId: mapped?.id ?? agent.state.model.id,
			selectedProvider: mapped?.provider ?? agent.state.model.provider,
		};
	});
}

async function openRouteDraftForInput(input: string): Promise<void> {
	await loadOrchestrationSettings();
	await refreshAvailableModels();
	pendingSequentialInput = input;
	routeDraft = buildRouteDraft(input);
	sequentialFailure = null;
	onboardingHints.orchestration = false;
	await persistOrchestrationSettings();
	addToast("Sequential route prepared. Review and click Start Run.");
	renderApp();
}

function updateRouteStep(stepId: string, patch: Partial<RouteStepPlan>): void {
	routeDraft = routeDraft.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
	renderApp();
}

function buildSpecialistPrompt(input: string, step: RouteStepPlan, previousSummary: string, index: number): string {
	const autoContextNote =
		index === 0
			? `Auto-context includes: current user request.`
			: `Auto-context includes: current user request + previous specialist summary.`;
	if (index === 0) {
		return `${specialistSystemInstruction(step.role)}\n\n${autoContextNote}\n\n${caveManPrefix(input)}`;
	}
	return `${specialistSystemInstruction(step.role)}\n\n${autoContextNote}\n\nPrevious specialist summary:\n${previousSummary}\n\nContinue task with focus on ${step.title}.`;
}

function initializeTelemetry(): OrchestrationTelemetrySummary {
	return {
		runStartedAt: Date.now(),
		runStatus: "running",
		steps: [],
		totalUsage: cloneUsage(EMPTY_USAGE),
	};
}

async function runSequentialFromActiveState(): Promise<void> {
	if (!activeRunState || !orchestrationTelemetry) return;
	const runState = activeRunState;
	while (runState.index < runState.steps.length) {
		const step = runState.steps[runState.index];
		const previousRole = runState.index > 0 ? runState.steps[runState.index - 1]?.role : undefined;
		activeSpecialist = step.role;
		runState.steps = runState.steps.map((entry, idx) => {
			if (idx < runState.index && entry.status !== "failed-step") {
				return { ...entry, status: "completed-step" };
			}
			if (entry.id === step.id) {
				return { ...entry, status: "active-agent" };
			}
			return entry.status === "failed-step" ? entry : { ...entry, status: "queued" };
		});
		routeDraft = runState.steps.slice();
		orchestrationTrace.steps = runState.steps.map((entry) => toSequentialStep(entry));
		pushOrchestrationMessage(step, runState.routingReason, previousRole);
		addToast(`Running ${step.role}: ${step.title}`);

		const selectedModel =
			resolveSelectedModelForStep(step) ??
			resolveRoleMappedModel(step.role, availableModelsCache, specialistRoleModelMap);
		if (selectedModel) {
			agent.state.model = selectedModel;
		}
		const modelInUse = agent.state.model;
		const contextText = runState.index === 0 ? runState.input : `${runState.input}\n${runState.previousSummary}`;
		const estimatedContextTokens = estimateTokens(contextText);
		const startedAt = Date.now();
		const prompt = buildSpecialistPrompt(runState.input, step, runState.previousSummary, runState.index);

		try {
			await agent.prompt(prompt);
			const summary = summarizeLatestAssistantMessage();
			const usage = getLatestAssistantUsage();
			const completedAt = Date.now();
			const durationMs = completedAt - startedAt;
			const telemetryStep: OrchestrationStepTelemetry = {
				stepId: step.id,
				role: step.role,
				provider: modelInUse.provider,
				modelId: modelInUse.id,
				status: "completed-step",
				startedAt,
				completedAt,
				durationMs,
				retries: step.retries,
				estimatedContextTokens,
				usage,
			};
			orchestrationTelemetry.steps = [...orchestrationTelemetry.steps, telemetryStep];
			orchestrationTelemetry.totalUsage = addUsage(orchestrationTelemetry.totalUsage, usage);
			runState.previousSummary = summary;
			runState.steps = runState.steps.map((entry) =>
				entry.id === step.id
					? {
							...entry,
							status: "completed-step",
							resultSummary: summary,
							selectedModelId: modelInUse.id,
							selectedProvider: modelInUse.provider,
							estimatedContextTokens,
						}
					: entry,
			);
			routeDraft = runState.steps.slice();
			orchestrationTrace.steps = runState.steps.map((entry) => toSequentialStep(entry));
			orchestrationTrace.telemetry = orchestrationTelemetry;
			addToast(`${step.role} completed`);
			runState.index++;
			if (!evaluateBudgetGuardrails()) {
				activeSpecialist = null;
				orchestrationTrace.finalSummary = runState.previousSummary;
				orchestrationTrace.telemetry = orchestrationTelemetry;
				activeRunState = runState;
				await saveSession();
				renderApp();
				return;
			}
		} catch (error) {
			const completedAt = Date.now();
			const durationMs = completedAt - startedAt;
			const errorMessage = error instanceof Error ? error.message : String(error);
			const failedTelemetry: OrchestrationStepTelemetry = {
				stepId: step.id,
				role: step.role,
				provider: modelInUse.provider,
				modelId: modelInUse.id,
				status: "failed-step",
				startedAt,
				completedAt,
				durationMs,
				retries: step.retries,
				estimatedContextTokens,
				usage: cloneUsage(EMPTY_USAGE),
				errorMessage,
			};
			orchestrationTelemetry.steps = [...orchestrationTelemetry.steps, failedTelemetry];
			orchestrationTelemetry.runStatus = "failed";
			orchestrationTelemetry.runCompletedAt = Date.now();
			runState.steps = runState.steps.map((entry) =>
				entry.id === step.id ? { ...entry, status: "failed-step", estimatedContextTokens } : entry,
			);
			routeDraft = runState.steps.slice();
			orchestrationTrace.steps = runState.steps.map((entry) => toSequentialStep(entry));
			orchestrationTrace.telemetry = orchestrationTelemetry;
			sequentialFailure = {
				index: runState.index,
				errorMessage,
				overrideRole: step.role,
				overrideModelId: modelInUse.id,
				overrideProvider: modelInUse.provider,
			};
			addToast(`Step failed: ${step.title}`, "destructive");
			activeSpecialist = null;
			activeRunState = runState;
			await saveSession();
			renderApp();
			return;
		}
		renderApp();
	}

	activeSpecialist = null;
	sequentialFailure = null;
	orchestrationTrace.finalSummary = runState.previousSummary;
	orchestrationTelemetry.runStatus = "completed";
	orchestrationTelemetry.runCompletedAt = Date.now();
	orchestrationTrace.telemetry = orchestrationTelemetry;
	pendingSequentialInput = null;
	activeRunState = null;
	addToast("Sequential run completed.");
	await saveSession();
	renderApp();
}

async function startSequentialRunFromDraft(): Promise<void> {
	if (!pendingSequentialInput || routeDraft.length === 0) {
		addToast("No sequential draft available. Send a prompt first.", "destructive");
		return;
	}
	await refreshAvailableModels();
	routeDraft = routeDraft.map((step) => ({ ...step, status: "queued" }));
	orchestrationTrace = {
		steps: routeDraft.map((step) => toSequentialStep(step)),
		events: [],
		contextStrategy: "auto-context",
	};
	orchestrationTelemetry = initializeTelemetry();
	orchestrationTrace.telemetry = orchestrationTelemetry;
	activeRunState = {
		input: pendingSequentialInput,
		steps: routeDraft.slice(),
		index: 0,
		previousSummary: "",
		routingReason: routeReason || "User-reviewed route",
	};
	sequentialFailure = null;
	await runSequentialFromActiveState();
}

async function retryFailedStep(): Promise<void> {
	if (!sequentialFailure || !activeRunState || !orchestrationTelemetry) return;
	const failure = sequentialFailure;
	const failedStep = activeRunState.steps[failure.index];
	if (!failedStep) return;
	const updatedStep: RouteStepPlan = {
		...failedStep,
		role: failure.overrideRole,
		selectedModelId: failure.overrideModelId,
		selectedProvider: failure.overrideProvider,
		retries: failedStep.retries + 1,
		status: "queued",
	};
	activeRunState.steps = activeRunState.steps.map((step, index) => (index === failure.index ? updatedStep : step));
	routeDraft = activeRunState.steps.slice();
	sequentialFailure = null;
	orchestrationTelemetry.runStatus = "running";
	orchestrationTelemetry.runCompletedAt = undefined;
	await runSequentialFromActiveState();
}

async function skipFailedStep(): Promise<void> {
	if (!sequentialFailure || !activeRunState || !orchestrationTelemetry) return;
	const failure = sequentialFailure;
	const failedStep = activeRunState.steps[failure.index];
	if (!failedStep) return;
	activeRunState.steps = activeRunState.steps.map((step, index) =>
		index === failure.index ? { ...step, status: "completed-step", resultSummary: "Skipped after failure." } : step,
	);
	activeRunState.index = failure.index + 1;
	routeDraft = activeRunState.steps.slice();
	sequentialFailure = null;
	orchestrationTelemetry.runStatus = "running";
	orchestrationTelemetry.runCompletedAt = undefined;
	await runSequentialFromActiveState();
}

async function abortSequentialRun(): Promise<void> {
	if (!orchestrationTelemetry) return;
	activeSpecialist = null;
	sequentialFailure = null;
	activeRunState = null;
	orchestrationTelemetry.runStatus = "aborted";
	orchestrationTelemetry.runCompletedAt = Date.now();
	orchestrationTrace.telemetry = orchestrationTelemetry;
	orchestrationTrace.abortedReason = "Run aborted by user.";
	addToast("Sequential run aborted.");
	await saveSession();
	renderApp();
}

function updateUrl(sessionId: string) {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.history.replaceState({}, "", url);
}

function formatCost(value: number): string {
	return `$${value.toFixed(4)}`;
}

function renderTemplateControls(): TemplateResult {
	const template = PROMPT_TEMPLATES.find((entry) => entry.id === selectedTemplateId);
	return html`
		<div class="flex flex-wrap items-center gap-2">
			<select
				class="text-xs bg-background border border-border rounded px-2 py-1"
				@change=${(e: Event) => {
					selectedTemplateId = (e.target as HTMLSelectElement).value;
					void persistOrchestrationSettings();
					renderApp();
				}}
			>
				${PROMPT_TEMPLATES.map(
					(entry) =>
						html`<option value=${entry.id} ?selected=${entry.id === selectedTemplateId}>Template: ${entry.label}</option>`,
				)}
			</select>
			${Button({
				variant: "outline",
				size: "sm",
				children: "Insert Template",
				onClick: async () => {
					const selected = PROMPT_TEMPLATES.find((entry) => entry.id === selectedTemplateId);
					if (!selected || !chatPanel.agentInterface) return;
					orchestrationMode = selected.mode;
					chatPanel.agentInterface.setInput(selected.text);
					await persistOrchestrationSettings();
					renderApp();
				},
			})}
			${template ? html`<span class="text-xs text-muted-foreground">${template.description}</span>` : ""}
		</div>
	`;
}

function buildRunSnapshot() {
	return {
		exportedAt: new Date().toISOString(),
		sessionId: currentSessionId,
		sessionTitle: currentTitle,
		conversationStyle,
		orchestrationMode,
		localProviderSetup,
		specialistRoleModelMap,
		pluginSkillSnapshot,
		runBudgetSettings,
		orchestrationTrace,
		orchestrationTelemetry,
		messageCount: agent.state.messages.length,
		model: agent.state.model,
	};
}

function snapshotAsMarkdown(snapshot: ReturnType<typeof buildRunSnapshot>): string {
	const stepLines = (snapshot.orchestrationTrace.steps || [])
		.map((step) => `- ${step.title} (${step.role}) - ${step.status}`)
		.join("\n");
	const eventLines = (snapshot.orchestrationTrace.events || [])
		.map(
			(event) =>
				`- ${new Date(event.timestamp).toISOString()} ${event.fromRole ?? "start"} -> ${event.toRole}: ${event.reason}`,
		)
		.join("\n");
	const telemetry = snapshot.orchestrationTelemetry;
	const telemetryLine = telemetry
		? `Total tokens: ${telemetry.totalUsage.totalTokens}, total cost: ${telemetry.totalUsage.cost.total.toFixed(6)}, status: ${telemetry.runStatus}`
		: "No telemetry available.";
	const pluginSkillLine = snapshot.pluginSkillSnapshot
		? `Plugins: ${snapshot.pluginSkillSnapshot.pluginCount}, Skills: ${snapshot.pluginSkillSnapshot.skillCount}, Audit Entries: ${snapshot.pluginSkillSnapshot.auditEntries}`
		: "Plugin/skill snapshot unavailable.";
	return `# PI Run Snapshot

- Exported: ${snapshot.exportedAt}
- Session: ${snapshot.sessionTitle || "Untitled"} (${snapshot.sessionId ?? "not-saved"})
- Style: ${snapshot.conversationStyle}
- Mode: ${snapshot.orchestrationMode}
- Active model: ${snapshot.model.provider}/${snapshot.model.id}

## Timeline
${stepLines || "- No steps"}

## Handoff Events
${eventLines || "- No events"}

## Telemetry
${telemetryLine}

## Plugin & Skill Snapshot
${pluginSkillLine}
`;
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

async function exportSnapshot(format: "json" | "markdown"): Promise<void> {
	const snapshot = buildRunSnapshot();
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	if (format === "json") {
		downloadTextFile(`pi-run-snapshot-${timestamp}.json`, JSON.stringify(snapshot, null, 2), "application/json");
	} else {
		downloadTextFile(`pi-run-snapshot-${timestamp}.md`, snapshotAsMarkdown(snapshot), "text/markdown");
	}
	const previousFormats = snapshotExportMetadata?.lastExportFormats ?? [];
	snapshotExportMetadata = {
		lastExportAt: new Date().toISOString(),
		lastExportFormats: Array.from(new Set([...previousFormats, format])),
	};
	await persistOrchestrationSettings();
	addToast(`Exported ${format.toUpperCase()} snapshot.`);
}

async function applyAutoSwitchedLocalModel(): Promise<void> {
	const selection = await storage.settings.get<ActiveLocalModelSelection>("orchestration.activeLocalModel");
	if (!selection) return;
	await refreshAvailableModels();
	const selectedModel = availableModelsCache.find(
		(model) => model.provider === selection.provider && model.id === selection.modelId,
	);
	if (selectedModel) {
		agent.state.model = selectedModel;
		addToast(`Switched active model to ${selectedModel.provider}/${selectedModel.id}.`);
	}
}

const saveSession = async () => {
	if (!storage.sessions || !currentSessionId || !agent || !currentTitle) return;
	const state = agent.state;
	if (!shouldSaveSession(state.messages)) return;
	try {
		await loadOrchestrationSettings();
		const now = new Date().toISOString();
		const sessionData = {
			id: currentSessionId,
			title: currentTitle,
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			messages: state.messages,
			createdAt: now,
			lastModified: now,
			conversationStyle: conversationStyle as StoredConversationStyle,
			orchestrationMode,
			orchestrationTrace,
			localProviderSetup: localProviderSetup ?? undefined,
			specialistRoleModelMap: specialistRoleModelMap ?? undefined,
			runBudgetSettings,
			orchestrationTelemetry: orchestrationTelemetry ?? undefined,
			snapshotExportMetadata: snapshotExportMetadata ?? undefined,
			pluginSkillSnapshot: pluginSkillSnapshot ?? undefined,
		};
		const metadata = {
			id: currentSessionId,
			title: currentTitle,
			createdAt: now,
			lastModified: now,
			messageCount: state.messages.length,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			thinkingLevel: state.thinkingLevel,
			preview: generateTitle(state.messages),
			conversationStyle: conversationStyle as StoredConversationStyle,
			orchestrationMode,
			orchestrationTrace,
			localProviderSetup: localProviderSetup ?? undefined,
			specialistRoleModelMap: specialistRoleModelMap ?? undefined,
			runBudgetSettings,
			orchestrationTelemetry: orchestrationTelemetry ?? undefined,
			snapshotExportMetadata: snapshotExportMetadata ?? undefined,
			pluginSkillSnapshot: pluginSkillSnapshot ?? undefined,
		};
		await storage.sessions.save(sessionData, metadata);
	} catch (err) {
		console.error("Failed to save session:", err);
	}
};

const createAgent = async (initialState?: Partial<AgentState>) => {
	if (agentUnsubscribe) {
		agentUnsubscribe();
	}
	agent = new Agent({
		initialState: initialState || {
			systemPrompt: `You are a helpful AI assistant with access to tools.`,
			model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		convertToLlm: customConvertToLlm,
	});
	agentUnsubscribe = agent.subscribe((event) => {
		if (event.type === "message_end" || event.type === "agent_end" || event.type === "orchestration_transition") {
			const messages = agent.state.messages;
			if (!currentTitle && shouldSaveSession(messages)) currentTitle = generateTitle(messages);
			if (!currentSessionId && shouldSaveSession(messages)) {
				currentSessionId = crypto.randomUUID();
				updateUrl(currentSessionId);
			}
			if (currentSessionId) void saveSession();
			renderApp();
		}
	});
	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (provider: string) => ApiKeyPromptDialog.prompt(provider),
		toolsFactory: (_agent, _agentInterface, _artifactsPanel, runtimeProvidersFactory) => {
			const replTool = createJavaScriptReplTool();
			replTool.runtimeProvidersFactory = runtimeProvidersFactory;
			return [replTool];
		},
		messageInterceptor: async (input) => {
			if (orchestrationMode === "sequential") {
				await openRouteDraftForInput(input);
				return { handled: true };
			}
			if (conversationStyle === "caveman") {
				await agent.prompt(caveManPrefix(input));
				return { handled: true };
			}
			return { handled: false };
		},
	});
};

const loadSession = async (sessionId: string): Promise<boolean> => {
	if (!storage.sessions) return false;
	const sessionData = await storage.sessions.get(sessionId);
	if (!sessionData) return false;
	currentSessionId = sessionId;
	const metadata = await storage.sessions.getMetadata(sessionId);
	currentTitle = metadata?.title || "";
	conversationStyle = sessionData.conversationStyle || "default";
	orchestrationMode = sessionData.orchestrationMode || "single-agent";
	orchestrationTrace = sessionData.orchestrationTrace || { steps: [], events: [], contextStrategy: "auto-context" };
	localProviderSetup = sessionData.localProviderSetup || null;
	specialistRoleModelMap = sessionData.specialistRoleModelMap || {};
	runBudgetSettings = sessionData.runBudgetSettings || { ...DEFAULT_BUDGET_SETTINGS };
	orchestrationTelemetry = sessionData.orchestrationTelemetry || null;
	snapshotExportMetadata = sessionData.snapshotExportMetadata || null;
	pluginSkillSnapshot = sessionData.pluginSkillSnapshot || null;
	await createAgent({
		model: sessionData.model,
		thinkingLevel: sessionData.thinkingLevel,
		messages: sessionData.messages,
		tools: [],
	});
	updateUrl(sessionId);
	renderApp();
	return true;
};

const newSession = () => {
	const url = new URL(window.location.href);
	url.search = "";
	window.location.href = url.toString();
};

function renderFailurePanel(): TemplateResult {
	if (!sequentialFailure || !activeRunState) return html``;
	const failure = sequentialFailure;
	const step = activeRunState.steps[failure.index];
	return html`
		<div class="border border-destructive/40 rounded-md p-3 bg-destructive/5 space-y-2">
			<div class="text-xs uppercase tracking-wide text-destructive">Step failed</div>
			<div class="text-sm text-foreground">${failure.errorMessage}</div>
			<div class="grid grid-cols-1 gap-2">
				<label class="text-xs text-muted-foreground">Retry role</label>
				<select
					class="text-xs bg-background border border-border rounded px-2 py-1"
					@change=${(e: Event) => {
						if (!sequentialFailure) return;
						sequentialFailure = {
							...sequentialFailure,
							overrideRole: (e.target as HTMLSelectElement).value as AgentSpecialistRole,
						};
						renderApp();
					}}
				>
					${(["planner", "coder", "reviewer", "summarizer"] as const).map(
						(role) => html`<option value=${role} ?selected=${role === failure.overrideRole}>${role}</option>`,
					)}
				</select>
				<label class="text-xs text-muted-foreground">Retry model</label>
				<select
					class="text-xs bg-background border border-border rounded px-2 py-1"
					@change=${(e: Event) => {
						const value = (e.target as HTMLSelectElement).value;
						const [provider, modelId] = value.split("::");
						if (!sequentialFailure) return;
						sequentialFailure = {
							...sequentialFailure,
							overrideProvider: provider,
							overrideModelId: modelId,
						};
						renderApp();
					}}
				>
					${availableModelsCache.map(
						(model) => html`
							<option
								value=${`${model.provider}::${model.id}`}
								?selected=${model.provider === failure.overrideProvider && model.id === failure.overrideModelId}
							>
								${model.provider}/${model.id}
							</option>
						`,
					)}
				</select>
			</div>
			<div class="flex flex-wrap gap-2">
				${Button({ variant: "default", size: "sm", children: "Retry Step", onClick: () => void retryFailedStep() })}
				${Button({ variant: "outline", size: "sm", children: "Skip Step", onClick: () => void skipFailedStep() })}
				${Button({ variant: "ghost", size: "sm", children: "Abort Run", onClick: () => void abortSequentialRun() })}
			</div>
			<div class="text-xs text-muted-foreground">Failed stage: ${step?.title ?? "unknown step"}</div>
		</div>
	`;
}

function renderTimeline(): TemplateResult {
	const steps: RouteStepPlan[] = routeDraft.length
		? routeDraft
		: orchestrationTrace.steps.map((step) => ({ ...step, retries: 0, estimatedContextTokens: 0 }));
	const telemetry = orchestrationTelemetry;
	return html`
		<div class="w-full md:w-[360px] border-l border-border bg-secondary/20 h-full overflow-y-auto">
			<div class="p-3 border-b border-border space-y-2">
				<div class="text-xs uppercase tracking-wide text-muted-foreground">Orchestration Timeline</div>
				<div class="text-xs text-muted-foreground">Current: ${activeSpecialist ?? "idle"}</div>
				<div class="text-xs text-muted-foreground">Next: ${steps.find((step) => step.status === "queued")?.title ?? "none"}</div>
				<div class="text-xs text-muted-foreground">Route reason: ${routeReason || "N/A"}</div>
			</div>
			<div class="p-3 space-y-3">
				${steps.map((step) => {
					const isDraftEditable = Boolean(pendingSequentialInput) && !activeRunState;
					return html`
						<div class="border border-border rounded-md p-3 space-y-2">
							<div class="flex items-center justify-between gap-2">
								<div class="text-sm font-medium text-foreground">${step.title}</div>
								<div class="text-xs text-muted-foreground">${step.status}</div>
							</div>
							<div class="text-xs text-muted-foreground">Role: ${step.role} | Retries: ${step.retries}</div>
							<div class="text-xs text-muted-foreground">Context tokens (est): ${step.estimatedContextTokens}</div>
							${
								isDraftEditable
									? html`
										<div class="grid grid-cols-1 gap-2">
											<select
												class="text-xs bg-background border border-border rounded px-2 py-1"
												@change=${(e: Event) =>
													updateRouteStep(step.id, {
														role: (e.target as HTMLSelectElement).value as AgentSpecialistRole,
													})}
											>
												${(["planner", "coder", "reviewer", "summarizer"] as const).map(
													(role) =>
														html`<option value=${role} ?selected=${role === step.role}>${role}</option>`,
												)}
											</select>
											<select
												class="text-xs bg-background border border-border rounded px-2 py-1"
												@change=${(e: Event) => {
													const value = (e.target as HTMLSelectElement).value;
													const [provider, modelId] = value.split("::");
													updateRouteStep(step.id, {
														selectedProvider: provider,
														selectedModelId: modelId,
													});
												}}
											>
												${availableModelsCache.map(
													(model) => html`
														<option
															value=${`${model.provider}::${model.id}`}
															?selected=${
																model.provider === step.selectedProvider &&
																model.id === step.selectedModelId
															}
														>
															${model.provider}/${model.id}
														</option>
													`,
												)}
											</select>
										</div>
									`
									: ""
							}
						</div>
					`;
				})}
				${renderFailurePanel()}
				${
					telemetry
						? html`
							<div class="border border-border rounded-md p-3 space-y-1">
								<div class="text-xs uppercase tracking-wide text-muted-foreground">Telemetry</div>
								<div class="text-xs text-muted-foreground">Status: ${telemetry.runStatus}</div>
								<div class="text-xs text-muted-foreground">Total tokens: ${telemetry.totalUsage.totalTokens}</div>
								<div class="text-xs text-muted-foreground">Total cost: ${formatCost(telemetry.totalUsage.cost.total)}</div>
								<div class="text-xs text-muted-foreground">Steps logged: ${telemetry.steps.length}</div>
							</div>
						`
						: ""
				}
				<div class="flex flex-wrap gap-2">
					${Button({
						variant: "default",
						size: "sm",
						children: html`${icon(Play, "sm")} Start Run`,
						disabled: !pendingSequentialInput || routeDraft.length === 0 || Boolean(activeRunState),
						onClick: () => void startSequentialRunFromDraft(),
					})}
					${Button({
						variant: "outline",
						size: "sm",
						children: "Clear Draft",
						disabled: !pendingSequentialInput || Boolean(activeRunState),
						onClick: () => {
							pendingSequentialInput = null;
							routeDraft = [];
							routeReason = "";
							renderApp();
						},
					})}
				</div>
			</div>
		</div>
	`;
}

function renderToasts(): TemplateResult {
	if (toasts.length === 0) return html``;
	return html`
		<div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
			${toasts.map(
				(toast) => html`
					<div
						class="px-3 py-2 rounded-md text-xs border ${
							toast.variant === "destructive"
								? "bg-destructive/90 text-destructive-foreground border-destructive"
								: "bg-secondary text-secondary-foreground border-border"
						}"
					>
						${toast.text}
					</div>
				`,
			)}
		</div>
	`;
}

function renderControlStrip(): TemplateResult {
	return html`
		<div class="border-b border-border px-4 py-2 flex flex-col gap-2 bg-secondary/10">
			<div class="flex flex-wrap items-center gap-2">
				<select
					class="text-xs bg-background border border-border rounded px-2 py-1"
					@change=${(e: Event) => {
						conversationStyle = (e.target as HTMLSelectElement).value as ConversationStyle;
						renderApp();
					}}
				>
					<option value="default" ?selected=${conversationStyle === "default"}>Style: Default</option>
					<option value="caveman" ?selected=${conversationStyle === "caveman"}>Style: Caveman</option>
				</select>
				<select
					class="text-xs bg-background border border-border rounded px-2 py-1"
					@change=${(e: Event) => {
						orchestrationMode = (e.target as HTMLSelectElement).value as OrchestrationMode;
						renderApp();
					}}
				>
					<option value="single-agent" ?selected=${orchestrationMode === "single-agent"}>Mode: Single</option>
					<option value="sequential" ?selected=${orchestrationMode === "sequential"}>Mode: Sequential</option>
				</select>
				<span class="text-xs text-muted-foreground">Active specialist: ${activeSpecialist ?? "idle"}</span>
				${Button({
					variant: "outline",
					size: "sm",
					children: html`${icon(Download, "sm")} JSON`,
					onClick: () => void exportSnapshot("json"),
				})}
				${Button({
					variant: "outline",
					size: "sm",
					children: html`${icon(Download, "sm")} Markdown`,
					onClick: () => void exportSnapshot("markdown"),
				})}
				${Button({
					variant: "ghost",
					size: "sm",
					children: html`${icon(Sparkles, "sm")} Notify`,
					onClick: () => {
						agent.steer(createSystemNotification("Operational checkpoint logged."));
					},
				})}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<label class="text-xs text-muted-foreground">Budget Guard</label>
				<input
					type="checkbox"
					.checked=${runBudgetSettings.enabled}
					@change=${(e: Event) => {
						runBudgetSettings = { ...runBudgetSettings, enabled: (e.target as HTMLInputElement).checked };
						onboardingHints.budgets = false;
						void persistOrchestrationSettings();
						renderApp();
					}}
				/>
				<label class="text-xs text-muted-foreground">Max tokens</label>
				<input
					type="number"
					min="0"
					class="text-xs bg-background border border-border rounded px-2 py-1 w-24"
					.value=${String(runBudgetSettings.maxTokens)}
					@change=${(e: Event) => {
						const value = Number((e.target as HTMLInputElement).value);
						runBudgetSettings = { ...runBudgetSettings, maxTokens: Number.isFinite(value) ? value : 0 };
						void persistOrchestrationSettings();
					}}
				/>
				<label class="text-xs text-muted-foreground">Max cost</label>
				<input
					type="number"
					min="0"
					step="0.01"
					class="text-xs bg-background border border-border rounded px-2 py-1 w-20"
					.value=${String(runBudgetSettings.maxCost)}
					@change=${(e: Event) => {
						const value = Number((e.target as HTMLInputElement).value);
						runBudgetSettings = { ...runBudgetSettings, maxCost: Number.isFinite(value) ? value : 0 };
						void persistOrchestrationSettings();
					}}
				/>
				<select
					class="text-xs bg-background border border-border rounded px-2 py-1"
					@change=${(e: Event) => {
						runBudgetSettings = {
							...runBudgetSettings,
							onExceed: (e.target as HTMLSelectElement).value as RunBudgetSettings["onExceed"],
						};
						void persistOrchestrationSettings();
					}}
				>
					<option value="confirm" ?selected=${runBudgetSettings.onExceed === "confirm"}>On exceed: Confirm</option>
					<option value="stop" ?selected=${runBudgetSettings.onExceed === "stop"}>On exceed: Stop</option>
				</select>
			</div>
			${renderTemplateControls()}
			${
				onboardingHints.orchestration || onboardingHints.budgets || onboardingHints.providers
					? html`
						<div class="text-xs text-muted-foreground border border-border rounded px-2 py-2 flex flex-wrap items-center gap-2">
							<span>Hints:</span>
							${onboardingHints.orchestration ? html`<span>Send prompt in sequential mode to open editable route.</span>` : ""}
							${onboardingHints.budgets ? html`<span>Enable budget guardrails to enforce token/cost caps.</span>` : ""}
							${onboardingHints.providers ? html`<span>Use Settings -> Set Up Local Models for Ollama/llama.cpp.</span>` : ""}
							${Button({
								variant: "ghost",
								size: "sm",
								children: "Dismiss",
								onClick: async () => {
									onboardingHints = { orchestration: false, budgets: false, providers: false };
									await persistOrchestrationSettings();
									renderApp();
								},
							})}
						</div>
					`
					: ""
			}
		</div>
	`;
}

const renderApp = () => {
	const app = document.getElementById("app");
	if (!app) return;
	render(
		html`<div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
			<div class="flex items-center justify-between border-b border-border shrink-0">
				<div class="flex items-center gap-2 px-4 py-2">
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(History, "sm"),
						onClick: () => {
							SessionListDialog.open(
								async (sessionId) => loadSession(sessionId),
								(deletedSessionId) => {
									if (deletedSessionId === currentSessionId) newSession();
								},
							);
						},
						title: "Sessions",
					})}
					${Button({ variant: "ghost", size: "sm", children: icon(Plus, "sm"), onClick: newSession, title: "New Session" })}
						${
							currentTitle
								? html`<span class="text-sm">${currentTitle}</span>`
								: html`<span class="text-base font-semibold text-foreground">PI Studio</span>`
						}
				</div>
				<div class="flex items-center gap-2 px-2">
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Settings, "sm"),
						onClick: () =>
							SettingsDialog.open(
								[
									new ProvidersModelsTab(),
									document.createElement("local-role-mapping-tab") as unknown as SettingsTab,
									new PluginsTab(),
									new SkillsTab(),
									new ProxyTab(),
								],
								async () => {
									await loadOrchestrationSettings();
									await syncPluginSkillSnapshot();
									onboardingHints.providers = false;
									await applyAutoSwitchedLocalModel();
									await persistOrchestrationSettings();
									renderApp();
								},
							),
						title: "Settings",
					})}
				</div>
			</div>
			${renderControlStrip()}
			<div class="flex flex-1 min-h-0 overflow-hidden">
				<div class="flex-1 min-w-0">${chatPanel}</div>
				${renderTimeline()}
			</div>
			${renderToasts()}
		</div>`,
		app,
	);
};

async function initApp() {
	const app = document.getElementById("app");
	if (!app) throw new Error("App container not found");
	render(
		html`<div class="w-full h-screen flex items-center justify-center bg-background text-foreground">
			<div class="text-muted-foreground">Loading...</div>
		</div>`,
		app,
	);
	chatPanel = new ChatPanel();
	await loadOrchestrationSettings();
	await refreshAvailableModels();
	const sessionIdFromUrl = new URLSearchParams(window.location.search).get("session");
	if (sessionIdFromUrl) {
		const loaded = await loadSession(sessionIdFromUrl);
		if (!loaded) {
			newSession();
			return;
		}
	} else {
		await createAgent();
		await applyAutoSwitchedLocalModel();
	}
	renderApp();
}

void initApp();
