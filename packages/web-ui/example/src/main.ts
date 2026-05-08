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
	type VisibleReasoningLevel,
} from "@mariozechner/pi-agent-core";
import { getModel, getModels, getProviders, type Model, type Usage } from "@mariozechner/pi-ai";
import {
	type AgentState,
	ApiKeyPromptDialog,
	AppStorage,
	type AutoDiscoveryProviderType,
	type AutomationDefaultsSettings,
	BlueprintStudioTab,
	ChatPanel,
	type ComposerProductivitySettings,
	CustomProvidersStore,
	createJavaScriptReplTool,
	DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS,
	DownloadsTab,
	discoverModels,
	type GuidedOnboardingState,
	getPluginSkillBackend,
	IndexedDBStorageBackend,
	i18n,
	type LocalProviderSetup,
	type MobileUiState,
	type MobileUiTab,
	ModelSelector,
	type OrchestrationStepTelemetry,
	type OrchestrationTelemetrySummary,
	type OrchestrationTrace,
	type PluginSkillSnapshot,
	PluginsTab,
	ProductivitySettingsTab,
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
	type SlashCommand,
	type SlashCommandSelection,
	type SnapshotExportMetadata,
	type SpecialistRoleModelMap,
	type SpecialistRoleReasoningMap,
	type ConversationStyle as StoredConversationStyle,
	setAppStorage,
	setPluginSkillBackend,
	type TouchFirstFeatureFlags,
	type TouchFirstPreferences,
} from "@mariozechner/pi-web-ui";
import { html, render, type TemplateResult } from "lit";
import { Download, History, Layers3, Play, Plus, Settings, SlidersHorizontal, Sparkles } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import "./LocalRoleMappingTab.js";
import "./TouchFirstSettingsTab.js";
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
	reasoningLevel?: VisibleReasoningLevel;
	dependsOn: string[];
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

const MOBILE_BREAKPOINT_PX = 768;

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

const SPECIALIST_ROLES: AgentSpecialistRole[] = ["planner", "coder", "reviewer", "summarizer"];

