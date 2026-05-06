export type PluginSkillRpcPayload =
	| { type: "get_plugin_skill_state" }
	| {
			type: "toggle_plugin";
			request: { source: string; enabled: boolean; actor?: string };
	  }
	| {
			type: "toggle_skill";
			request: { path: string; enabled: boolean; actor?: string };
	  }
	| {
			type: "get_plugin_skill_audit";
			query?: {
				search?: string;
				domain?: "plugin" | "skill";
				result?: "success" | "blocked" | "error";
				limit?: number;
			};
	  };
