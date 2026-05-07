import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { canonicalizePath } from "../utils/paths.js";
import { AuthStorage } from "./auth-storage.js";
import type { ResolvedPaths } from "./package-manager.js";
import { DefaultPackageManager } from "./package-manager.js";
import { BUNDLED_PLUGIN_SKILL_CATALOG, DEFAULT_SKILL_TEMPLATE_CONTENT } from "./plugin-skill-catalog.js";
import type {
	BlueprintApplyResult,
	BlueprintPreview,
	BlueprintPreviewFile,
	BlueprintRequest,
	CatalogMergeState,
	CatalogSource,
	PluginInstallRequest,
	PluginRemoveRequest,
	PluginRemoveResult,
	PluginSkillAuditEntry,
	PluginSkillAuditQuery,
	PluginSkillAuditState,
	PluginSkillCatalogEntry,
	PluginSkillCatalogQuery,
	PluginSkillCatalogResult,
	PluginSkillDiscoveryState,
	PluginSkillFeatureFlags,
	PluginSkillSettingsState,
	PluginSkillSettingsUpdate,
	PluginStatus,
	PluginToggleRequest,
	PluginUpdateRequest,
	PluginValidationResult,
	SkillBundleCatalogEntry,
	SkillBundleInstallRequest,
	SkillBundleRemoveRequest,
	SkillBundleRemoveResult,
	SkillStatus,
	SkillToggleRequest,
	SkillValidationResult,
	SourceAuthConfig,
	SourceAuthRequest,
} from "./plugin-skill-types.js";
import type { PackageSource, SettingsManager } from "./settings-manager.js";
import { loadSkills } from "./skills.js";

const AUDIT_FILE_NAME = "plugin-skill-audit.jsonl";
const AUDIT_RETENTION_DAYS = 90;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_BUNDLE_BYTES = 1024 * 1024;
const GITHUB_SOURCE_AUTH_PROVIDER = "plugin-source:github";

interface PluginCounts {
	total: number;
	enabled: number;
	extensions: number;
	skills: number;
	prompts: number;
	themes: number;
}

interface PluginSkillManagerOptions {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	authStorage?: AuthStorage;
}

interface CatalogEnvelope {
	entries: PluginSkillCatalogEntry[];
}

interface DownloadResult {
	content: string;
	fetchedAt: string;
}

export class PluginSkillManager {
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly settingsManager: SettingsManager;
	private readonly packageManager: DefaultPackageManager;
	private readonly auditFilePath: string;
	private readonly authStorage: AuthStorage;

