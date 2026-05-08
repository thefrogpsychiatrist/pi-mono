import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Select, type SelectOption } from "@mariozechner/mini-lit/dist/Select.js";
import type { ThinkingLevel, VisibleReasoningLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { Brain, Command, Info, Loader2, Paperclip, Send, Sparkles, Square } from "lucide";
import { type Attachment, loadAttachment } from "../utils/attachment-utils.js";
import { i18n } from "../utils/i18n.js";
import "./AttachmentTile.js";
import {
	filterSlashCommands,
	SLASH_COMMAND_GROUP_LABELS,
	type SlashCommand,
	type SlashCommandSelection,
} from "./slash-commands.js";

@customElement("message-editor")
export class MessageEditor extends LitElement {
	private _value = "";
	private textareaRef = createRef<HTMLTextAreaElement>();

	@property()
	get value() {
		return this._value;
	}

	set value(val: string) {
		const oldValue = this._value;
		this._value = val;
		this.requestUpdate("value", oldValue);
	}

	@property() isStreaming = false;
	@property() currentModel?: Model<any>;
	@property() thinkingLevel: ThinkingLevel = "off";
	@property() enterToSend = true;
	@property() slashCommandsEnabled = true;
	@property() promptHistoryEnabled = true;
	@property() draftAutosaveEnabled = true;
	@property() contextInspectorEnabled = true;
	@property() promptHistory: string[] = [];
	@property() slashCommands: SlashCommand[] = [];
	@property() showAttachmentButton = true;
	@property() showModelSelector = true;
	@property() showThinkingSelector = true;
	@property() onInput?: (value: string) => void;
	@property() onSend?: (input: string, attachments: Attachment[]) => void;
	@property() onAbort?: () => void;
	@property() onModelSelect?: () => void;
	@property() onThinkingChange?: (level: VisibleReasoningLevel) => void;
	@property() onSlashCommand?: (selection: SlashCommandSelection) => void;
	@property() onDraftChange?: (value: string) => void;
	@property() onFilesChange?: (files: Attachment[]) => void;
	@property() attachments: Attachment[] = [];
	@property() maxFiles = 10;
	@property() maxFileSize = 20 * 1024 * 1024; // 20MB
	@property() acceptedTypes =
		"image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml";

	@state() processingFiles = false;
	@state() isDragging = false;
	@state() private slashMenuOpen = false;
	@state() private slashQuery = "";
	@state() private slashSelectionIndex = 0;
	@state() private promptHistoryIndex = -1;
	private fileInputRef = createRef<HTMLInputElement>();

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	private handleTextareaInput = (e: Event) => {
		const textarea = e.target as HTMLTextAreaElement;
		this.value = textarea.value;
		this.onInput?.(this.value);
		if (this.draftAutosaveEnabled) this.onDraftChange?.(this.value);
		this.updateSlashState(textarea.selectionStart ?? this.value.length);
	};

	private handleKeyDown = (e: KeyboardEvent) => {
		// Ignore key events during IME composition (e.g. CJK input)
		if (e.isComposing || e.key === "Process") return;

		if (this.slashMenuOpen && this.handleSlashKeyDown(e)) {
			return;
		}

		if (this.promptHistoryEnabled && this.handlePromptHistoryKeyDown(e)) {
			return;
		}

		if (e.key === "Enter" && this.enterToSend && !e.shiftKey) {
			e.preventDefault();
			if (!this.isStreaming && !this.processingFiles && (this.value.trim() || this.attachments.length > 0)) {
				this.handleSend();
			}
		} else if (e.key === "Escape" && this.isStreaming) {
			e.preventDefault();
			this.onAbort?.();
		}
	};

	private handlePaste = async (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;

		const imageFiles: File[] = [];

		// Check for image items in clipboard
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					imageFiles.push(file);
				}
			}
		}

		// If we found images, process them
		if (imageFiles.length > 0) {
			e.preventDefault(); // Prevent default paste behavior

			if (imageFiles.length + this.attachments.length > this.maxFiles) {
				alert(`Maximum ${this.maxFiles} files allowed`);
				return;
			}

			this.processingFiles = true;
			const newAttachments: Attachment[] = [];

			for (const file of imageFiles) {
				try {
					if (file.size > this.maxFileSize) {
						alert(`Image exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
						continue;
					}

					const attachment = await loadAttachment(file);
					newAttachments.push(attachment);
				} catch (error) {
					console.error("Error processing pasted image:", error);
					alert(`Failed to process pasted image: ${String(error)}`);
				}
			}

			this.attachments = [...this.attachments, ...newAttachments];
			this.onFilesChange?.(this.attachments);
			this.processingFiles = false;
		}
	};

	private handleSend = () => {
		this.slashMenuOpen = false;
		this.promptHistoryIndex = -1;
		this.onSend?.(this.value, this.attachments);
	};

	private updateSlashState(cursorPosition: number): void {
		if (!this.slashCommandsEnabled || this.value.length === 0) {
			this.slashMenuOpen = false;
			this.slashQuery = "";
			return;
		}
		const beforeCursor = this.value.slice(0, cursorPosition);
		const match = beforeCursor.match(/(?:^|\n)\/([^\s]*)$/);
		this.slashMenuOpen = Boolean(match);
		this.slashQuery = match?.[1] ?? "";
		this.slashSelectionIndex = 0;
	}

	private getFilteredSlashCommands(): SlashCommand[] {
		return filterSlashCommands(this.slashCommands, this.slashQuery);
	}

	private handleSlashKeyDown(e: KeyboardEvent): boolean {
		const commands = this.getFilteredSlashCommands();
		if (e.key === "Escape") {
			e.preventDefault();
			this.slashMenuOpen = false;
			return true;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			this.slashSelectionIndex = commands.length ? (this.slashSelectionIndex + 1) % commands.length : 0;
			return true;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			this.slashSelectionIndex = commands.length
				? (this.slashSelectionIndex - 1 + commands.length) % commands.length
				: 0;
			return true;
		}
		if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault();
			const command = commands[this.slashSelectionIndex];
			if (command) this.selectSlashCommand(command);
			return true;
		}
		return false;
	}

	private handlePromptHistoryKeyDown(e: KeyboardEvent): boolean {
		if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || this.value.trim()) return false;
		const history = this.promptHistory.filter((entry) => entry.trim().length > 0);
		if (history.length === 0) return false;
		e.preventDefault();
		if (e.key === "ArrowUp") {
			this.promptHistoryIndex =
				this.promptHistoryIndex < 0 ? history.length - 1 : Math.max(0, this.promptHistoryIndex - 1);
		} else {
			this.promptHistoryIndex =
				this.promptHistoryIndex < 0 ? 0 : Math.min(history.length - 1, this.promptHistoryIndex + 1);
		}
		this.value = history[this.promptHistoryIndex] ?? "";
		this.onInput?.(this.value);
		if (this.draftAutosaveEnabled) this.onDraftChange?.(this.value);
		return true;
	}

	private selectSlashCommand(command: SlashCommand): void {
		if (command.disabled) return;
		this.slashMenuOpen = false;
		const queryPattern = new RegExp(`(^|\\n)/${this.escapeRegExp(this.slashQuery)}$`);
		if (command.mode === "insert") {
			const insertText = command.insertText ?? `${command.command} `;
			this.value = this.value.replace(queryPattern, `$1${insertText}`);
			this.onInput?.(this.value);
			if (this.draftAutosaveEnabled) this.onDraftChange?.(this.value);
			requestAnimationFrame(() => this.textareaRef.value?.focus());
			return;
		}
		this.value = this.value.replace(queryPattern, "$1");
		this.onInput?.(this.value);
		if (this.draftAutosaveEnabled) this.onDraftChange?.(this.value);
		this.onSlashCommand?.({ command, query: this.slashQuery });
		requestAnimationFrame(() => this.textareaRef.value?.focus());
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private handleAttachmentClick = () => {
		this.fileInputRef.value?.click();
	};

	private async handleFilesSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		if (files.length === 0) return;

		if (files.length + this.attachments.length > this.maxFiles) {
			alert(`Maximum ${this.maxFiles} files allowed`);
			input.value = "";
			return;
		}

		this.processingFiles = true;
		const newAttachments: Attachment[] = [];

		for (const file of files) {
			try {
				if (file.size > this.maxFileSize) {
					alert(`${file.name} exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
					continue;
				}

				const attachment = await loadAttachment(file);
				newAttachments.push(attachment);
			} catch (error) {
				console.error(`Error processing ${file.name}:`, error);
				alert(`Failed to process ${file.name}: ${String(error)}`);
			}
		}

		this.attachments = [...this.attachments, ...newAttachments];
		this.onFilesChange?.(this.attachments);
		this.processingFiles = false;
		input.value = ""; // Reset input
	}

	private removeFile(fileId: string) {
		this.attachments = this.attachments.filter((f) => f.id !== fileId);
		this.onFilesChange?.(this.attachments);
	}

	private handleDragOver = (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (!this.isDragging) {
			this.isDragging = true;
		}
	};

	private handleDragLeave = (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Only set isDragging to false if we're leaving the entire component
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX;
		const y = e.clientY;
		if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
			this.isDragging = false;
		}
	};

	private handleDrop = async (e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		this.isDragging = false;

		const files = Array.from(e.dataTransfer?.files || []);
		if (files.length === 0) return;

		if (files.length + this.attachments.length > this.maxFiles) {
			alert(`Maximum ${this.maxFiles} files allowed`);
			return;
		}

		this.processingFiles = true;
		const newAttachments: Attachment[] = [];

		for (const file of files) {
			try {
				if (file.size > this.maxFileSize) {
					alert(`${file.name} exceeds maximum size of ${Math.round(this.maxFileSize / 1024 / 1024)}MB`);
					continue;
				}

				const attachment = await loadAttachment(file);
				newAttachments.push(attachment);
			} catch (error) {
				console.error(`Error processing ${file.name}:`, error);
				alert(`Failed to process ${file.name}: ${String(error)}`);
			}
		}

		this.attachments = [...this.attachments, ...newAttachments];
		this.onFilesChange?.(this.attachments);
		this.processingFiles = false;
	};

	override firstUpdated() {
		const textarea = this.textareaRef.value;
		if (textarea) {
			textarea.focus();
		}
	}

	override render() {
		// Check if current model supports thinking/reasoning
		const model = this.currentModel;
		const supportsThinking = model?.reasoning === true; // Models with reasoning:true support thinking

		const visibleThinkingLevel = this.thinkingLevel === "minimal" ? "low" : this.thinkingLevel;
		return html`
			<div
				class="bg-card rounded-xl border shadow-sm relative ${this.isDragging ? "border-primary border-2 bg-primary/5" : "border-border"}"
				@dragover=${this.handleDragOver}
				@dragleave=${this.handleDragLeave}
				@drop=${this.handleDrop}
			>
				<!-- Drag overlay -->
				${
					this.isDragging
						? html`
					<div class="absolute inset-0 bg-primary/10 rounded-xl pointer-events-none z-10 flex items-center justify-center">
						<div class="text-primary font-medium">${i18n("Drop files here")}</div>
					</div>
				`
						: ""
				}

				<!-- Attachments -->
				${
					this.attachments.length > 0
						? html`
							<div class="px-3 sm:px-4 pt-3 pb-2 flex flex-wrap gap-2">
								${this.attachments.map(
									(attachment) => html`
										<attachment-tile
											.attachment=${attachment}
											.showDelete=${true}
											.onDelete=${() => this.removeFile(attachment.id)}
										></attachment-tile>
									`,
								)}
							</div>
						`
						: ""
				}

				<textarea
					class="w-full bg-transparent px-3 sm:px-4 py-3 text-[15px] sm:text-base text-foreground placeholder-muted-foreground outline-none resize-none overflow-y-auto"
					placeholder=${i18n("Type a message...")}
					rows="1"
					style="max-height: 220px; field-sizing: content; min-height: 1lh; height: auto;"
					.value=${this.value}
					@input=${this.handleTextareaInput}
					@keydown=${this.handleKeyDown}
					@paste=${this.handlePaste}
					${ref(this.textareaRef)}
				></textarea>

				${this.renderSlashMenu()}
				${this.renderContextInspector()}

				<!-- Hidden file input -->
				<input
					type="file"
					${ref(this.fileInputRef)}
					@change=${this.handleFilesSelected}
					accept=${this.acceptedTypes}
					multiple
					style="display: none;"
				/>

				<!-- Button Row -->
				<div class="px-2 pb-2 flex items-center justify-between">
					<!-- Left side - attachment and thinking selector -->
					<div class="flex gap-2 items-center">
						${
							this.showAttachmentButton
								? this.processingFiles
									? html`
										<div class="h-10 w-10 sm:h-8 sm:w-8 flex items-center justify-center">
											${icon(Loader2, "sm", "animate-spin text-muted-foreground")}
										</div>
									`
									: html`
										${Button({
											variant: "ghost",
											size: "icon",
											className: "h-10 w-10 sm:h-8 sm:w-8",
											onClick: this.handleAttachmentClick,
											children: icon(Paperclip, "sm"),
										})}
									`
								: ""
						}
						${
							supportsThinking && this.showThinkingSelector
								? html`
									${Select({
										value: visibleThinkingLevel,
										placeholder: i18n("Off"),
										options: [
											{ value: "off", label: i18n("Off"), icon: icon(Brain, "sm") },
											{ value: "low", label: i18n("Low"), icon: icon(Brain, "sm") },
											{ value: "medium", label: i18n("Medium"), icon: icon(Brain, "sm") },
											{ value: "high", label: i18n("High"), icon: icon(Brain, "sm") },
											{ value: "xhigh", label: "Extra High", icon: icon(Brain, "sm") },
										] as SelectOption[],
										onChange: (value: string) => {
											const level = value as VisibleReasoningLevel;
											this.thinkingLevel = level;
											this.onThinkingChange?.(level);
										},
										width: "128px",
										size: "sm",
										variant: "ghost",
										fitContent: true,
									})}
								`
								: ""
						}
					</div>

					<!-- Model selector and send on the right -->
					<div class="flex gap-2 items-center">
						${
							this.showModelSelector && this.currentModel
								? html`
									${Button({
										variant: "ghost",
										size: "sm",
										onClick: () => {
											// Focus textarea before opening model selector so focus returns there
											this.textareaRef.value?.focus();
											// Wait for next frame to ensure focus takes effect before dialog captures it
											requestAnimationFrame(() => {
												this.onModelSelect?.();
											});
										},
										children: html`
											${icon(Sparkles, "sm")}
											<span class="ml-1">${this.currentModel.id}</span>
										`,
										className: "h-10 sm:h-8 text-xs truncate px-3 sm:px-2",
									})}
								`
								: ""
						}
						${
							this.isStreaming
								? html`
									${Button({
										variant: "ghost",
										size: "icon",
										onClick: this.onAbort,
										children: icon(Square, "sm"),
										className: "h-10 w-10 sm:h-8 sm:w-8",
									})}
								`
								: html`
									${Button({
										variant: "ghost",
										size: "icon",
										onClick: this.handleSend,
										disabled: (!this.value.trim() && this.attachments.length === 0) || this.processingFiles,
										children: html`<div style="transform: rotate(-45deg)">${icon(Send, "sm")}</div>`,
										className: "h-10 w-10 sm:h-8 sm:w-8",
									})}
								`
						}
					</div>
				</div>
			</div>
		`;
	}

	private renderContextInspector() {
		if (!this.contextInspectorEnabled) return html``;
		const textTokens = Math.ceil(this.value.length / 4);
		const attachmentTokens = this.attachments.length * 256;
		const estimatedTokens = textTokens + attachmentTokens;
		return html`
			<div class="px-3 sm:px-4 pb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
				<span class="inline-flex items-center gap-1">${icon(Info, "sm")} Context</span>
				<span>${estimatedTokens} est. tokens</span>
				<span>${this.attachments.length} files</span>
				${this.slashCommandsEnabled ? html`<span>${icon(Command, "sm")} / for commands</span>` : ""}
			</div>
		`;
	}

	private renderSlashMenu() {
		if (!this.slashMenuOpen || !this.slashCommandsEnabled) return html``;
		const commands = this.getFilteredSlashCommands();
		return html`
			<div class="absolute left-2 right-2 bottom-[4.75rem] z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
				${
					commands.length === 0
						? html`<div class="px-3 py-3 text-xs text-muted-foreground">No commands found</div>`
						: commands.map((command, index) => {
								const selected = index === this.slashSelectionIndex;
								return html`
									<button
										class="w-full text-left px-3 py-2 border-b border-border/60 last:border-b-0 ${
											selected ? "bg-secondary text-foreground" : "hover:bg-secondary/60 text-foreground"
										} ${command.disabled ? "opacity-50 cursor-not-allowed" : ""}"
										@click=${() => this.selectSlashCommand(command)}
									>
										<div class="flex items-center justify-between gap-3">
											<div class="min-w-0">
												<div class="text-sm font-medium truncate">${command.command} · ${command.label}</div>
												<div class="text-xs text-muted-foreground truncate">${command.description}</div>
											</div>
											<div class="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
												${SLASH_COMMAND_GROUP_LABELS[command.group]}
											</div>
										</div>
									</button>
								`;
							})
				}
			</div>
		`;
	}
}
