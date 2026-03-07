import axios from "axios";
import Whisper from "main";
import { Notice, MarkdownView } from "obsidian";
import { TranscriptionResult, TranscriptionSegment } from "./types";
import { NoteBuilder } from "./NoteBuilder";

const MAX_TRANSCRIBE_PROMPT_CHARS = 700;

export class AudioHandler {
	private plugin: Whisper;
	private noteBuilder: NoteBuilder;

	constructor(plugin: Whisper) {
		this.plugin = plugin;
		this.noteBuilder = new NoteBuilder();
	}

	async sendAudioData(
		blobs: Blob[],
		baseFileName: string,
		extension: string
	): Promise<void> {
		if (!this.plugin.settings.apiKey) {
			new Notice(
				"API key is missing. Please add your API key in the settings."
			);
			return;
		}

		if (blobs.length === 0) {
			new Notice("No audio data to process.");
			return;
		}
		console.log(
			`[Whisper] sendAudioData start: ${blobs.length} segment(s), extension=${extension}`
		);

		if (this.plugin.settings.debugMode) {
			const totalSize = blobs.reduce((sum, b) => sum + b.size, 0);
			new Notice(
				`Processing ${blobs.length} segment(s), total size: ${(totalSize / 1024).toFixed(0)} KB`
			);
		}

		const audioFilePaths: string[] = [];
		const results: TranscriptionResult[] = [];
		let previousTranscriptTail = "";

		for (let i = 0; i < blobs.length; i++) {
			const blob = blobs[i];
			const segmentSuffix =
				blobs.length > 1 ? `-part${i + 1}` : "";
			const fileName = `${baseFileName}${segmentSuffix}.${extension}`;
			console.log(
				`[Whisper] Processing segment ${i + 1}/${blobs.length}: ${fileName} (${blob.size} bytes)`
			);

			// Save audio segment if setting is enabled
			if (this.plugin.settings.saveAudioFile) {
				console.log(
					`[Whisper] Saving segment ${i + 1}/${blobs.length} to vault: ${fileName}`
				);
				const path = await this.saveAudioSegment(blob, fileName);
				if (path) audioFilePaths.push(path);
			}

			// Build prompt for continuity across segments
			const prompt = this.buildPrompt(previousTranscriptTail);

			try {
				if (this.plugin.settings.debugMode) {
					new Notice(
						`Transcribing segment ${i + 1}/${blobs.length}: ${(blob.size / 1024).toFixed(0)} KB`
					);
				}
				console.log(
					`[Whisper] Calling transcription API for segment ${i + 1}/${blobs.length}`
				);

				const result = await this.transcribeSegment(
					blob,
					fileName,
					prompt
				);
				console.log(
					`[Whisper] Segment ${i + 1}/${blobs.length} transcription complete (${result.text.length} chars).`
				);
				results.push(result);
				previousTranscriptTail = result.text.slice(-200);
			} catch (err) {
				console.error(`Error transcribing segment ${i + 1}:`, err);
				if (axios.isAxiosError(err)) {
					const apiErrorMessage =
						(err.response?.data as { error?: { message?: string } })
							?.error?.message ?? "";
					console.error(
						`[Whisper] Segment ${i + 1}/${blobs.length} failed with status ${err.response?.status}.`,
						err.response?.data
					);
					const noticeMessage = apiErrorMessage
						? `Error transcribing segment ${i + 1}/${blobs.length}: ${apiErrorMessage}`
						: `Error transcribing segment ${i + 1}/${blobs.length}: ${err.message}`;
					new Notice(noticeMessage);
				} else {
					new Notice(
						`Error transcribing segment ${i + 1}/${blobs.length}: ${(err as Error).message}`
					);
				}
				results.push({
					text: `[Transcription failed for segment ${i + 1}]`,
					segments: [],
					duration: 0,
				});
				previousTranscriptTail = "";
			}
		}

		await this.insertTranscript(results, audioFilePaths, baseFileName);
		console.log(
			`[Whisper] Completed sendAudioData: ${blobs.length} segment(s) processed.`
		);
		new Notice("Audio parsed successfully.");
	}