	constructor(options: PluginSkillManagerOptions) {
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.settingsManager = options.settingsManager;
		this.packageManager = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: this.settingsManager,
		});
		this.auditFilePath = join(this.agentDir, AUDIT_FILE_NAME);
		this.authStorage = options.authStorage ?? AuthStorage.create(join(this.agentDir, "auth.json"));
	}

	async getDiscoveryState(): Promise<PluginSkillDiscoveryState> {
		const resolved = await this.packageManager.resolve();
		const userPlugins = this.buildPluginStatuses(resolved);
		const allowlistedRoots = this.buildAllowlistedRoots(resolved, userPlugins);
		const skills = this.buildSkillStatuses(resolved, allowlistedRoots);
		const audit = this.getAuditState();
		const featureFlags = this.getFeatureFlags();
		return {
			plugins: userPlugins,
			skills,
			audit,
			allowlistedRoots,
			featureFlags,
		};
	}

	async listAuditEntries(query: PluginSkillAuditQuery = {}): Promise<PluginSkillAuditEntry[]> {
		const entries = this.readAuditEntries();
		const normalizedQuery = query.search?.trim().toLowerCase();

		let filtered = entries;
		if (query.domain) {
			filtered = filtered.filter((entry) => entry.domain === query.domain);
		}
		if (query.result) {
			filtered = filtered.filter((entry) => entry.result === query.result);
		}
		if (normalizedQuery) {
			filtered = filtered.filter((entry) => {
				const text = `${entry.targetLabel} ${entry.reason ?? ""} ${entry.actor}`.toLowerCase();
				return text.includes(normalizedQuery);
			});
		}

		const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 500) : 200;
		return filtered.slice(0, limit);
	}

	getSettingsState(): PluginSkillSettingsState {
		const settings = this.settingsManager.getPluginSkillSettings();
		return {
			featureFlags: settings.featureFlags,
			catalogRemoteUrl: settings.catalogRemoteUrl || undefined,
			importedCatalogPath: settings.importedCatalogPath || undefined,
			auditRetentionDays: this.getAuditRetentionDays(),
		};
	}

	updateSettings(request: PluginSkillSettingsUpdate): PluginSkillSettingsState {
		this.settingsManager.setPluginSkillSettings({
			featureFlags: request.featureFlags,
			catalogRemoteUrl: request.catalogRemoteUrl,
			importedCatalogPath: request.importedCatalogPath,
			auditRetentionDays: request.auditRetentionDays,
		});
		return this.getSettingsState();
	}

	getSourceAuth(provider: SourceAuthRequest["provider"]): SourceAuthConfig {
		const hasToken = Boolean(this.authStorage.get(provider === "github" ? GITHUB_SOURCE_AUTH_PROVIDER : provider));
		return {
			provider,
			hasToken,
		};
	}

	setSourceAuth(request: SourceAuthRequest): SourceAuthConfig {
		const providerKey = request.provider === "github" ? GITHUB_SOURCE_AUTH_PROVIDER : request.provider;
		const token = request.token?.trim();
		if (!token) {
			this.authStorage.remove(providerKey);
		} else {
			this.authStorage.set(providerKey, { type: "api_key", key: token });
		}
		return {
			provider: request.provider,
			hasToken: Boolean(token),
			updatedAt: new Date().toISOString(),
		};
	}

	async listCatalog(query: PluginSkillCatalogQuery = {}): Promise<PluginSkillCatalogResult> {
		const settings = this.settingsManager.getPluginSkillSettings();
		const mergedById = new Map<string, PluginSkillCatalogEntry>();
		let conflictCount = 0;
		const sources = new Set<CatalogSource>(["bundled"]);
		let remoteFetchedAt: string | undefined;
		let remoteFetchError: string | undefined;

		for (const entry of BUNDLED_PLUGIN_SKILL_CATALOG) {
			mergedById.set(entry.id, { ...entry, sourceOrigin: "bundled" });
		}

		const importedCatalogPath = query.importedCatalogPath || settings.importedCatalogPath;
		if (importedCatalogPath) {
			try {
				const imported = this.loadCatalogFromFile(importedCatalogPath);
				sources.add("imported");
				for (const entry of imported) {
					if (mergedById.has(entry.id)) {
						conflictCount++;
						continue;
					}
					mergedById.set(entry.id, { ...entry, sourceOrigin: "imported" });
				}
			} catch {
				// Keep catalog usable even when import fails.
			}
		}

		const featureFlags = this.getFeatureFlags();
		const remoteUrl = query.remoteUrl || settings.catalogRemoteUrl;
		if (featureFlags.catalogRemoteFallback && remoteUrl) {
			try {
				const remote = await this.loadCatalogFromRemote(remoteUrl, DEFAULT_MAX_CATALOG_BYTES);
				remoteFetchedAt = remote.fetchedAt;
				sources.add("remote");
				for (const entry of this.parseCatalogEnvelope(remote.content).entries) {
					if (mergedById.has(entry.id)) {
						conflictCount++;
						continue;
					}
					mergedById.set(entry.id, { ...entry, sourceOrigin: "remote" });
				}
			} catch (error) {
				remoteFetchError = error instanceof Error ? error.message : String(error);
			}
		}

		const entries = Array.from(mergedById.values()).sort((a, b) => a.title.localeCompare(b.title));
		const mergeState: CatalogMergeState = {
			sources: Array.from(sources),
			entryCount: entries.length,
			conflictCount,
			remoteFetchedAt,
			remoteFetchError,
		};
		return { entries, mergeState };
	}

	async installPlugin(request: PluginInstallRequest): Promise<PluginStatus> {
		this.requireFeatureFlag("marketplaceLifecycle");
		const source = await this.resolvePluginSourceFromRequest(request);
		await this.packageManager.installAndPersist(source, { local: false });

		const refreshedState = await this.getDiscoveryState();
		const plugin = refreshedState.plugins.find((item) => item.source === source);
		if (!plugin) {
			throw new Error(`Installed plugin could not be discovered: ${source}`);
		}

		const shouldEnable = request.enabled ?? true;
		if (!shouldEnable && plugin.status === "enabled") {
			return this.togglePlugin({ source, enabled: false, actor: request.actor });
		}
		if (shouldEnable && plugin.status === "disabled") {
			return this.togglePlugin({ source, enabled: true, actor: request.actor });
		}

		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "plugin",
			action: "install",
			targetId: plugin.id,
			targetLabel: plugin.source,
			result: "success",
		});
		return plugin;
	}

	async updatePlugin(request: PluginUpdateRequest): Promise<PluginStatus> {
		this.requireFeatureFlag("marketplaceLifecycle");
		await this.packageManager.update(request.source);
		const refreshed = (await this.getDiscoveryState()).plugins.find((item) => item.source === request.source);
		if (!refreshed) {
			throw new Error(`Updated plugin is not available: ${request.source}`);
		}
		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "plugin",
			action: "update",
			targetId: refreshed.id,
			targetLabel: refreshed.source,
			result: "success",
		});
		return refreshed;
	}

	async removePlugin(request: PluginRemoveRequest): Promise<PluginRemoveResult> {
		this.requireFeatureFlag("marketplaceLifecycle");
		const removed = await this.packageManager.removeAndPersist(request.source, { local: false });
		const orphanWarnings = this.findOrphanWarnings(request.source);
		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "plugin",
			action: "remove",
			targetId: this.slugify(`plugin:${request.source}`),
			targetLabel: request.source,
			result: removed ? "success" : "error",
			reason: removed ? undefined : "Plugin source was not removed from settings",
		});
		const plugin = (await this.getDiscoveryState()).plugins.find((item) => item.source === request.source);
		return { removed, plugin, orphanWarnings };
	}

	async validatePlugin(source: string, actor?: string): Promise<PluginStatus> {
		const plugin = (await this.getDiscoveryState()).plugins.find((item) => item.source === source);
		if (!plugin) {
			throw new Error(`Plugin source not found for validation: ${source}`);
		}
		this.appendAuditEntry({
			actor: actor ?? "rpc",
			domain: "plugin",
			action: "validate",
			targetId: plugin.id,
			targetLabel: plugin.source,
			result: plugin.validation.valid ? "success" : "blocked",
			reason: plugin.validation.valid ? undefined : plugin.validation.errors.join("; "),
		});
		return plugin;
	}

	async validateSkill(path: string, actor?: string): Promise<SkillStatus> {
		const skill = (await this.getDiscoveryState()).skills.find((item) => item.path === path);
		if (!skill) {
			throw new Error(`Skill path not found for validation: ${path}`);
		}
		this.appendAuditEntry({
			actor: actor ?? "rpc",
			domain: "skill",
			action: "validate",
			targetId: skill.id,
			targetLabel: skill.name,
			result: skill.validation.valid ? "success" : "blocked",
			reason: skill.validation.valid ? undefined : skill.validation.errors.join("; "),
		});
		return skill;
	}

	async installSkillBundle(request: SkillBundleInstallRequest): Promise<SkillStatus> {
		this.requireFeatureFlag("marketplaceLifecycle");
		const resolved = await this.resolveSkillBundleInstallRequest(request);
		const skillDir = join(this.agentDir, "skills", resolved.skillName);
		const skillFilePath = join(skillDir, "SKILL.md");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(skillFilePath, resolved.content, "utf-8");
		if (request.enabled === false) {
			const globalSettings = this.settingsManager.getGlobalSettings();
			const current = [...(globalSettings.skills ?? [])];
			const pattern = this.toPosixPath(relative(this.agentDir, skillFilePath));
			this.settingsManager.setSkillPaths(this.updatePatternList(current, pattern, false));
		}
		const status = (await this.getDiscoveryState()).skills.find((item) => item.path === skillFilePath);
		if (!status) {
			throw new Error(`Installed skill bundle could not be discovered: ${skillFilePath}`);
		}
		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "skill",
			action: "install",
			targetId: status.id,
			targetLabel: status.name,
			result: "success",
		});
		return status;
	}

	async removeSkillBundle(request: SkillBundleRemoveRequest): Promise<SkillBundleRemoveResult> {
		this.requireFeatureFlag("marketplaceLifecycle");
		const absolutePath = resolve(request.path);
		const isAllowlisted = this.isPathAllowlisted(absolutePath, [this.toComparablePath(this.agentDir)]);
		if (!isAllowlisted) {
			throw new Error(`Skill removal path is outside allowlisted roots: ${request.path}`);
		}
		if (existsSync(absolutePath)) {
			const stats = statSync(absolutePath);
			if (stats.isFile()) {
				rmSync(absolutePath, { force: true });
			} else {
				rmSync(absolutePath, { recursive: true, force: true });
			}
		}
		const globalSettings = this.settingsManager.getGlobalSettings();
		const current = [...(globalSettings.skills ?? [])];
		const canonical = this.toPosixPath(relative(this.agentDir, absolutePath));
		const next = current.filter((value) => this.stripPatternPrefix(value) !== canonical);
		this.settingsManager.setSkillPaths(next);
		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "skill",
			action: "remove",
			targetId: this.slugify(`skill:${absolutePath}`),
			targetLabel: absolutePath,
			result: "success",
		});
		return { removed: true, path: absolutePath };
	}

	previewBlueprint(request: BlueprintRequest): BlueprintPreview {
		this.requireFeatureFlag("blueprintStudio");
		const resolvedTargetDir = this.resolveBlueprintTargetDir(request);
		const files = this.buildBlueprintFiles(request, resolvedTargetDir);
		const warnings = files
			.filter((file) => existsSync(file.path))
			.map((file) => `File already exists and will require overwrite: ${file.path}`);
		return {
			preset: request.preset,
			resolvedTargetDir,
			files,
			warnings,
			summary: `${request.preset} blueprint with ${files.length} file(s)`,
		};
	}

	async applyBlueprint(request: BlueprintRequest): Promise<BlueprintApplyResult> {
		this.requireFeatureFlag("blueprintStudio");
		const preview = this.previewBlueprint(request);
		const createdPaths: string[] = [];
		for (const file of preview.files) {
			if (existsSync(file.path) && !request.allowOverwrite) {
				throw new Error(`Blueprint apply blocked, file exists: ${file.path}`);
			}
			mkdirSync(dirname(file.path), { recursive: true });
			writeFileSync(file.path, file.content, "utf-8");
			createdPaths.push(file.path);
		}

		let registeredSource: string | undefined;
		let enabledTarget: string | undefined;
		if (request.registerSource ?? true) {
			if (request.preset === "plugin-core") {
				registeredSource = preview.resolvedTargetDir;
				this.packageManager.addSourceToSettings(registeredSource, { local: false });
				if (request.enableAfterCreate) {
					const plugin = await this.installPlugin({
						source: registeredSource,
						enabled: true,
						actor: request.actor,
					});
					enabledTarget = plugin.source;
				}
			} else {
				registeredSource = preview.files[0]?.path;
				if (registeredSource) {
					const globalSettings = this.settingsManager.getGlobalSettings();
					const current = [...(globalSettings.skills ?? [])];
					const pattern = this.toPosixPath(relative(this.agentDir, registeredSource));
					this.settingsManager.setSkillPaths(
						this.updatePatternList(current, pattern, request.enableAfterCreate ?? true),
					);
					enabledTarget = registeredSource;
				}
			}
		}

		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: request.preset === "plugin-core" ? "plugin" : "skill",
			action: "apply_blueprint",
			targetId: this.slugify(`${request.preset}:${preview.resolvedTargetDir}`),
			targetLabel: preview.resolvedTargetDir,
			result: "success",
		});
		return {
			preset: request.preset,
			createdPaths,
			registeredSource,
			enabledTarget,
		};
	}

	async togglePlugin(request: PluginToggleRequest): Promise<PluginStatus> {
		const state = await this.getDiscoveryState();
		const plugin = state.plugins.find((item) => item.source === request.source);
		if (!plugin) {
			throw new Error(`Plugin source not found in user-global scope: ${request.source}`);
		}

		const action = request.enabled ? "enable" : "disable";
		if (request.enabled && !plugin.validation.valid) {
			const reason = plugin.validation.errors.join("; ") || "Plugin validation failed";
			this.appendAuditEntry({
				actor: request.actor ?? "rpc",
				domain: "plugin",
				action,
				targetId: plugin.id,
				targetLabel: plugin.source,
				result: "blocked",
				reason,
			});
			throw new Error(reason);
		}

		const globalSettings = this.settingsManager.getGlobalSettings();
		const packages = [...(globalSettings.packages ?? [])] as PackageSource[];
		const index = packages.findIndex((entry) => {
			const source = typeof entry === "string" ? entry : entry.source;
			return source === request.source;
		});
		if (index === -1) {
			throw new Error(`Plugin source is not configured globally: ${request.source}`);
		}

		if (request.enabled) {
			packages[index] = request.source;
		} else {
			packages[index] = {
				source: request.source,
				extensions: [],
				skills: [],
				prompts: [],
				themes: [],
			};
		}
		this.settingsManager.setPackages(packages);

		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "plugin",
			action,
			targetId: plugin.id,
			targetLabel: plugin.source,
			result: "success",
		});

		const refreshed = (await this.getDiscoveryState()).plugins.find((item) => item.source === request.source);
		if (!refreshed) {
			throw new Error(`Failed to refresh plugin state for ${request.source}`);
		}
		return refreshed;
	}

	async toggleSkill(request: SkillToggleRequest): Promise<SkillStatus> {
		const state = await this.getDiscoveryState();
		const skill = state.skills.find((item) => item.path === request.path);
		if (!skill) {
			throw new Error(`Skill path not found in user-global scope: ${request.path}`);
		}

		const action = request.enabled ? "enable" : "disable";
		if (request.enabled && !skill.validation.valid) {
			const reason = skill.validation.errors.join("; ") || "Skill validation failed";
			this.appendAuditEntry({
				actor: request.actor ?? "rpc",
				domain: "skill",
				action,
				targetId: skill.id,
				targetLabel: skill.name,
				result: "blocked",
				reason,
			});
			throw new Error(reason);
		}

		if (skill.origin === "top-level") {
			const globalSettings = this.settingsManager.getGlobalSettings();
			const current = [...(globalSettings.skills ?? [])] as string[];
			const pattern = this.toPosixPath(relative(this.agentDir, skill.path));
			this.settingsManager.setSkillPaths(this.updatePatternList(current, pattern, request.enabled));
		} else {
			const source = skill.pluginSource;
			if (!source) {
				throw new Error(`Package-backed skill is missing plugin source: ${skill.path}`);
			}

			const globalSettings = this.settingsManager.getGlobalSettings();
			const packages = [...(globalSettings.packages ?? [])] as PackageSource[];
			const index = packages.findIndex((entry) => {
				const configuredSource = typeof entry === "string" ? entry : entry.source;
				return configuredSource === source;
			});
			if (index === -1) {
				throw new Error(`Package source not found for skill: ${source}`);
			}

			let packageEntry = packages[index];
			if (typeof packageEntry === "string") {
				packageEntry = { source: packageEntry };
				packages[index] = packageEntry;
			}

			const baseDir = skill.metadata.baseDir ?? dirname(skill.path);
			const pattern = this.toPosixPath(relative(baseDir, skill.path));
			const current = [...((packageEntry.skills ?? []) as string[])];
			packageEntry.skills = this.updatePatternList(current, pattern, request.enabled);
			packages[index] = packageEntry;
			this.settingsManager.setPackages(packages);
		}

		this.appendAuditEntry({
			actor: request.actor ?? "rpc",
			domain: "skill",
			action,
			targetId: skill.id,
			targetLabel: skill.name,
			result: "success",
		});

		const refreshed = (await this.getDiscoveryState()).skills.find((item) => item.path === request.path);
		if (!refreshed) {
			throw new Error(`Failed to refresh skill state for ${request.path}`);
		}
		return refreshed;
	}

	private getFeatureFlags(): PluginSkillFeatureFlags {
		const settings = this.settingsManager.getPluginSkillSettings();
		return {
			marketplaceLifecycle: settings.featureFlags.marketplaceLifecycle,
			catalogRemoteFallback: settings.featureFlags.catalogRemoteFallback,
			blueprintStudio: settings.featureFlags.blueprintStudio,
		};
	}

	private requireFeatureFlag(flag: keyof PluginSkillFeatureFlags): void {
		if (!this.getFeatureFlags()[flag]) {
			throw new Error(`Feature flag "${flag}" is disabled`);
		}
	}

	private getAuditRetentionDays(): number {
		const settings = this.settingsManager.getPluginSkillSettings();
		const value = Number(settings.auditRetentionDays);
		if (!Number.isFinite(value) || value <= 0) {
			return AUDIT_RETENTION_DAYS;
		}
		return Math.max(7, Math.min(365, Math.floor(value)));
	}

	private findOrphanWarnings(source: string): string[] {
		const warnings: string[] = [];
		const skills = this.settingsManager.getSkillPaths();
		const packagePatterns = this.settingsManager
			.getPackages()
			.filter((entry) => typeof entry !== "string" && entry.source === source)
			.flatMap((entry) => (typeof entry === "string" ? [] : (entry.skills ?? [])));
		if (skills.length > 0 || packagePatterns.length > 0) {
			warnings.push(`Skill patterns may still reference removed source "${source}"`);
		}
		return warnings;
	}

	private async resolvePluginSourceFromRequest(request: PluginInstallRequest): Promise<string> {
		if (request.source?.trim()) {
			return request.source.trim();
		}
		if (!request.catalogId) {
			throw new Error("Plugin install requires source or catalogId");
		}
		const catalog = await this.listCatalog();
		const entry = catalog.entries.find((item) => item.id === request.catalogId);
		if (!entry) {
			throw new Error(`Catalog entry not found: ${request.catalogId}`);
		}
		if (entry.type !== "plugin") {
			throw new Error(`Catalog entry is not a plugin: ${request.catalogId}`);
		}
		return entry.source;
	}

	private async resolveSkillBundleInstallRequest(
		request: SkillBundleInstallRequest,
	): Promise<{ skillName: string; content: string }> {
		if (request.source?.trim()) {
			const source = request.source.trim();
			const content = await this.loadSkillBundleContentFromSource(source, undefined, undefined);
			return {
				skillName: this.normalizeSkillName(request.name || basename(dirname(source))),
				content,
			};
		}
		if (!request.catalogId) {
			throw new Error("Skill bundle install requires source or catalogId");
		}

		const catalog = await this.listCatalog();
		const entry = catalog.entries.find((item) => item.id === request.catalogId);
		if (!entry) {
			throw new Error(`Catalog entry not found: ${request.catalogId}`);
		}
		if (entry.type !== "skill-bundle") {
			throw new Error(`Catalog entry is not a skill bundle: ${request.catalogId}`);
		}
		const skillEntry = entry as SkillBundleCatalogEntry;
		const defaultName = skillEntry.defaultSkillName || skillEntry.id;
		const source = skillEntry.source;
		const content = source.startsWith("inline:")
			? DEFAULT_SKILL_TEMPLATE_CONTENT.replace("custom-skill", this.normalizeSkillName(defaultName))
			: await this.loadSkillBundleContentFromSource(source, skillEntry.sha256, skillEntry.maxBytes);
		return {
			skillName: this.normalizeSkillName(request.name || defaultName),
			content,
		};
	}

	private async loadSkillBundleContentFromSource(
		source: string,
		sha256: string | undefined,
		maxBytes: number | undefined,
	): Promise<string> {
		if (/^https?:\/\//.test(source)) {
			const response = await this.downloadText(source, maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES);
			if (sha256) {
				const actual = crypto.createHash("sha256").update(response.content).digest("hex");
				if (actual !== sha256) {
					throw new Error(`Skill bundle checksum mismatch for ${source}`);
				}
			}
			return response.content;
		}
		const resolvedPath = resolve(this.cwd, source);
		if (!existsSync(resolvedPath)) {
			throw new Error(`Skill bundle source does not exist: ${source}`);
		}
		const stats = statSync(resolvedPath);
		if (stats.isDirectory()) {
			const skillPath = join(resolvedPath, "SKILL.md");
			if (!existsSync(skillPath)) {
				throw new Error(`Skill bundle directory does not include SKILL.md: ${source}`);
			}
			return readFileSync(skillPath, "utf-8");
		}
		return readFileSync(resolvedPath, "utf-8");
	}

	private normalizeSkillName(name: string): string {
		return (
			name
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, "-")
				.replace(/-{2,}/g, "-")
				.replace(/^-+|-+$/g, "") || "skill"
		);
	}

	private loadCatalogFromFile(path: string): PluginSkillCatalogEntry[] {
		const absolutePath = resolve(this.cwd, path);
		if (!existsSync(absolutePath)) {
			throw new Error(`Catalog import path does not exist: ${path}`);
		}
		const raw = readFileSync(absolutePath, "utf-8");
		return this.parseCatalogEnvelope(raw).entries;
	}

	private async loadCatalogFromRemote(url: string, maxBytes: number): Promise<DownloadResult> {
		return this.downloadText(url, maxBytes);
	}

	private parseCatalogEnvelope(content: string): CatalogEnvelope {
		const parsed = JSON.parse(content) as CatalogEnvelope | PluginSkillCatalogEntry[];
		const entries = Array.isArray(parsed) ? parsed : parsed.entries;
		if (!Array.isArray(entries)) {
			throw new Error("Catalog payload must include an entries array");
		}
		return {
			entries: entries
				.filter((entry) => entry && typeof entry === "object")
				.map((entry) => ({
					...entry,
					sourceOrigin: entry.sourceOrigin ?? "imported",
				})) as PluginSkillCatalogEntry[],
		};
	}

	private async downloadText(url: string, maxBytes: number): Promise<DownloadResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
		try {
			const headers = await this.getDownloadHeaders(url);
			const response = await fetch(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(`Download failed (${response.status}) for ${url}`);
			}
			const text = await response.text();
			const byteLength = Buffer.byteLength(text, "utf-8");
			if (byteLength > maxBytes) {
				throw new Error(`Download size ${byteLength} exceeded limit ${maxBytes}`);
			}
			return {
				content: text,
				fetchedAt: new Date().toISOString(),
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private async getDownloadHeaders(url: string): Promise<Record<string, string>> {
		const headers: Record<string, string> = {};
		if (
			!url.includes("github.com") &&
			!url.includes("api.github.com") &&
			!url.includes("raw.githubusercontent.com")
		) {
			return headers;
		}
		const token = await this.authStorage.getApiKey(GITHUB_SOURCE_AUTH_PROVIDER, { includeFallback: false });
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		headers.Accept = "application/vnd.github+json";
		return headers;
	}

	private resolveBlueprintTargetDir(request: BlueprintRequest): string {
		const baseDir = request.targetDir?.trim()
			? resolve(this.cwd, request.targetDir.trim())
			: join(
					this.agentDir,
					request.preset === "plugin-core" ? "plugins" : "skills",
					this.normalizeSkillName(request.name),
				);
		const allowlistedRoots = [this.toComparablePath(this.agentDir), this.toComparablePath(this.cwd)];
		if (!this.isPathAllowlisted(baseDir, allowlistedRoots)) {
			throw new Error(`Blueprint target is outside allowlisted roots: ${baseDir}`);
		}
		return baseDir;
	}

	private buildBlueprintFiles(request: BlueprintRequest, targetDir: string): BlueprintPreviewFile[] {
		if (request.preset === "plugin-core") {
			const packageJsonPath = join(targetDir, "package.json");
			const skillDir = join(targetDir, "skills", this.normalizeSkillName(request.name));
			const skillFilePath = join(skillDir, "SKILL.md");
			const packageJsonContent = JSON.stringify(
				{
					name: `pi-${this.normalizeSkillName(request.name)}`,
					version: "0.1.0",
					private: true,
					pi: {
						skills: [`skills/${this.normalizeSkillName(request.name)}/SKILL.md`],
					},
				},
				null,
				2,
			);
			const skillContent = `---
name: ${this.normalizeSkillName(request.name)}
description: ${request.description || "Generated plugin skill."}
---

# ${request.name}

Describe when this skill should be used and how it should behave.
`;
			return [
				{ path: packageJsonPath, content: `${packageJsonContent}\n` },
				{ path: skillFilePath, content: skillContent },
			];
		}

		const skillFilePath = extname(targetDir).toLowerCase() === ".md" ? targetDir : join(targetDir, "SKILL.md");
		const skillContent = `---
name: ${this.normalizeSkillName(request.name)}
description: ${request.description || "Generated skill."}
---

# ${request.name}

Use this skill when:
- Condition 1
- Condition 2

Steps:
1. Gather context.
2. Execute deterministic actions.
3. Return concise results.
`;
		return [{ path: skillFilePath, content: skillContent }];
	}

	private buildPluginStatuses(resolved: ResolvedPaths): PluginStatus[] {
		const countsBySource = new Map<string, PluginCounts>();
		const ensureCounts = (source: string): PluginCounts => {
			let counts = countsBySource.get(source);
			if (!counts) {
				counts = { total: 0, enabled: 0, extensions: 0, skills: 0, prompts: 0, themes: 0 };
				countsBySource.set(source, counts);
			}
			return counts;
		};

		const countResources = (source: string, enabled: boolean, key: keyof Omit<PluginCounts, "total" | "enabled">) => {
			const counts = ensureCounts(source);
			counts.total += 1;
			counts[key] += 1;
			if (enabled) counts.enabled += 1;
		};

		for (const resource of resolved.extensions) {
			if (resource.metadata.scope === "user" && resource.metadata.origin === "package") {
				countResources(resource.metadata.source, resource.enabled, "extensions");
			}
		}
		for (const resource of resolved.skills) {
			if (resource.metadata.scope === "user" && resource.metadata.origin === "package") {
				countResources(resource.metadata.source, resource.enabled, "skills");
			}
		}
		for (const resource of resolved.prompts) {
			if (resource.metadata.scope === "user" && resource.metadata.origin === "package") {
				countResources(resource.metadata.source, resource.enabled, "prompts");
			}
		}
		for (const resource of resolved.themes) {
			if (resource.metadata.scope === "user" && resource.metadata.origin === "package") {
				countResources(resource.metadata.source, resource.enabled, "themes");
			}
		}

		const configured = this.packageManager
			.listConfiguredPackages()
			.filter((entry) => entry.scope === "user")
			.sort((a, b) => a.source.localeCompare(b.source));

		return configured.map((entry) => {
			const counts = countsBySource.get(entry.source) ?? {
				total: 0,
				enabled: 0,
				extensions: 0,
				skills: 0,
				prompts: 0,
				themes: 0,
			};
			const validation = this.computePluginValidation(entry.source, entry.installedPath, counts.total > 0);
			return {
				id: this.slugify(`plugin:${entry.source}`),
				source: entry.source,
				scope: "user",
				status: counts.enabled > 0 ? "enabled" : "disabled",
				installedPath: entry.installedPath,
				resources: counts,
				validation,
			};
		});
	}

	private buildSkillStatuses(resolved: ResolvedPaths, allowlistedRoots: string[]): SkillStatus[] {
		const userSkills = resolved.skills
			.filter((item) => item.metadata.scope === "user")
			.sort((a, b) => a.path.localeCompare(b.path));

		return userSkills.map((item) => {
			const name = basename(item.path) === "SKILL.md" ? basename(dirname(item.path)) : basename(item.path);
			const validation = this.computeSkillValidation(item.path, allowlistedRoots);
			return {
				id: this.slugify(`skill:${item.path}`),
				name,
				path: item.path,
				scope: "user",
				status: item.enabled ? "enabled" : "disabled",
				origin: item.metadata.origin === "package" ? "package" : "top-level",
				pluginSource: item.metadata.origin === "package" ? item.metadata.source : undefined,
				metadata: item.metadata,
				validation,
			};
		});
	}

	private computePluginValidation(
		_source: string,
		installedPath: string | undefined,
		hasDiscoveredResources: boolean,
	): PluginValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!installedPath) {
			errors.push("Installed path is missing");
		} else if (!existsSync(installedPath)) {
			errors.push(`Installed path does not exist: ${installedPath}`);
		} else {
			try {
				const stats = statSync(installedPath);
				if (stats.isDirectory()) {
					const packageJsonPath = join(installedPath, "package.json");
					if (!existsSync(packageJsonPath)) {
						warnings.push("package.json was not found in plugin root");
					} else {
						try {
							const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
							if ("pi" in parsed) {
								const manifest = parsed.pi as Record<string, unknown> | undefined;
								if (manifest && typeof manifest === "object") {
									for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
										const value = manifest[key];
										if (value !== undefined && !Array.isArray(value)) {
											errors.push(`pi.${key} must be an array when specified`);
										}
									}
								}
							}
						} catch (error) {
							errors.push(
								`Invalid package.json: ${error instanceof Error ? error.message : "failed to parse JSON"}`,
							);
						}
					}
				} else if (!stats.isFile()) {
					errors.push(`Installed path is neither a file nor a directory: ${installedPath}`);
				}
			} catch (error) {
				errors.push(`Unable to stat installed path: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (!hasDiscoveredResources) {
			errors.push("No package resources were discovered for this plugin");
		}

		return {
			valid: errors.length === 0,
			checkedAt: new Date().toISOString(),
			errors,
			warnings,
		};
	}

	private computeSkillValidation(path: string, allowlistedRoots: string[]): SkillValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!this.isPathAllowlisted(path, allowlistedRoots)) {
			errors.push("Skill path is outside allowlisted roots");
		}
		if (!existsSync(path)) {
			errors.push(`Skill path does not exist: ${path}`);
		}

		if (errors.length === 0) {
			const result = loadSkills({
				cwd: this.cwd,
				agentDir: this.agentDir,
				skillPaths: [path],
				includeDefaults: false,
			});

			const canonicalPath = this.toComparablePath(path);
			const loaded = result.skills.some((skill) => this.toComparablePath(skill.filePath) === canonicalPath);
			if (!loaded) {
				errors.push("Skill file failed validation and could not be loaded");
			}
			for (const diagnostic of result.diagnostics) {
				const message = diagnostic.message;
				if (diagnostic.type === "warning" || diagnostic.type === "collision") {
					warnings.push(message);
				}
			}
		}

		return {
			valid: errors.length === 0,
			checkedAt: new Date().toISOString(),
			errors,
			warnings,
		};
	}

	private buildAllowlistedRoots(resolved: ResolvedPaths, plugins: PluginStatus[]): string[] {
		const roots = new Set<string>();
		roots.add(this.toComparablePath(this.agentDir));

		for (const plugin of plugins) {
			if (plugin.installedPath) {
				roots.add(this.toComparablePath(plugin.installedPath));
			}
		}

		for (const skill of resolved.skills) {
			if (skill.metadata.scope !== "user") continue;
			const base = skill.metadata.baseDir ?? dirname(skill.path);
			roots.add(this.toComparablePath(base));
		}

		return Array.from(roots).sort();
	}

	private isPathAllowlisted(path: string, allowlistedRoots: string[]): boolean {
		const target = this.toComparablePath(path);
		for (const root of allowlistedRoots) {
			if (target === root) return true;
			const prefix = root.endsWith("/") ? root : `${root}/`;
			if (target.startsWith(prefix)) return true;
		}
		return false;
	}

	private updatePatternList(current: string[], pattern: string, enabled: boolean): string[] {
		const filtered = current.filter((value) => this.stripPatternPrefix(value) !== pattern);
		filtered.push(`${enabled ? "+" : "-"}${pattern}`);
		return filtered;
	}

	private stripPatternPrefix(value: string): string {
		if (value.startsWith("!") || value.startsWith("+") || value.startsWith("-")) {
			return value.slice(1);
		}
		return value;
	}

	private toComparablePath(path: string): string {
		const canonical = canonicalizePath(resolve(path));
		const normalized = this.toPosixPath(canonical);
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	}

	private toPosixPath(path: string): string {
		return path.replace(/\\/g, "/");
	}

	private slugify(value: string): string {
		return Buffer.from(value).toString("base64url");
	}

	private getAuditState(): PluginSkillAuditState {
		const entries = this.readAuditEntries();
		return {
			filePath: this.auditFilePath,
			retentionDays: this.getAuditRetentionDays(),
			totalEntries: entries.length,
		};
	}

	private appendAuditEntry(entry: Omit<PluginSkillAuditEntry, "id" | "timestamp">): void {
		const entries = this.readAuditEntries();
		const nextEntry: PluginSkillAuditEntry = {
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			...entry,
		};
		entries.unshift(nextEntry);
		this.writeAuditEntries(entries);
	}

	private readAuditEntries(): PluginSkillAuditEntry[] {
		const retentionMs = this.getAuditRetentionDays() * 24 * 60 * 60 * 1000;
		const cutoff = Date.now() - retentionMs;
		if (!existsSync(this.auditFilePath)) {
			return [];
		}

		const raw = readFileSync(this.auditFilePath, "utf-8");
		const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
		const parsed: PluginSkillAuditEntry[] = [];
		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as PluginSkillAuditEntry;
				const time = Date.parse(entry.timestamp);
				if (!Number.isFinite(time) || Number.isNaN(time) || time < cutoff) {
					continue;
				}
				parsed.push(entry);
			} catch {
				// Ignore malformed lines.
			}
		}

		parsed.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
		this.writeAuditEntries(parsed);
		return parsed;
	}

	private writeAuditEntries(entries: PluginSkillAuditEntry[]): void {
		const dir = dirname(this.auditFilePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
		writeFileSync(this.auditFilePath, content.length > 0 ? `${content}\n` : "", "utf-8");
	}
}
