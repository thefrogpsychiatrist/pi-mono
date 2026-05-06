import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@mariozechner/pi-coding-agent";
import type { PluginSkillRpcPayload } from "./rpc-contract.js";

interface BrowserWindowOptions {
	width: number;
	height: number;
	minWidth?: number;
	minHeight?: number;
	title?: string;
	autoHideMenuBar?: boolean;
	webPreferences: {
		preload: string;
		contextIsolation: boolean;
		nodeIntegration: boolean;
	};
}

interface BrowserWindowInstance {
	loadURL(url: string): Promise<void>;
	on(event: "closed", listener: () => void): void;
}

interface BrowserWindowConstructor {
	new (options: BrowserWindowOptions): BrowserWindowInstance;
	getAllWindows(): BrowserWindowInstance[];
}

interface IpcMainLike {
	handle(channel: string, listener: (_event: unknown, payload: PluginSkillRpcPayload) => Promise<unknown>): void;
}

interface AppLike {
	whenReady(): Promise<void>;
	on(event: "window-all-closed", listener: () => void): void;
	on(event: "activate", listener: () => void): void;
	quit(): void;
}

const require = createRequire(import.meta.url);
const electron = require("electron") as {
	app: AppLike;
	BrowserWindow: BrowserWindowConstructor;
	ipcMain: IpcMainLike;
};

const { app, BrowserWindow, ipcMain } = electron;

const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, "preload.js");
const rendererUrl = process.env.PI_STUDIO_RENDERER_URL ?? "http://127.0.0.1:4173/";

const rpcClient = new RpcClient({
	cwd: process.cwd(),
	cliPath: process.env.PI_STUDIO_RPC_CLI_PATH,
});

let mainWindow: BrowserWindowInstance | null = null;
let rpcStarted = false;

async function ensureRpcStarted(): Promise<void> {
	if (rpcStarted) return;
	await rpcClient.start();
	rpcStarted = true;
}

async function handlePluginSkillRpc(payload: PluginSkillRpcPayload): Promise<unknown> {
	await ensureRpcStarted();

	switch (payload.type) {
		case "get_plugin_skill_state":
			return rpcClient.getPluginSkillState();
		case "toggle_plugin":
			return rpcClient.togglePlugin(payload.request);
		case "toggle_skill":
			return rpcClient.toggleSkill(payload.request);
		case "get_plugin_skill_audit":
			return rpcClient.getPluginSkillAudit(payload.query);
		default:
			throw new Error(`Unsupported RPC payload type: ${JSON.stringify(payload)}`);
	}
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 960,
		minWidth: 1100,
		minHeight: 720,
		title: "PI Studio",
		autoHideMenuBar: true,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	void mainWindow.loadURL(rendererUrl);
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

ipcMain.handle("pi-studio-rpc-request", async (_event, payload) => {
	return handlePluginSkillRpc(payload);
});

void app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	void rpcClient.stop();
	if (process.platform !== "darwin") {
		app.quit();
	}
});
