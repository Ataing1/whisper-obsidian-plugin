export interface TranscriptionSegment {
	start: number; // seconds
	end: number; // seconds
	text: string;
}

export interface TranscriptionResult {
	text: string;
	segments: TranscriptionSegment[];
	duration: number; // seconds
}
