import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import {
	Agent,
	type AgentMessage,
	type AgentSpecialistRole,
	classifyTask,
	type ConversationStyle,
	type HandoffEvent,
	type OrchestrationMode,
	type SequentialStep,
	specialistSystemInstruction,
} from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
	type AgentState,
	ApiKeyPromptDialog,
	AppStorage,
	ChatPanel,
	type ConversationStyle as StoredConversationStyle,
	CustomProvidersStore,
	createJavaScriptReplTool,
	IndexedDBStorageBackend,
	type OrchestrationTrace,
	ProviderKeysStore,
	ProvidersModelsTab,
	ProxyTab,
	SessionListDialog,
	SessionsStore,
	SettingsDialog,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { Bell, History, Plus, Settings } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { createSystemNotification, customConvertToLlm, registerCustomMessageRenderers } from "./custom-messages.js";

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

let currentSessionId: string | undefined;
let currentTitle = "";
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;
let conversationStyle: ConversationStyle = "default";
let orchestrationMode: OrchestrationMode = "single-agent";
let orchestrationTrace: OrchestrationTrace = { steps: [], events: [] };
let activeSpecialist: AgentSpecialistRole | null = null;

const roleModelMapping: Record<AgentSpecialistRole, string> = {
	planner: "claude-sonnet-4-5-20250929",
	coder: "claude-sonnet-4-5-20250929",
	reviewer: "claude-sonnet-4-5-20250929",
	summarizer: "claude-sonnet-4-5-20250929",
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

function caveManPrefix(input: string): string {
	if (conversationStyle === "default") return input;
	return `Use caveman speaking style: short phrases, minimal grammar, no fluff, keep technical accuracy.\n\nUser request:\n${input}`;
}

function pushOrchestrationMessage(step: SequentialStep, reason: string, fromRole?: AgentSpecialistRole): void {
	const handoff: HandoffEvent = {
		stepId: step.id,
		fromRole,
		toRole: step.role,
		reason,
		timestamp: Date.now(),
	};
	orchestrationTrace.events.push(handoff);
	agent.state.messages.push({
		role: "orchestration",
		timestamp: handoff.timestamp,
		step,
		handoffReason: reason,
		fromRole,
		toRole: step.role,
	});
	void agent.emitOrchestrationTransition(handoff, step);
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

async function runSequentialWorkflow(input: string): Promise<void> {
	const selectedRule = classifyTask(input);
	orchestrationTrace = { steps: [], events: [] };
	const steps: SequentialStep[] = selectedRule.steps.map((s, idx) => ({
		id: `step-${idx + 1}`,
		role: s.role,
		title: s.title,
		status: "queued",
		task: input,
	}));
	orchestrationTrace.steps = steps;
	let previousSummary = "";
	for (let index = 0; index < steps.length; index++) {
		const step = steps[index];
		const previousRole = index > 0 ? steps[index - 1]?.role : undefined;
		for (const entry of steps) {
			if (entry.id === step.id) entry.status = "active-agent";
		}
		activeSpecialist = step.role;
		pushOrchestrationMessage(step, selectedRule.reason, previousRole);
		renderApp();
		const modelId = roleModelMapping[step.role];
		const model = getModel("anthropic", modelId);
		if (model) {
			agent.state.model = model;
		}
		const specialistPrompt =
			index === 0
				? `${specialistSystemInstruction(step.role)}\n\n${caveManPrefix(input)}`
				: `${specialistSystemInstruction(step.role)}\n\nPrevious specialist summary:\n${previousSummary}\n\nContinue task with focus on ${step.title}.`;
		await agent.prompt(specialistPrompt);
		previousSummary = summarizeLatestAssistantMessage();
		for (const entry of steps) {
			if (entry.id === step.id) {
				entry.status = "completed-step";
				entry.resultSummary = previousSummary;
			}
		}
		renderApp();
	}
	activeSpecialist = null;
	orchestrationTrace.finalSummary = previousSummary;
}

const saveSession = async () => {
	if (!storage.sessions || !currentSessionId || !agent || !currentTitle) return;
	const state = agent.state;
	if (!shouldSaveSession(state.messages)) return;
	try {
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
		};
		await storage.sessions.save(sessionData, metadata);
	} catch (err) {
		console.error("Failed to save session:", err);
	}
};

const updateUrl = (sessionId: string) => {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.history.replaceState({}, "", url);
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
				await runSequentialWorkflow(input);
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
	orchestrationTrace = sessionData.orchestrationTrace || { steps: [], events: [] };
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

const renderTimeline = () => {
	if (orchestrationTrace.steps.length === 0) return html``;
	return html`
		<div class="border-b border-border px-4 py-2 bg-secondary/20">
			<div class="text-xs uppercase tracking-wide text-muted-foreground">Sequential Timeline</div>
			<div class="mt-2 flex flex-col gap-2">
				${orchestrationTrace.steps.map(
					(step) => html`<div class="text-sm flex items-center justify-between">
						<span>${step.title}</span>
						<span class="text-xs text-muted-foreground">${step.status}</span>
					</div>`,
				)}
				${
					activeSpecialist
						? html`<div class="text-xs text-muted-foreground">Active specialist: ${activeSpecialist}</div>`
						: ""
				}
			</div>
		</div>
	`;
};

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
							SessionListDialog.open(async (sessionId) => loadSession(sessionId), (deletedSessionId) => {
								if (deletedSessionId === currentSessionId) newSession();
							});
						},
						title: "Sessions",
					})}
					${Button({ variant: "ghost", size: "sm", children: icon(Plus, "sm"), onClick: newSession, title: "New Session" })}
					${currentTitle
						? html`<span class="text-sm">${currentTitle}</span>`
						: html`<span class="text-base font-semibold text-foreground">Pi Web UI Example</span>`}
				</div>
				<div class="flex items-center gap-2 px-2">
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
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Bell, "sm"),
						onClick: () => {
							agent.steer(createSystemNotification("Custom UI notification queued."));
						},
						title: "Demo",
					})}
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Settings, "sm"),
						onClick: () => SettingsDialog.open([new ProvidersModelsTab(), new ProxyTab()]),
						title: "Settings",
					})}
				</div>
			</div>
			${renderTimeline()}
			${chatPanel}
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
	const sessionIdFromUrl = new URLSearchParams(window.location.search).get("session");
	if (sessionIdFromUrl) {
		const loaded = await loadSession(sessionIdFromUrl);
		if (!loaded) {
			newSession();
			return;
		}
	} else {
		await createAgent();
	}
	renderApp();
}

void initApp();
