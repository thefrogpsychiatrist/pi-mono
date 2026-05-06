import type { AgentSpecialistRole, RoutingRuleConfig } from "./types.js";

export const DEFAULT_ROUTING_RULES: RoutingRuleConfig[] = [
	{
		containsAny: ["bug", "fix", "error", "test", "debug", "refactor"],
		steps: [
			{ role: "planner", title: "Plan fix" },
			{ role: "coder", title: "Implement change" },
			{ role: "reviewer", title: "Review and risks" },
			{ role: "summarizer", title: "Summarize outcome" },
		],
		reason: "Software implementation and validation workflow",
	},
	{
		containsAny: ["design", "ui", "ux", "screen", "layout", "flow"],
		steps: [
			{ role: "planner", title: "Define UX strategy" },
			{ role: "coder", title: "Implement UI changes" },
			{ role: "reviewer", title: "Evaluate usability and regressions" },
			{ role: "summarizer", title: "Present final UX decisions" },
		],
		reason: "UI and experience-oriented workflow",
	},
	{
		containsAny: ["analysis", "research", "compare", "evaluate"],
		steps: [
			{ role: "planner", title: "Scope research" },
			{ role: "reviewer", title: "Critically evaluate evidence" },
			{ role: "summarizer", title: "Synthesize recommendations" },
		],
		reason: "Research and synthesis workflow",
	},
];

export function classifyTask(input: string, rules: RoutingRuleConfig[] = DEFAULT_ROUTING_RULES): RoutingRuleConfig {
	const lowerInput = input.toLowerCase();
	for (const rule of rules) {
		if (rule.containsAny.some((keyword) => lowerInput.includes(keyword))) {
			return rule;
		}
	}
	return {
		containsAny: [],
		steps: [
			{ role: "planner", title: "Plan approach" },
			{ role: "coder", title: "Execute primary task" },
			{ role: "summarizer", title: "Summarize result" },
		],
		reason: "Default general-purpose workflow",
	};
}

export function specialistSystemInstruction(role: AgentSpecialistRole): string {
	switch (role) {
		case "planner":
			return "You are the planning specialist. Break the task into clear, practical steps and constraints.";
		case "coder":
			return "You are the implementation specialist. Produce concrete technical output and precise changes.";
		case "reviewer":
			return "You are the review specialist. Focus on correctness, regressions, risks, and missing tests.";
		case "summarizer":
			return "You are the summarization specialist. Produce concise final output with decisions and outcomes.";
	}
}
