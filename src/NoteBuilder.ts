import { TranscriptionResult } from "./types";

export interface NoteBuilderParams {
	results: TranscriptionResult[];
	audioFilePaths: string[];
	baseFileName: string;
	enableTimestamps: boolean;
	noteTemplate: "plain" | "structured";
}

function formatTimestamp(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);

	if (hours > 0) {
		return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function formatDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);

	if (hours > 0) {
		return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export class NoteBuilder {
	buildNote(params: NoteBuilderParams): string {
		const { results, audioFilePaths, baseFileName, enableTimestamps, noteTemplate } = params;

		if (noteTemplate === "plain") {
			return this.buildPlainNote(results, audioFilePaths, enableTimestamps);
		}

		return this.buildStructuredNote(results, audioFilePaths, enableTimestamps);
	}

	private buildPlainNote(
		results: TranscriptionResult[],
		audioFilePaths: string[],
		enableTimestamps: boolean
	): string {
		const parts: string[] = [];

		// Audio embeds
		if (audioFilePaths.length > 0) {
			parts.push(audioFilePaths.map((p) => `![[${p}]]`).join("\n"));
		}

		// Transcript
		if (enableTimestamps) {
			parts.push(this.buildTimestampedTranscript(results));
		} else {
			parts.push(results.map((r) => r.text).join(" "));
		}

		return parts.join("\n\n");
	}

	private buildStructuredNote(
		results: TranscriptionResult[],
		audioFilePaths: string[],
		enableTimestamps: boolean
	): string {
		const now = new Date();
		const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

		const parts: string[] = [];

		// Frontmatter
		parts.push(
			[
				"---",
				`date: ${now.toISOString().split("T")[0]}`,
				`duration: "${formatDuration(totalDuration)}"`,
				`tags: [meeting-note]`,
				"---",
			].join("\n")
		);

		// Title
		parts.push(`# Meeting — ${formatDate(now)}`);

		// Audio embeds
		if (audioFilePaths.length > 0) {
			parts.push(audioFilePaths.map((p) => `![[${p}]]`).join("\n"));
		}

		// Transcript
		const transcriptContent = enableTimestamps
			? this.buildTimestampedTranscript(results)
			: results.map((r) => r.text).join(" ");
		parts.push(`## Transcript\n\n${transcriptContent}`);

		// Summary placeholder
		parts.push("## Summary\n\n<!-- AI summary will go here -->");

		// Action items placeholder
		parts.push("## Action Items\n\n- [ ] ");

		return parts.join("\n\n");
	}

	private buildTimestampedTranscript(results: TranscriptionResult[]): string {
		const lines: string[] = [];
		let timeOffset = 0;

		for (const result of results) {
			if (result.segments.length > 0) {
				for (const segment of result.segments) {
					const timestamp = formatTimestamp(segment.start + timeOffset);
					lines.push(`[${timestamp}] ${segment.text.trim()}`);
				}
			} else {
				// Fallback if no segments (plain text response)
				const timestamp = formatTimestamp(timeOffset);
				lines.push(`[${timestamp}] ${result.text.trim()}`);
			}
			timeOffset += result.duration;
		}

		return lines.join("\n\n");
	}
}
