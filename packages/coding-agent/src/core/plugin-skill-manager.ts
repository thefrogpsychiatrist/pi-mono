import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { canonicalizePath } from "../utils/paths.js";
import type { ResolvedPaths } from "./package-manager.js";
import { DefaultPackageManager } from "./package-manager.js";
import type {
	PluginSkillAuditEntry,
	PluginSkillAuditQuery,
	PluginSkillAuditState,
	PluginSkillDiscoveryState,
	PluginStatus,
	PluginToggleRequest,
	PluginValidationResult,
	SkillStatus,
	SkillToggleRequest,
	SkillValidationResult,
} from "./plugin-skill-types.js";
import type { PackageSource, SettingsManager } from "./settings-manager.js";
import { loadSkills } from "./skills.js";

const AUDIT_FILE_NAME = "plugin-skill-audit.jsonl";
const AUDIT_RETENTION_DAYS = 90;

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
}

export class PluginSkillManager {
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly settingsManager: SettingsManager;
	private readonly packageManager: DefaultPackageManager;
	private readonly auditFilePath: string;

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
	}

	async getDiscoveryState(): Promise<PluginSkillDiscoveryState> {
		const resolved = await this.packageManager.resolve();
		const userPlugins = this.buildPluginStatuses(resolved);
		const allowlistedRoots = this.buildAllowlistedRoots(resolved, userPlugins);
		const skills = this.buildSkillStatuses(resolved, allowlistedRoots);
		const audit = this.getAuditState();
		return {
			plugins: userPlugins,
			skills,
			audit,
			allowlistedRoots,
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
			const validation = this.validatePlugin(entry.source, entry.installedPath, counts.total > 0);
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
			const validation = this.validateSkill(item.path, allowlistedRoots);
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

	private validatePlugin(
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

	private validateSkill(path: string, allowlistedRoots: string[]): SkillValidationResult {
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
			retentionDays: AUDIT_RETENTION_DAYS,
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
		const retentionMs = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
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
