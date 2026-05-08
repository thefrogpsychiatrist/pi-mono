export type SlashCommandGroup =
	| "chat"
	| "session"
	| "model"
	| "reasoning"
	| "orchestration"
	| "templates"
	| "plugins"
	| "skills"
	| "exports"
	| "diagnostics"
	| "settings";

export type SlashCommandSource = "built-in" | "rpc";
export type SlashCommandSafety = "safe" | "confirm";
export type SlashCommandMode = "execute" | "insert";

export interface SlashCommand {
	id: string;
	command: string;
	label: string;
	description: string;
	group: SlashCommandGroup;
	source: SlashCommandSource;
	mode: SlashCommandMode;
	safety: SlashCommandSafety;
	insertText?: string;
	confirmationMessage?: string;
	keywords?: string[];
	disabled?: boolean;
}

export interface SlashCommandSelection {
	command: SlashCommand;
	query: string;
}

export const SLASH_COMMAND_GROUP_LABELS: Record<SlashCommandGroup, string> = {
	chat: "Chat",
	session: "Session",
	model: "Model",
	reasoning: "Reasoning",
	orchestration: "Orchestration",
	templates: "Templates",
	plugins: "Plugins",
	skills: "Skills",
	exports: "Exports",
	diagnostics: "Diagnostics",
	settings: "Settings",
};

const normalize = (value: string): string => value.trim().toLowerCase();

function scoreCommand(command: SlashCommand, query: string): number {
	if (!query) return 1;
	const normalizedQuery = normalize(query);
	const haystack = [command.command, command.label, command.description, command.group, ...(command.keywords ?? [])]
		.map(normalize)
		.join(" ");
	if (haystack.includes(normalizedQuery)) return 100 - haystack.indexOf(normalizedQuery);
	let cursor = 0;
	for (const char of normalizedQuery) {
		cursor = haystack.indexOf(char, cursor);
		if (cursor === -1) return 0;
		cursor += 1;
	}
	return 10;
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
	return commands
		.map((command) => ({ command, score: scoreCommand(command, query) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.command.group.localeCompare(b.command.group))
		.map((entry) => entry.command);
}
