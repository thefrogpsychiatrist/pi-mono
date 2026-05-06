import { createRequire } from "node:module";
import type { PluginSkillRpcPayload } from "./rpc-contract.js";

interface IpcRendererLike {
	invoke(channel: string, payload: PluginSkillRpcPayload): Promise<unknown>;
}

interface ContextBridgeLike {
	exposeInMainWorld(key: string, api: unknown): void;
}

const require = createRequire(import.meta.url);
const electron = require("electron") as {
	contextBridge: ContextBridgeLike;
	ipcRenderer: IpcRendererLike;
};

electron.contextBridge.exposeInMainWorld("__PI_STUDIO_RPC__", {
	request: (payload: PluginSkillRpcPayload): Promise<unknown> => {
		return electron.ipcRenderer.invoke("pi-studio-rpc-request", payload);
	},
});
