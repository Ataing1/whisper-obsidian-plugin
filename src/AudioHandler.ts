import axios from "axios";
import Whisper from "main";
import { Notice, MarkdownView } from "obsidian";

export class AudioHandler {
	private plugin: Whisper;

	constructor(plugin: Whisper) {
		this.plugin = plugin;
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

		if (this.plugin.settings.debugMode) {
			const totalSize = blobs.reduce((sum, b) => sum + b.size, 0);
			new Notice(
				`Processing ${blobs.length} segment(s), total size: ${(totalSize / 1024).toFixed(0)} KB`
			);
		}

		const audioFilePaths: string[] = [];
		const transcripts: string[] = [];
		let previousTranscriptTail = "";

		for (let i = 0; i < blobs.length; i++) {
			const blob = blobs[i];
			const segmentSuffix =
				blobs.length > 1 ? `-part${i + 1}` : "";
			const fileName = `${baseFileName}${segmentSuffix}.${extension}`;

			// Save audio segment if setting is enabled
			if (this.plugin.settings.saveAudioFile) {
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

				const text = await this.transcribeSegment(
					blob,
					fileName,
					prompt
				);
				transcripts.push(text);
				previousTranscriptTail = text.slice(-200);
			} catch (err) {
				console.error(`Error transcribing segment ${i + 1}:`, err);
				new Notice(
					`Error transcribing segment ${i + 1}/${blobs.length}: ${err.message}`
				);
				transcripts.push(
					`[Transcription failed for segment ${i + 1}]`
				);
				previousTranscriptTail = "";
			}
		}

		const fullTranscript = transcripts.join(" ");
		await this.insertTranscript(
			fullTranscript,
			audioFilePaths,
			baseFileName
		);
		new Notice("Audio parsed successfully.");
	}

	private buildPrompt(previousTail: string): string {
		const parts: string[] = [];
		if (this.plugin.settings.prompt) {
			parts.push(this.plugin.settings.prompt);
		}
		if (previousTail) {
			parts.push(previousTail);
		}
		return parts.join(" ");
	}

	private async transcribeSegment(
		blob: Blob,
		fileName: string,
		prompt: string
	): Promise<string> {
		const formData = new FormData();
		formData.append("file", blob, fileName);
		formData.append("model", this.plugin.settings.model);
		formData.append("language", this.plugin.settings.language);
		if (prompt) {
			formData.append("prompt", prompt);
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

		return response.data.text;
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
			new Notice("Error saving audio file: " + err.message);
			return null;
		}
	}

	private async insertTranscript(
		text: string,
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
			const audioEmbeds = audioFilePaths
				.map((p) => `![[${p}]]`)
				.join("\n");
			const content = audioEmbeds
				? `${audioEmbeds}\n${text}`
				: text;
			await this.plugin.app.vault.create(noteFilePath, content);
			await this.plugin.app.workspace.openLinkText(
				noteFilePath,
				"",
				true
			);
		} else {
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
