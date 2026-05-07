import type { PluginSkillCatalogEntry } from "./plugin-skill-types.js";

export const BUNDLED_PLUGIN_SKILL_CATALOG: PluginSkillCatalogEntry[] = [
	{
		id: "caveman-plugin",
		type: "plugin",
		title: "Caveman",
		description: "Ultra-compressed communication mode plugin.",
		source: "git:https://github.com/juliusbrussee/caveman",
		version: "0.1.0",
		sourceOrigin: "bundled",
	},
	{
		id: "skill-template-pack",
		type: "skill-bundle",
		title: "Skill Template Pack",
		description: "Starter SKILL.md template for custom skill authoring.",
		source: "inline:skill-template-pack",
		version: "0.1.0",
		sourceOrigin: "bundled",
		defaultSkillName: "custom-skill",
	},
];

export const DEFAULT_SKILL_TEMPLATE_CONTENT = `---
name: custom-skill
description: Starter skill template for PI Studio. Update this description for your workflow.
---

# Custom Skill

Describe when to use this skill and the exact steps to follow.
`;