	private buildPrompt(previousTail: string): string {
		const basePrompt = this.plugin.settings.prompt.trim();
		const continuation = previousTail.trim();

		if (!basePrompt && !continuation) {
			return "";
		}

		if (!continuation) {
			return basePrompt.slice(0, MAX_TRANSCRIBE_PROMPT_CHARS);
		}

		if (!basePrompt) {
			return continuation.slice(-MAX_TRANSCRIBE_PROMPT_CHARS);
		}

		const separator = " ";
		const reservedForBase = Math.min(
			basePrompt.length,
			Math.floor(MAX_TRANSCRIBE_PROMPT_CHARS * 0.7)
		);
		const trimmedBase = basePrompt.slice(0, reservedForBase);
		const remainingForContinuation =
			MAX_TRANSCRIBE_PROMPT_CHARS -
			trimmedBase.length -
			separator.length;
		const trimmedContinuation =
			remainingForContinuation > 0
				? continuation.slice(-remainingForContinuation)
				: "";

		return `${trimmedBase}${separator}${trimmedContinuation}`.trim();
	}

	private async transcribeSegment(
		blob: Blob,
		fileName: string,
		prompt: string
	): Promise<TranscriptionResult> {
		const formData = new FormData();
		formData.append("file", blob, fileName);
		formData.append("model", this.plugin.settings.model);
		formData.append("language", this.plugin.settings.language);
		if (prompt) {
			formData.append("prompt", prompt);
		}

		const useTimestamps = this.plugin.settings.enableTimestamps;
		if (useTimestamps) {
			formData.append("response_format", "verbose_json");
			formData.append("timestamp_granularities[]", "segment");
		}

		const response = await axios.post(
			this.plugin.settings.apiUrl,
			formData,
			{
				headers: {
					"Content-Type": "multipart/form-data",
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
				},
			}
		);

		if (useTimestamps) {
			const data = response.data;
			const segments: TranscriptionSegment[] = (data.segments ?? []).map(
				(seg: { start: number; end: number; text: string }) => ({
					start: seg.start,
					end: seg.end,
					text: seg.text,
				})
			);
			return {
				text: data.text ?? "",
				segments,
				duration: data.duration ?? 0,
			};
		}

		// Plain text fallback
		return {
			text: response.data.text,
			segments: [],
			duration: 0,
		};
	}

	private async saveAudioSegment(
		blob: Blob,
		fileName: string
	): Promise<string | null> {
		const audioFilePath = `${
			this.plugin.settings.saveAudioFilePath
				? `${this.plugin.settings.saveAudioFilePath}/`
				: ""
		}${fileName}`;

		try {
			const arrayBuffer = await blob.arrayBuffer();
			await this.plugin.app.vault.adapter.writeBinary(
				audioFilePath,
				arrayBuffer
			);
			new Notice("Audio saved successfully.");
			return audioFilePath;
		} catch (err) {
			console.error("Error saving audio file:", err);
			new Notice("Error saving audio file: " + (err as Error).message);
			return null;
		}
	}

	private async insertTranscript(
		results: TranscriptionResult[],
		audioFilePaths: string[],
		baseFileName: string
	): Promise<void> {
		const noteFilePath = `${
			this.plugin.settings.createNewFileAfterRecordingPath
				? `${this.plugin.settings.createNewFileAfterRecordingPath}/`
				: ""
		}${baseFileName}.md`;

		const activeView =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const shouldCreateNewFile =
			this.plugin.settings.createNewFileAfterRecording || !activeView;

		if (shouldCreateNewFile) {
			const content = this.noteBuilder.buildNote({
				results,
				audioFilePaths,
				baseFileName,
				enableTimestamps: this.plugin.settings.enableTimestamps,
				noteTemplate: this.plugin.settings.noteTemplate,
			});
			await this.plugin.app.vault.create(noteFilePath, content);
			await this.plugin.app.workspace.openLinkText(
				noteFilePath,
				"",
				true
			);
		} else {
			// Insert at cursor — use plain text for inline insertion
			const text = results.map((r) => r.text).join(" ");
			const editor =
				this.plugin.app.workspace.getActiveViewOfType(
					MarkdownView
				)?.editor;
			if (editor) {
				const cursorPosition = editor.getCursor();
				editor.replaceRange(text, cursorPosition);

				const newPosition = {
					line: cursorPosition.line,
					ch: cursorPosition.ch + text.length,
				};
				editor.setCursor(newPosition);
			}
		}
	}
}