const DEFAULT_TOUCH_FIRST_FEATURE_FLAGS: TouchFirstFeatureFlags = {
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

const DEFAULT_SPECIALIST_ROLE_REASONING: SpecialistRoleReasoningMap = {
	planner: "medium",
	coder: "high",
	reviewer: "high",
	summarizer: "low",
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

const DEFAULT_MOBILE_UI_STATE: MobileUiState = {
	activeTab: "chat",
	timelineSheetOpen: false,
	lastViewportWidth: MOBILE_BREAKPOINT_PX,
};

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
let specialistRoleReasoningMap: SpecialistRoleReasoningMap = {};
let runBudgetSettings: RunBudgetSettings = { ...DEFAULT_BUDGET_SETTINGS };
let snapshotExportMetadata: SnapshotExportMetadata | null = null;
let pluginSkillSnapshot: PluginSkillSnapshot | null = null;
let composerProductivitySettings: ComposerProductivitySettings = { ...DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS };
let promptHistory: string[] = [];
let currentDraft = "";
let availableModelsCache: Model<any>[] = [];
let pendingSequentialInput: string | null = null;
let routeDraft: RouteStepPlan[] = [];
let routeReason = "";
let activeRunState: SequentialRunState | null = null;
let sequentialFailure: SequentialFailureState | null = null;
let selectedTemplateId = PROMPT_TEMPLATES[0]?.id ?? "";
let toasts: ToastMessage[] = [];
let touchFirstFeatureFlags: TouchFirstFeatureFlags = { ...DEFAULT_TOUCH_FIRST_FEATURE_FLAGS };
let automationDefaults: AutomationDefaultsSettings = { ...DEFAULT_AUTOMATION_DEFAULTS };
let guidedOnboardingState: GuidedOnboardingState = { ...DEFAULT_GUIDED_ONBOARDING_STATE };
let mobileUiState: MobileUiState = { ...DEFAULT_MOBILE_UI_STATE };
let viewportWidth = window.innerWidth;
let mobileSheetTouchStartY: number | null = null;
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

function isPhoneViewport(): boolean {
	return viewportWidth < MOBILE_BREAKPOINT_PX;
}

function isTouchFirstShellActive(): boolean {
	return touchFirstFeatureFlags.touchFirstShell && isPhoneViewport();
}

function toTouchFirstPreferences(): TouchFirstPreferences {
	return {
		active: isTouchFirstShellActive(),
		activeTab: mobileUiState.activeTab,
		timelineSheetOpen: mobileUiState.timelineSheetOpen,
	};
}

function resolveStartupTab(surface: AutomationDefaultsSettings["defaultStartupSurface"]): MobileUiTab {
	if (surface === "timeline") return "timeline";
	if (surface === "run-ops") return "run-ops";
	return "chat";
}

function refreshGuidedOnboardingProgress(): void {
	guidedOnboardingState = {
		...guidedOnboardingState,
		completedSteps: {
			mode: orchestrationMode === "sequential" || orchestrationMode === "single-agent",
			provider: Boolean(localProviderSetup?.completedAt),
			roleMapping: Object.keys(specialistRoleModelMap).length > 0,
			firstRun: Boolean(orchestrationTelemetry?.steps.length),
		},
	};
	const completedSteps = guidedOnboardingState.completedSteps;
	const completed =
		completedSteps.mode && completedSteps.provider && completedSteps.roleMapping && completedSteps.firstRun;
	if (completed && !guidedOnboardingState.completed) {
		guidedOnboardingState = {
			...guidedOnboardingState,
			completed: true,
			completedAt: new Date().toISOString(),
		};
	}
}

async function applyAutomationDefaultsForNewSession(): Promise<void> {
	if (!touchFirstFeatureFlags.automationDefaults) return;
	conversationStyle = automationDefaults.defaultConversationStyle;
	orchestrationMode = automationDefaults.defaultOrchestrationMode;
	mobileUiState = {
		...mobileUiState,
		activeTab: resolveStartupTab(automationDefaults.defaultStartupSurface),
		timelineSheetOpen:
			resolveStartupTab(automationDefaults.defaultStartupSurface) === "timeline" ||
			resolveStartupTab(automationDefaults.defaultStartupSurface) === "run-ops",
	};
}

function caveManPrefix(input: string): string {
	if (conversationStyle === "default") return input;
	return `Use caveman speaking style: short phrases, minimal grammar, no fluff, keep technical accuracy.\n\nUser request:\n${input}`;
}

function addToast(text: string, variant: "default" | "destructive" = "default"): void {
	if (!composerProductivitySettings.notificationsEnabled) return;
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

function buildOrchestrationGraph() {
	const now = Date.now();
	const errors: string[] = [];
	const ids = new Set(routeDraft.map((step) => step.id));
	for (const step of routeDraft) {
		for (const dependency of step.dependsOn) {
			if (!ids.has(dependency)) {
				errors.push(`${step.title} depends on missing step ${dependency}.`);
			}
			if (dependency === step.id) {
				errors.push(`${step.title} cannot depend on itself.`);
			}
		}
	}
	return {
		id: currentSessionId ?? "draft",
		input: pendingSequentialInput ?? activeRunState?.input ?? "",
		steps: routeDraft.map((step) => ({
			...toSequentialStep(step),
			dependsOn: step.dependsOn,
			selectedProvider: step.selectedProvider,
			selectedModelId: step.selectedModelId,
			reasoningLevel: step.reasoningLevel,
			estimatedContextTokens: step.estimatedContextTokens,
			retries: step.retries,
		})),
		routingReason: routeReason || activeRunState?.routingReason || "User-reviewed route",
		execution: "sequential" as const,
		validation: {
			valid: errors.length === 0,
			errors,
			warnings: routeDraft.length === 0 ? ["No route steps are currently planned."] : [],
		},
		createdAt: orchestrationTrace.graph?.createdAt ?? now,
		updatedAt: now,
	};
}

function refreshOrchestrationGraph(): void {
	orchestrationTrace = {
		...orchestrationTrace,
		graph: buildOrchestrationGraph(),
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
	agent.state.messages = [
		...agent.state.messages,
		{
			role: "orchestration",
			timestamp: handoff.timestamp,
			step: serializableStep,
			handoffReason: reason,
			fromRole,
			toRole: serializableStep.role,
		},
	];
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

async function applyAutomationRoleMappingDefaults(): Promise<void> {
	if (!touchFirstFeatureFlags.automationDefaults || !automationDefaults.autoApplyFirstLocalModelForRoles) return;
	if (Object.keys(specialistRoleModelMap).length > 0) return;
	await refreshAvailableModels();
	const customProviderList = await storage.customProviders.getAll();
	const localProviderNames = new Set(customProviderList.map((provider) => provider.name));
	const firstLocalModel = availableModelsCache.find((model) => localProviderNames.has(model.provider));
	if (!firstLocalModel) return;
	specialistRoleModelMap = Object.fromEntries(
		SPECIALIST_ROLES.map((role) => [role, { provider: firstLocalModel.provider, modelId: firstLocalModel.id }]),
	) as SpecialistRoleModelMap;
	await storage.settings.set("orchestration.specialistRoleModelMap", specialistRoleModelMap);
}

async function loadOrchestrationSettings() {
	localProviderSetup =
		(await storage.settings.get<LocalProviderSetup>("orchestration.localProviderSetup")) ?? localProviderSetup;
	specialistRoleModelMap =
		(await storage.settings.get<SpecialistRoleModelMap>("orchestration.specialistRoleModelMap")) ??
		specialistRoleModelMap;
	specialistRoleReasoningMap =
		(await storage.settings.get<SpecialistRoleReasoningMap>("orchestration.specialistRoleReasoningMap")) ??
		specialistRoleReasoningMap;
	specialistRoleReasoningMap = { ...DEFAULT_SPECIALIST_ROLE_REASONING, ...specialistRoleReasoningMap };
	composerProductivitySettings = {
		...DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS,
		...((await storage.settings.get<ComposerProductivitySettings>("studio.composerProductivitySettings")) ??
			composerProductivitySettings),
	};
	promptHistory = (await storage.settings.get<string[]>("studio.promptHistory")) ?? promptHistory;
	currentDraft = (await storage.settings.get<string>("studio.currentDraft")) ?? currentDraft;
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
	touchFirstFeatureFlags =
		(await storage.settings.get<TouchFirstFeatureFlags>("touchFirst.featureFlags")) ?? touchFirstFeatureFlags;
	automationDefaults =
		(await storage.settings.get<AutomationDefaultsSettings>("touchFirst.automationDefaults")) ?? automationDefaults;
	guidedOnboardingState =
		(await storage.settings.get<GuidedOnboardingState>("touchFirst.guidedOnboardingState")) ?? guidedOnboardingState;
	mobileUiState = (await storage.settings.get<MobileUiState>("touchFirst.mobileUiState")) ?? mobileUiState;
	refreshGuidedOnboardingProgress();
}

async function persistOrchestrationSettings() {
	refreshGuidedOnboardingProgress();
	await storage.settings.set("orchestration.runBudgetSettings", runBudgetSettings);
	await storage.settings.set("orchestration.specialistRoleReasoningMap", specialistRoleReasoningMap);
	await storage.settings.set("studio.composerProductivitySettings", composerProductivitySettings);
	await storage.settings.set("studio.promptHistory", promptHistory);
	await storage.settings.set("studio.currentDraft", currentDraft);
	await storage.settings.set("orchestration.onboardingHints", onboardingHints);
	await storage.settings.set("orchestration.selectedTemplateId", selectedTemplateId);
	await storage.settings.set("touchFirst.featureFlags", touchFirstFeatureFlags);
	await storage.settings.set("touchFirst.automationDefaults", automationDefaults);
	await storage.settings.set("touchFirst.guidedOnboardingState", guidedOnboardingState);
	await storage.settings.set("touchFirst.mobileUiState", mobileUiState);
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
			dependsOn: index === 0 ? [] : [`step-${index}`],
			reasoningLevel: specialistRoleReasoningMap[step.role] ?? composerProductivitySettings.defaultReasoningLevel,
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
	refreshOrchestrationGraph();
	sequentialFailure = null;
	onboardingHints.orchestration = false;
	await persistOrchestrationSettings();
	addToast("Sequential route prepared. Review and click Start Run.");
	renderApp();
}

function updateRouteStep(stepId: string, patch: Partial<RouteStepPlan>): void {
	routeDraft = routeDraft.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
	refreshOrchestrationGraph();
	renderApp();
}

function moveRouteStep(stepId: string, direction: -1 | 1): void {
	const index = routeDraft.findIndex((step) => step.id === stepId);
	const nextIndex = index + direction;
	if (index < 0 || nextIndex < 0 || nextIndex >= routeDraft.length) return;
	const nextDraft = routeDraft.slice();
	const [step] = nextDraft.splice(index, 1);
	if (!step) return;
	nextDraft.splice(nextIndex, 0, step);
	routeDraft = nextDraft.map((entry, idx) => ({
		...entry,
		dependsOn: idx === 0 ? [] : [nextDraft[idx - 1]?.id ?? ""].filter(Boolean),
	}));
	refreshOrchestrationGraph();
	renderApp();
}

function addRouteStep(): void {
	const id = `step-${routeDraft.length + 1}-${Date.now().toString(36)}`;
	const previous = routeDraft.at(-1);
	routeDraft = [
		...routeDraft,
		{
			id,
			role: "summarizer",
			title: "Additional specialist step",
			status: "queued",
			task: pendingSequentialInput ?? activeRunState?.input ?? "",
			dependsOn: previous ? [previous.id] : [],
			reasoningLevel: specialistRoleReasoningMap.summarizer ?? composerProductivitySettings.defaultReasoningLevel,
			retries: 0,
			estimatedContextTokens: estimateTokens(pendingSequentialInput ?? activeRunState?.input ?? ""),
			selectedModelId: agent.state.model.id,
			selectedProvider: agent.state.model.provider,
		},
	];
	refreshOrchestrationGraph();
	renderApp();
}

function removeRouteStep(stepId: string): void {
	routeDraft = routeDraft
		.filter((step) => step.id !== stepId)
		.map((step) => ({ ...step, dependsOn: step.dependsOn.filter((dependency) => dependency !== stepId) }));
	refreshOrchestrationGraph();
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
		refreshOrchestrationGraph();
		pushOrchestrationMessage(step, runState.routingReason, previousRole);
		addToast(`Running ${step.role}: ${step.title}`);

		const selectedModel =
			resolveSelectedModelForStep(step) ??
			resolveRoleMappedModel(step.role, availableModelsCache, specialistRoleModelMap);
		if (selectedModel) {
			agent.state.model = selectedModel;
		}
		agent.state.thinkingLevel =
			step.reasoningLevel ?? specialistRoleReasoningMap[step.role] ?? agent.state.thinkingLevel;
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
			refreshOrchestrationGraph();
			orchestrationTrace.telemetry = orchestrationTelemetry;
			refreshGuidedOnboardingProgress();
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
			refreshOrchestrationGraph();
			orchestrationTrace.telemetry = orchestrationTelemetry;
			refreshGuidedOnboardingProgress();
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
	refreshGuidedOnboardingProgress();
	pendingSequentialInput = null;
	activeRunState = null;
	addToast("Sequential run completed.");
	if (isTouchFirstShellActive()) {
		closeMobileSheet();
	}
	await saveSession();
	renderApp();
}

async function startSequentialRunFromDraft(): Promise<void> {
	if (!pendingSequentialInput || routeDraft.length === 0) {
		addToast("No sequential draft available. Send a prompt first.", "destructive");
		return;
	}
	refreshOrchestrationGraph();
	if (orchestrationTrace.graph?.validation.valid === false) {
		addToast("Fix route graph validation errors before starting.", "destructive");
		return;
	}
	await refreshAvailableModels();
	routeDraft = routeDraft.map((step) => ({ ...step, status: "queued" }));
	orchestrationTrace = {
		steps: routeDraft.map((step) => toSequentialStep(step)),
		events: [],
		contextStrategy: "auto-context",
	};
	refreshOrchestrationGraph();
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
	if (isTouchFirstShellActive()) {
		setMobileTab("run-ops");
	}
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
	refreshOrchestrationGraph();
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
	refreshOrchestrationGraph();
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
	refreshGuidedOnboardingProgress();
	addToast("Sequential run aborted.");
	if (isTouchFirstShellActive()) {
		closeMobileSheet();
	}
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

function buildSlashCommands(): SlashCommand[] {
	const templateCommands: SlashCommand[] = PROMPT_TEMPLATES.map((template) => ({
		id: `template.${template.id}`,
		command: `/${template.id}`,
		label: template.label,
		description: template.description,
		group: "templates",
		source: "built-in",
		mode: "insert",
		safety: "safe",
		insertText: template.text,
		keywords: ["prompt", "template", template.mode],
	}));
	const reasoningCommands: SlashCommand[] = [
		["off", "Off"],
		["low", "Low"],
		["medium", "Medium"],
		["high", "High"],
		["xhigh", "Extra High"],
	].map(([level, label]) => ({
		id: `reasoning.${level}`,
		command: `/reason-${level}`,
		label: `Reasoning: ${label}`,
		description: `Set reasoning to ${label}.`,
		group: "reasoning",
		source: "built-in",
		mode: "execute",
		safety: "safe",
		keywords: ["thinking", "reasoning", label],
	}));
	return [
		{
			id: "settings.open",
			command: "/settings",
			label: "Open settings",
			description: "Open PI Studio settings.",
			group: "settings",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "model.open",
			command: "/model",
			label: "Select model",
			description: "Open the model selector.",
			group: "model",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "session.new",
			command: "/new",
			label: "New session",
			description: "Start a fresh PI Studio session.",
			group: "session",
			source: "built-in",
			mode: "execute",
			safety: "confirm",
			confirmationMessage: "Start a new session? Unsaved draft text will be cleared.",
		},
		{
			id: "session.history",
			command: "/resume",
			label: "Resume session",
			description: "Open saved sessions.",
			group: "session",
			source: "built-in",
			mode: "execute",
			safety: "safe",
			keywords: ["history", "sessions"],
		},
		{
			id: "mode.sequential",
			command: "/sequential",
			label: "Sequential mode",
			description: "Switch to graph-backed sequential orchestration.",
			group: "orchestration",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "mode.single",
			command: "/single",
			label: "Single-agent mode",
			description: "Switch back to direct single-agent chat.",
			group: "orchestration",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "style.caveman",
			command: "/caveman",
			label: "Caveman style",
			description: "Switch responses to caveman style.",
			group: "chat",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "style.default",
			command: "/default-style",
			label: "Default style",
			description: "Use normal PI Studio response style.",
			group: "chat",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "export.json",
			command: "/export-json",
			label: "Export JSON",
			description: "Download a machine-readable run snapshot.",
			group: "exports",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "export.markdown",
			command: "/export-markdown",
			label: "Export Markdown",
			description: "Download a human-readable run report.",
			group: "exports",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "diagnostics.snapshot",
			command: "/diagnostics",
			label: "Diagnostics snapshot",
			description: "Show current run and local runtime status.",
			group: "diagnostics",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "plugins.open",
			command: "/plugins",
			label: "Plugin settings",
			description: "Open settings for plugins.",
			group: "plugins",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		{
			id: "skills.open",
			command: "/skills",
			label: "Skill settings",
			description: "Open settings for skills and blueprints.",
			group: "skills",
			source: "built-in",
			mode: "execute",
			safety: "safe",
		},
		...reasoningCommands,
		...templateCommands,
	];
}

async function handleSlashCommand(selection: SlashCommandSelection): Promise<void> {
	const command = selection.command;
	if (command.safety === "confirm" && !window.confirm(command.confirmationMessage ?? `Run ${command.command}?`)) {
		return;
	}
	if (command.id.startsWith("reasoning.")) {
		const level = command.id.replace("reasoning.", "") as VisibleReasoningLevel;
		agent.state.thinkingLevel = level;
		composerProductivitySettings = { ...composerProductivitySettings, defaultReasoningLevel: level };
		await persistOrchestrationSettings();
		addToast(`Reasoning set to ${command.label.replace("Reasoning: ", "")}.`);
		renderApp();
		return;
	}
	switch (command.id) {
		case "settings.open":
		case "plugins.open":
		case "skills.open":
			openSettingsDialog();
			break;
		case "model.open":
			ModelSelector.open(agent.state.model, (model) => {
				agent.state.model = model;
				renderApp();
			});
			break;
		case "session.new":
			newSession();
			break;
		case "session.history":
			SessionListDialog.open(
				async (sessionId) => loadSession(sessionId),
				(deletedSessionId) => {
					if (deletedSessionId === currentSessionId) newSession();
				},
			);
			break;
		case "mode.sequential":
			orchestrationMode = "sequential";
			await persistOrchestrationSettings();
			addToast("Sequential mode enabled.");
			renderApp();
			break;
		case "mode.single":
			orchestrationMode = "single-agent";
			await persistOrchestrationSettings();
			addToast("Single-agent mode enabled.");
			renderApp();
			break;
		case "style.caveman":
			conversationStyle = "caveman";
			await persistOrchestrationSettings();
			addToast("Caveman style enabled.");
			renderApp();
			break;
		case "style.default":
			conversationStyle = "default";
			await persistOrchestrationSettings();
			addToast("Default style enabled.");
			renderApp();
			break;
		case "export.json":
			await exportSnapshot("json");
			break;
		case "export.markdown":
			await exportSnapshot("markdown");
			break;
		case "diagnostics.snapshot":
			addToast(
				`Diagnostics: mode ${orchestrationMode}, model ${agent.state.model.provider}/${agent.state.model.id}, messages ${agent.state.messages.length}.`,
			);
			break;
	}
}

async function rememberPrompt(input: string): Promise<void> {
	if (!composerProductivitySettings.promptHistoryEnabled || !input.trim()) return;
	promptHistory = [input.trim(), ...promptHistory.filter((entry) => entry !== input.trim())].slice(0, 50);
	currentDraft = "";
	await persistOrchestrationSettings();
}

async function saveDraft(value: string): Promise<void> {
	if (!composerProductivitySettings.draftAutosaveEnabled) return;
	currentDraft = value;
	await storage.settings.set("studio.currentDraft", currentDraft);
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
			specialistRoleReasoningMap: specialistRoleReasoningMap ?? undefined,
			runBudgetSettings,
			orchestrationTelemetry: orchestrationTelemetry ?? undefined,
			snapshotExportMetadata: snapshotExportMetadata ?? undefined,
			pluginSkillSnapshot: pluginSkillSnapshot ?? undefined,
			touchFirstFeatureFlags,
			automationDefaults,
			guidedOnboardingState,
			mobileUiState,
			touchFirstPreferences: toTouchFirstPreferences(),
			composerProductivitySettings,
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
			specialistRoleReasoningMap: specialistRoleReasoningMap ?? undefined,
			runBudgetSettings,
			orchestrationTelemetry: orchestrationTelemetry ?? undefined,
			snapshotExportMetadata: snapshotExportMetadata ?? undefined,
			pluginSkillSnapshot: pluginSkillSnapshot ?? undefined,
			touchFirstFeatureFlags,
			automationDefaults,
			guidedOnboardingState,
			mobileUiState,
			touchFirstPreferences: toTouchFirstPreferences(),
			composerProductivitySettings,
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
			thinkingLevel: composerProductivitySettings.defaultReasoningLevel,
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
		onModelSelect: () => {
			ModelSelector.open(agent.state.model, (model) => {
				agent.state.model = model;
				renderApp();
			});
		},
		onSlashCommand: async (selection) => handleSlashCommand(selection),
		onDraftChange: async (value) => saveDraft(value),
		onPromptSent: async (input) => rememberPrompt(input),
		slashCommands: buildSlashCommands(),
		promptHistory,
		enterToSend: composerProductivitySettings.enterToSend,
		slashCommandsEnabled: composerProductivitySettings.slashCommandsEnabled,
		promptHistoryEnabled: composerProductivitySettings.promptHistoryEnabled,
		draftAutosaveEnabled: composerProductivitySettings.draftAutosaveEnabled,
		contextInspectorEnabled: composerProductivitySettings.contextInspectorEnabled,
		toolsFactory: (_agent, _agentInterface, _artifactsPanel, runtimeProvidersFactory) => {
			const replTool = createJavaScriptReplTool();
			replTool.runtimeProvidersFactory = runtimeProvidersFactory;
			return [replTool];
		},
		messageInterceptor: async (input) => {
			if (orchestrationMode === "sequential") {
				await openRouteDraftForInput(input);
				if (isTouchFirstShellActive()) {
					setMobileTab("timeline");
				}
				return { handled: true };
			}
			if (conversationStyle === "caveman") {
				await agent.prompt(caveManPrefix(input));
				return { handled: true };
			}
			return { handled: false };
		},
	});
	if (composerProductivitySettings.draftAutosaveEnabled && currentDraft && chatPanel.agentInterface) {
		chatPanel.agentInterface.setInput(currentDraft);
	}
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
	specialistRoleReasoningMap = {
		...DEFAULT_SPECIALIST_ROLE_REASONING,
		...(sessionData.specialistRoleReasoningMap || specialistRoleReasoningMap),
	};
	runBudgetSettings = sessionData.runBudgetSettings || { ...DEFAULT_BUDGET_SETTINGS };
	orchestrationTelemetry = sessionData.orchestrationTelemetry || null;
	snapshotExportMetadata = sessionData.snapshotExportMetadata || null;
	pluginSkillSnapshot = sessionData.pluginSkillSnapshot || null;
	touchFirstFeatureFlags = sessionData.touchFirstFeatureFlags || touchFirstFeatureFlags;
	automationDefaults = sessionData.automationDefaults || automationDefaults;
	guidedOnboardingState = sessionData.guidedOnboardingState || guidedOnboardingState;
	mobileUiState = sessionData.mobileUiState || mobileUiState;
	composerProductivitySettings = {
		...DEFAULT_COMPOSER_PRODUCTIVITY_SETTINGS,
		...(sessionData.composerProductivitySettings || composerProductivitySettings),
	};
	refreshGuidedOnboardingProgress();
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

function getSettingsTabs(): SettingsTab[] {
	return [
		new ProvidersModelsTab(),
		new ProductivitySettingsTab(),
		document.createElement("touch-first-settings-tab") as unknown as SettingsTab,
		document.createElement("local-role-mapping-tab") as unknown as SettingsTab,
		new PluginsTab(),
		new SkillsTab(),
		new DownloadsTab(),
		new BlueprintStudioTab(),
		new ProxyTab(),
	];
}

function openSettingsDialog(): void {
	SettingsDialog.open(getSettingsTabs(), async () => {
		await loadOrchestrationSettings();
		await applyAutomationRoleMappingDefaults();
		await syncPluginSkillSnapshot();
		onboardingHints.providers = false;
		await applyAutoSwitchedLocalModel();
		syncComposerProductivityControls();
		await persistOrchestrationSettings();
		renderApp();
	});
}

function syncComposerProductivityControls(): void {
	if (!chatPanel?.agentInterface) return;
	chatPanel.agentInterface.slashCommands = buildSlashCommands();
	chatPanel.agentInterface.promptHistory = promptHistory;
	chatPanel.agentInterface.enterToSend = composerProductivitySettings.enterToSend;
	chatPanel.agentInterface.slashCommandsEnabled = composerProductivitySettings.slashCommandsEnabled;
	chatPanel.agentInterface.promptHistoryEnabled = composerProductivitySettings.promptHistoryEnabled;
	chatPanel.agentInterface.draftAutosaveEnabled = composerProductivitySettings.draftAutosaveEnabled;
	chatPanel.agentInterface.contextInspectorEnabled = composerProductivitySettings.contextInspectorEnabled;
}

function setMobileTab(tab: MobileUiTab): void {
	mobileUiState = {
		...mobileUiState,
		activeTab: tab,
		timelineSheetOpen: tab === "timeline" || tab === "run-ops",
		lastViewportWidth: viewportWidth,
	};
	void persistOrchestrationSettings();
	renderApp();
}

function closeMobileSheet(): void {
	mobileUiState = {
		...mobileUiState,
		activeTab: "chat",
		timelineSheetOpen: false,
		lastViewportWidth: viewportWidth,
	};
	void persistOrchestrationSettings();
	renderApp();
}

function onSheetTouchStart(event: TouchEvent): void {
	const touch = event.touches.item(0);
	mobileSheetTouchStartY = touch ? touch.clientY : null;
}

function onSheetTouchEnd(event: TouchEvent): void {
	if (mobileSheetTouchStartY === null) return;
	const touch = event.changedTouches.item(0);
	if (!touch) {
		mobileSheetTouchStartY = null;
		return;
	}
	const swipeDistance = touch.clientY - mobileSheetTouchStartY;
	mobileSheetTouchStartY = null;
	if (swipeDistance > 70) {
		closeMobileSheet();
	}
}

function renderFailurePanel(): TemplateResult {
	if (!sequentialFailure || !activeRunState) return html``;
	const failure = sequentialFailure;
	const step = activeRunState.steps[failure.index];
	return html`
		<div class="border border-destructive/40 rounded-md p-3 bg-destructive/5 space-y-2">
				<div class="text-xs uppercase tracking-wide text-destructive">${i18n("Step failed")}</div>
				<div class="text-sm text-foreground">${failure.errorMessage}</div>
				<div class="grid grid-cols-1 gap-2">
					<label class="text-xs text-muted-foreground">${i18n("Retry role")}</label>
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
						${SPECIALIST_ROLES.map(
							(role) => html`<option value=${role} ?selected=${role === failure.overrideRole}>${role}</option>`,
						)}
					</select>
					<label class="text-xs text-muted-foreground">${i18n("Retry model")}</label>
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
					${Button({
						variant: "default",
						size: "sm",
						children: i18n("Retry Step"),
						onClick: () => void retryFailedStep(),
					})}
					${Button({ variant: "outline", size: "sm", children: i18n("Skip Step"), onClick: () => void skipFailedStep() })}
					${Button({ variant: "ghost", size: "sm", children: i18n("Abort Run"), onClick: () => void abortSequentialRun() })}
				</div>
				<div class="text-xs text-muted-foreground">${i18n("Failed stage")}: ${step?.title ?? i18n("unknown step")}</div>
			</div>
		`;
}

function renderTimeline(asSheet = false): TemplateResult {
	const steps: RouteStepPlan[] = routeDraft.length
		? routeDraft
		: orchestrationTrace.steps.map((step) => ({
				...step,
				dependsOn: orchestrationTrace.graph?.steps.find((graphStep) => graphStep.id === step.id)?.dependsOn ?? [],
				reasoningLevel: orchestrationTrace.graph?.steps.find((graphStep) => graphStep.id === step.id)
					?.reasoningLevel,
				retries: 0,
				estimatedContextTokens: 0,
				selectedProvider: orchestrationTrace.graph?.steps.find((graphStep) => graphStep.id === step.id)
					?.selectedProvider,
				selectedModelId: orchestrationTrace.graph?.steps.find((graphStep) => graphStep.id === step.id)
					?.selectedModelId,
			}));
	const telemetry = orchestrationTelemetry;
	const wrapperClass = asSheet
		? "h-full overflow-y-auto bg-background"
		: "w-full md:w-[360px] border-l border-border bg-secondary/20 h-full overflow-y-auto";
	return html`
		<div class=${wrapperClass}>
			<div class="p-3 border-b border-border space-y-2">
				<div class="flex items-center justify-between gap-2">
					<div class="text-xs uppercase tracking-wide text-muted-foreground">${i18n("Orchestration Timeline")}</div>
					${
						asSheet
							? Button({
									variant: "ghost",
									size: "sm",
									onClick: () => closeMobileSheet(),
									children: i18n("Close"),
								})
							: ""
					}
				</div>
				<div class="text-xs text-muted-foreground">${i18n("Current")}: ${activeSpecialist ?? i18n("idle")}</div>
				<div class="text-xs text-muted-foreground">
					${i18n("Next")}: ${steps.find((step) => step.status === "queued")?.title ?? i18n("none")}
				</div>
				<div class="text-xs text-muted-foreground">${i18n("Route reason")}: ${routeReason || "N/A"}</div>
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
							<div class="text-xs text-muted-foreground">
								Role: ${step.role} | Reasoning: ${step.reasoningLevel ?? "default"} | Retries: ${step.retries}
							</div>
							<div class="text-xs text-muted-foreground">
								Depends on: ${step.dependsOn.length ? step.dependsOn.join(", ") : "start"}
							</div>
							<div class="text-xs text-muted-foreground">Context tokens (est): ${step.estimatedContextTokens}</div>
							${
								isDraftEditable
									? html`
											<div class="grid grid-cols-1 gap-2">
												<input
													class="text-xs bg-background border border-border rounded px-2 py-1"
													.value=${step.title}
													@change=${(e: Event) => updateRouteStep(step.id, { title: (e.target as HTMLInputElement).value })}
												/>
												<textarea
													class="text-xs bg-background border border-border rounded px-2 py-1 min-h-16"
													.value=${step.task}
													@change=${(e: Event) => updateRouteStep(step.id, { task: (e.target as HTMLTextAreaElement).value })}
												></textarea>
												<select
													class="text-xs bg-background border border-border rounded px-2 py-1"
													@change=${(e: Event) =>
														updateRouteStep(step.id, {
															role: (e.target as HTMLSelectElement).value as AgentSpecialistRole,
														})}
												>
													${SPECIALIST_ROLES.map(
														(role) =>
															html`<option value=${role} ?selected=${role === step.role}>${role}</option>`,
													)}
												</select>
												<select
													class="text-xs bg-background border border-border rounded px-2 py-1"
													@change=${(e: Event) =>
														updateRouteStep(step.id, {
															reasoningLevel: (e.target as HTMLSelectElement)
																.value as VisibleReasoningLevel,
														})}
												>
													<option value="off" ?selected=${step.reasoningLevel === "off"}>Reasoning: Off</option>
													<option value="low" ?selected=${step.reasoningLevel === "low"}>Reasoning: Low</option>
													<option value="medium" ?selected=${step.reasoningLevel === "medium"}>Reasoning: Medium</option>
													<option value="high" ?selected=${step.reasoningLevel === "high"}>Reasoning: High</option>
													<option value="xhigh" ?selected=${step.reasoningLevel === "xhigh"}>Reasoning: Extra High</option>
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
											<select
												class="text-xs bg-background border border-border rounded px-2 py-1"
												@change=${(e: Event) => {
													const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map(
														(option) => option.value,
													);
													updateRouteStep(step.id, { dependsOn: selected });
												}}
												multiple
											>
												${routeDraft
													.filter((candidate) => candidate.id !== step.id)
													.map(
														(candidate) => html`
															<option value=${candidate.id} ?selected=${step.dependsOn.includes(candidate.id)}>
																Depends: ${candidate.title}
															</option>
														`,
													)}
											</select>
											<div class="flex flex-wrap gap-2">
												${Button({
													variant: "ghost",
													size: "sm",
													children: "Move Up",
													onClick: () => moveRouteStep(step.id, -1),
												})}
												${Button({
													variant: "ghost",
													size: "sm",
													children: "Move Down",
													onClick: () => moveRouteStep(step.id, 1),
												})}
												${Button({
													variant: "ghost",
													size: "sm",
													children: "Remove",
													onClick: () => removeRouteStep(step.id),
												})}
											</div>
										</div>
									`
									: ""
							}
						</div>
					`;
				})}
				${
					steps.length > 0 && orchestrationTrace.graph?.validation.errors.length
						? html`
							<div class="border border-destructive/40 rounded-md p-3 bg-destructive/5 text-xs text-destructive space-y-1">
								${orchestrationTrace.graph.validation.errors.map((error) => html`<div>${error}</div>`)}
							</div>
						`
						: ""
				}
				${renderFailurePanel()}
				${
					telemetry
						? html`
							<div class="border border-border rounded-md p-3 space-y-1">
									<div class="text-xs uppercase tracking-wide text-muted-foreground">Telemetry</div>
									<div class="text-xs text-muted-foreground">${i18n("Status")}: ${telemetry.runStatus}</div>
									<div class="text-xs text-muted-foreground">${i18n("Total tokens")}: ${telemetry.totalUsage.totalTokens}</div>
									<div class="text-xs text-muted-foreground">${i18n("Total cost")}: ${formatCost(telemetry.totalUsage.cost.total)}</div>
									<div class="text-xs text-muted-foreground">${i18n("Steps logged")}: ${telemetry.steps.length}</div>
								</div>
							`
						: ""
				}
					<div class="flex flex-wrap gap-2">
						${Button({
							variant: "default",
							size: asSheet ? "md" : "sm",
							children: html`${icon(Play, "sm")} ${i18n("Start Run")}`,
							disabled:
								!pendingSequentialInput ||
								routeDraft.length === 0 ||
								Boolean(activeRunState) ||
								orchestrationTrace.graph?.validation.valid === false,
							onClick: () => void startSequentialRunFromDraft(),
						})}
						${Button({
							variant: "outline",
							size: asSheet ? "md" : "sm",
							children: "Add Step",
							disabled: !pendingSequentialInput || Boolean(activeRunState),
							onClick: () => addRouteStep(),
						})}
						${Button({
							variant: "outline",
							size: asSheet ? "md" : "sm",
							children: i18n("Clear Draft"),
							disabled: !pendingSequentialInput || Boolean(activeRunState),
							onClick: () => {
								pendingSequentialInput = null;
								routeDraft = [];
								routeReason = "";
								refreshGuidedOnboardingProgress();
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

function renderControlStrip(forSheet = false): TemplateResult {
	const containerClass = forSheet
		? "px-4 py-3 flex flex-col gap-3 bg-secondary/15"
		: "border-b border-border px-4 py-2 flex flex-col gap-2 bg-secondary/10";
	const fieldClass = "text-xs bg-background border border-border rounded px-2 py-1 h-9";
	return html`
		<div class=${containerClass}>
			<div class="flex flex-wrap items-center gap-2">
				<select
					class=${fieldClass}
					@change=${(e: Event) => {
						conversationStyle = (e.target as HTMLSelectElement).value as ConversationStyle;
						void persistOrchestrationSettings();
						renderApp();
					}}
				>
					<option value="default" ?selected=${conversationStyle === "default"}>${i18n("Style")}: ${i18n("Default")}</option>
					<option value="caveman" ?selected=${conversationStyle === "caveman"}>${i18n("Style")}: ${i18n("Caveman")}</option>
				</select>
				<select
					class=${fieldClass}
					@change=${(e: Event) => {
						orchestrationMode = (e.target as HTMLSelectElement).value as OrchestrationMode;
						onboardingHints.orchestration = false;
						refreshGuidedOnboardingProgress();
						void persistOrchestrationSettings();
						renderApp();
					}}
				>
					<option value="single-agent" ?selected=${orchestrationMode === "single-agent"}>${i18n("Mode")}: ${i18n("Single")}</option>
					<option value="sequential" ?selected=${orchestrationMode === "sequential"}>${i18n("Mode")}: ${i18n("Sequential")}</option>
				</select>
				<span class="text-xs text-muted-foreground">${i18n("Active specialist")}: ${activeSpecialist ?? i18n("idle")}</span>
				${Button({
					variant: "outline",
					size: forSheet ? "md" : "sm",
					children: html`${icon(Download, "sm")} JSON`,
					onClick: () => void exportSnapshot("json"),
				})}
				${Button({
					variant: "outline",
					size: forSheet ? "md" : "sm",
					children: html`${icon(Download, "sm")} Markdown`,
					onClick: () => void exportSnapshot("markdown"),
				})}
				${Button({
					variant: "ghost",
					size: forSheet ? "md" : "sm",
					children: html`${icon(Sparkles, "sm")} ${i18n("Notify")}`,
					onClick: () => {
						agent.steer(createSystemNotification("Operational checkpoint logged."));
					},
				})}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<label class="text-xs text-muted-foreground">${i18n("Budget Guard")}</label>
				<input
					type="checkbox"
					.checked=${runBudgetSettings.enabled}
					@change=${(e: Event) => {
						runBudgetSettings = { ...runBudgetSettings, enabled: (e.target as HTMLInputElement).checked };
						onboardingHints.budgets = false;
						refreshGuidedOnboardingProgress();
						void persistOrchestrationSettings();
						renderApp();
					}}
				/>
				<label class="text-xs text-muted-foreground">${i18n("Max tokens")}</label>
				<input
					type="number"
					min="0"
					class="${fieldClass} w-28"
					.value=${String(runBudgetSettings.maxTokens)}
					@change=${(e: Event) => {
						const value = Number((e.target as HTMLInputElement).value);
						runBudgetSettings = { ...runBudgetSettings, maxTokens: Number.isFinite(value) ? value : 0 };
						void persistOrchestrationSettings();
					}}
				/>
				<label class="text-xs text-muted-foreground">${i18n("Max cost")}</label>
				<input
					type="number"
					min="0"
					step="0.01"
					class="${fieldClass} w-24"
					.value=${String(runBudgetSettings.maxCost)}
					@change=${(e: Event) => {
						const value = Number((e.target as HTMLInputElement).value);
						runBudgetSettings = { ...runBudgetSettings, maxCost: Number.isFinite(value) ? value : 0 };
						void persistOrchestrationSettings();
					}}
				/>
				<select
					class=${fieldClass}
					@change=${(e: Event) => {
						runBudgetSettings = {
							...runBudgetSettings,
							onExceed: (e.target as HTMLSelectElement).value as RunBudgetSettings["onExceed"],
						};
						void persistOrchestrationSettings();
					}}
				>
					<option value="confirm" ?selected=${runBudgetSettings.onExceed === "confirm"}>${i18n("On exceed")}: ${i18n("Confirm")}</option>
					<option value="stop" ?selected=${runBudgetSettings.onExceed === "stop"}>${i18n("On exceed")}: ${i18n("Stop")}</option>
				</select>
			</div>
			${renderTemplateControls()}
			${
				onboardingHints.orchestration || onboardingHints.budgets || onboardingHints.providers
					? html`
						<div class="text-xs text-muted-foreground border border-border rounded px-2 py-2 flex flex-wrap items-center gap-2">
							<span>${i18n("Hints")}:</span>
							${onboardingHints.orchestration ? html`<span>${i18n("Send prompt in sequential mode to open editable route.")}</span>` : ""}
							${onboardingHints.budgets ? html`<span>${i18n("Enable budget guardrails to enforce token/cost caps.")}</span>` : ""}
							${onboardingHints.providers ? html`<span>${i18n("Use Settings -> Set Up Local Models for Ollama/llama.cpp.")}</span>` : ""}
							${Button({
								variant: "ghost",
								size: "sm",
								children: i18n("Dismiss"),
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

function renderGuidedOnboardingPanel(): TemplateResult {
	if (!touchFirstFeatureFlags.guidedOnboarding || guidedOnboardingState.completed) {
		return html``;
	}
	const steps = guidedOnboardingState.completedSteps;
	return html`
		<div class="mx-3 mt-2 border border-border rounded-lg bg-secondary/10 p-3 space-y-2">
			<div class="text-sm font-medium text-foreground">${i18n("Guided First Run")}</div>
			<div class="text-xs text-muted-foreground">${i18n("Complete these setup checkpoints for touch-first orchestration.")}</div>
			<div class="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
				<div>${steps.mode ? "1" : "0"} · ${i18n("Choose mode/style")}</div>
				<div>${steps.provider ? "1" : "0"} · ${i18n("Set up local provider")}</div>
				<div>${steps.roleMapping ? "1" : "0"} · ${i18n("Configure specialist role mapping")}</div>
				<div>${steps.firstRun ? "1" : "0"} · ${i18n("Complete first sequential run")}</div>
			</div>
			<div class="flex items-center gap-2">
				${Button({
					variant: "outline",
					size: "sm",
					children: i18n("Open Settings"),
					onClick: () => openSettingsDialog(),
				})}
				${Button({
					variant: "ghost",
					size: "sm",
					children: i18n("Dismiss"),
					onClick: async () => {
						guidedOnboardingState = {
							...guidedOnboardingState,
							completed: true,
							completedAt: new Date().toISOString(),
						};
						await persistOrchestrationSettings();
						renderApp();
					},
				})}
			</div>
		</div>
	`;
}

function renderMobileBottomNav(): TemplateResult {
	if (!isTouchFirstShellActive()) return html``;

	const itemClass = (tab: MobileUiTab) =>
		`flex flex-col items-center justify-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${
			mobileUiState.activeTab === tab
				? "bg-secondary text-foreground"
				: "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
		}`;

	return html`
		<div
			class="border-t border-border bg-background/95 backdrop-blur sticky bottom-0 left-0 right-0 z-20"
			style="padding-bottom: env(safe-area-inset-bottom, 0px);"
		>
			<div class="grid grid-cols-4 gap-1 px-2 py-2">
				<button class=${itemClass("chat")} @click=${() => setMobileTab("chat")}>
					${icon(Sparkles, "sm")}
					<span>${i18n("Chat")}</span>
				</button>
				<button class=${itemClass("timeline")} @click=${() => setMobileTab("timeline")}>
					${icon(Layers3, "sm")}
					<span>${i18n("Timeline")}</span>
				</button>
				<button class=${itemClass("run-ops")} @click=${() => setMobileTab("run-ops")}>
					${icon(Play, "sm")}
					<span>${i18n("Run Ops")}</span>
				</button>
				<button class="flex flex-col items-center justify-center gap-1 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50" @click=${() => openSettingsDialog()}>
					${icon(SlidersHorizontal, "sm")}
					<span>${i18n("Settings")}</span>
				</button>
			</div>
		</div>
	`;
}

function renderMobileSheetOverlay(): TemplateResult {
	if (!isTouchFirstShellActive()) return html``;
	if (!mobileUiState.timelineSheetOpen) return html``;

	const showRunOps = mobileUiState.activeTab === "run-ops";
	const title = showRunOps ? i18n("Run Operations") : i18n("Orchestration Timeline");

	return html`
		<div class="fixed inset-0 z-40 flex items-end">
			<button class="absolute inset-0 bg-black/45" @click=${() => closeMobileSheet()} aria-label=${i18n("Close sheet")}></button>
			<div
				class="relative w-full max-h-[85vh] rounded-t-2xl border border-border bg-background shadow-xl overflow-hidden"
				@touchstart=${(event: TouchEvent) => onSheetTouchStart(event)}
				@touchend=${(event: TouchEvent) => onSheetTouchEnd(event)}
			>
				<div class="flex items-center justify-center pt-2 pb-1">
					<div class="h-1.5 w-12 rounded-full bg-muted-foreground/40"></div>
				</div>
				<div class="px-4 pb-2 flex items-center justify-between gap-2 border-b border-border">
					<div class="text-sm font-semibold text-foreground">${title}</div>
					${Button({
						variant: "ghost",
						size: "sm",
						children: i18n("Close"),
						onClick: () => closeMobileSheet(),
					})}
				</div>
				<div class="max-h-[calc(85vh-52px)] overflow-y-auto">
					${showRunOps ? renderControlStrip(true) : renderTimeline(true)}
				</div>
			</div>
		</div>
	`;
}

const renderApp = () => {
	const app = document.getElementById("app");
	if (!app) return;
	const touchFirstActive = isTouchFirstShellActive();
	const activeTabLabel =
		mobileUiState.activeTab === "timeline"
			? i18n("Timeline")
			: mobileUiState.activeTab === "run-ops"
				? i18n("Run Ops")
				: i18n("Chat");
	const densityClass = composerProductivitySettings.uiDensity === "compact" ? "text-[13px]" : "";
	render(
		html`<div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden ${densityClass}">
			<div class="flex items-center justify-between border-b border-border shrink-0">
				<div class="flex items-center gap-2 px-3 sm:px-4 py-2">
					${Button({
						variant: "ghost",
						size: touchFirstActive ? "md" : "sm",
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
					${Button({
						variant: "ghost",
						size: touchFirstActive ? "md" : "sm",
						children: icon(Plus, "sm"),
						onClick: newSession,
						title: "New Session",
					})}
						${
							currentTitle
								? html`<span class="text-sm">${currentTitle}</span>`
								: html`<span class="text-base font-semibold text-foreground">PI Studio</span>`
						}
					${touchFirstActive ? html`<span class="text-xs text-muted-foreground">${activeTabLabel}</span>` : ""}
				</div>
				<div class="flex items-center gap-2 px-2">
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: touchFirstActive ? "md" : "sm",
						children: icon(Settings, "sm"),
						onClick: () => openSettingsDialog(),
						title: "Settings",
					})}
				</div>
			</div>
			${touchFirstActive ? renderGuidedOnboardingPanel() : renderControlStrip()}
			<div class="flex flex-1 min-h-0 overflow-hidden">
				<div class="flex-1 min-w-0">${chatPanel}</div>
				${touchFirstActive ? "" : renderTimeline()}
			</div>
			${touchFirstActive ? renderMobileBottomNav() : ""}
			${renderMobileSheetOverlay()}
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
	viewportWidth = window.innerWidth;
	window.addEventListener("resize", () => {
		const wasPhone = isPhoneViewport();
		viewportWidth = window.innerWidth;
		const isPhone = isPhoneViewport();
		mobileUiState = {
			...mobileUiState,
			lastViewportWidth: viewportWidth,
			timelineSheetOpen: isPhone ? mobileUiState.timelineSheetOpen : false,
		};
		if (wasPhone !== isPhone || isTouchFirstShellActive()) {
			renderApp();
		}
	});
	await loadOrchestrationSettings();
	await applyAutomationRoleMappingDefaults();
	await refreshAvailableModels();
	const sessionIdFromUrl = new URLSearchParams(window.location.search).get("session");
	if (sessionIdFromUrl) {
		const loaded = await loadSession(sessionIdFromUrl);
		if (!loaded) {
			newSession();
			return;
		}
	} else {
		await applyAutomationDefaultsForNewSession();
		await createAgent();
		await applyAutoSwitchedLocalModel();
	}
	refreshGuidedOnboardingProgress();
	await persistOrchestrationSettings();
	renderApp();
}

void initApp();
