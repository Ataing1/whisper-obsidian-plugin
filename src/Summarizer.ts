/**
 * Summarizer stub for Phase 4: AI-powered meeting summary generation.
 *
 * Future implementation will pipe transcripts to an LLM to extract:
 * - Summary (3-5 sentences)
 * - Key decisions made
 * - Action items with owners
 * - Open questions
 *
 * Will support meeting type templates (1:1, standup, client call)
 * with different prompts for each type.
 */

export interface SummaryResult {
	summary: string;
	decisions: string[];
	actionItems: string[];
	openQuestions: string[];
}

export class Summarizer {
	async summarize(
		_transcript: string,
		_meetingType?: string
	): Promise<SummaryResult> {
		throw new Error(
			"Summarizer not yet implemented. This is a Phase 4 feature."
		);
	}
}
