import { Notice } from "obsidian";
import { MAX_AUDIO_SEGMENT_SIZE_BYTES } from "src/audioConstants";

export type AudioCaptureMode = "microphone" | "microphone-and-system";

export interface AudioRecorder {
	startRecording(captureMode?: AudioCaptureMode): Promise<void>;
	pauseRecording(): Promise<void>;
	stopRecording(): Promise<Blob[]>;
}

function getSupportedMimeType(): string | undefined {
	const mimeTypes = ["audio/webm", "audio/ogg", "audio/mp3", "audio/mp4"];

	for (const mimeType of mimeTypes) {
		if (MediaRecorder.isTypeSupported(mimeType)) {
			return mimeType;
		}
	}

	return undefined;
}

export class NativeAudioRecorder implements AudioRecorder {
	private chunks: BlobPart[] = [];
	private recorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private micStream: MediaStream | null = null;
	private systemStream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private mimeType: string | undefined;
	private segments: Blob[] = [];
	private currentChunkSize = 0;
	private segmentTimer: number | null = null;
	private segmentDurationMs = 10 * 60 * 1000; // default 10 minutes
	private onSegmentReady?: (blob: Blob, index: number) => Promise<void>;

	getRecordingState(): "inactive" | "recording" | "paused" | undefined {
		return this.recorder?.state;
	}

	getMimeType(): string | undefined {
		return this.mimeType;
	}

	setSegmentDuration(minutes: number): void {
		this.segmentDurationMs = minutes * 60 * 1000;
	}

	setOnSegmentReady(
		cb: (blob: Blob, index: number) => Promise<void>
	): void {
		this.onSegmentReady = cb;
	}

	async startRecording(
		captureMode: AudioCaptureMode = "microphone"
	): Promise<void> {
		if (!this.stream) {
			try {
				console.log(
					`[Whisper] Starting recording with captureMode=${captureMode}`
				);
				this.stream = await this.initializeStream(captureMode);
				console.log("[Whisper] Stream initialized successfully");
				this.mimeType = getSupportedMimeType();
				console.log(
					`[Whisper] Selected mimeType: ${this.mimeType ?? "none"}`
				);

				if (!this.mimeType) {
					throw new Error("No supported mimeType found");
				}
			} catch (err) {
				new Notice("Error initializing recorder: " + err);
				console.error("Error initializing recorder:", err);
				// Clean up any partially-acquired streams
				this.releaseStream();
				return;
			}
		}

		if (!this.recorder || this.recorder.state === "inactive") {
			this.createNewRecorder();
		}

		this.recorder!.start(100);
		this.startSegmentTimer();
	}

	async pauseRecording(): Promise<void> {
		if (!this.recorder) {
			return;
		}

		if (this.recorder.state === "recording") {
			this.recorder.pause();
		} else if (this.recorder.state === "paused") {
			this.recorder.resume();
		}
	}

	async stopRecording(): Promise<Blob[]> {
		this.clearSegmentTimer();

		return new Promise((resolve) => {
			if (!this.recorder || this.recorder.state === "inactive") {
				if (this.chunks.length > 0) {
					const blob = new Blob(this.chunks, {
						type: this.mimeType,
					});
					this.segments.push(blob);
				}
				this.chunks = [];
				this.currentChunkSize = 0;
				this.releaseStream();

				const result = [...this.segments];
				this.segments = [];
				resolve(result);
			} else {
				this.recorder.addEventListener(
					"stop",
					() => {
						if (this.chunks.length > 0) {
							const blob = new Blob(this.chunks, {
								type: this.mimeType,
							});
							this.segments.push(blob);
						}
						this.chunks = [];
						this.currentChunkSize = 0;
						this.releaseStream();

						const result = [...this.segments];
						this.segments = [];
						resolve(result);
					},
					{ once: true }
				);

				this.recorder.stop();
			}
		});
	}

	private createNewRecorder(): void {
		if (!this.stream || !this.mimeType) return;

		const options = { mimeType: this.mimeType };
		const recorder = new MediaRecorder(this.stream, options);

		this.chunks = [];
		this.currentChunkSize = 0;

		recorder.addEventListener("dataavailable", (e: BlobEvent) => {
			console.log("dataavailable", e.data.size);
			this.chunks.push(e.data);
			this.currentChunkSize += e.data.size;

			// Size-based fallback — safety cap in case time-based hasn't triggered
			if (
				this.currentChunkSize >=
				MAX_AUDIO_SEGMENT_SIZE_BYTES
			) {
				this.cycleRecorder();
			}
		});

		this.recorder = recorder;
	}

	private startSegmentTimer(): void {
		this.clearSegmentTimer();
		this.segmentTimer = window.setTimeout(() => {
			this.cycleRecorder();
		}, this.segmentDurationMs);
	}

	private clearSegmentTimer(): void {
		if (this.segmentTimer !== null) {
			window.clearTimeout(this.segmentTimer);
			this.segmentTimer = null;
		}
	}

	private cycleRecorder(): void {
		if (!this.recorder || this.recorder.state === "inactive") return;

		this.clearSegmentTimer();

		const wasPaused = this.recorder.state === "paused";

		this.recorder.addEventListener(
			"stop",
			() => {
				const segmentBlob = new Blob(this.chunks, {
					type: this.mimeType,
				});
				this.segments.push(segmentBlob);
				const segmentIndex = this.segments.length - 1;
				console.log(
					`Segment ${this.segments.length} created: ${segmentBlob.size} bytes`
				);

				// Flush segment to disk if callback is set
				if (this.onSegmentReady) {
					this.onSegmentReady(segmentBlob, segmentIndex).catch(
						(err) =>
							console.error(
								"Error flushing segment to disk:",
								err
							)
					);
				}

				this.createNewRecorder();
				this.recorder!.start(100);
				this.startSegmentTimer();

				if (wasPaused) {
					this.recorder!.pause();
				}
			},
			{ once: true }
		);

		this.recorder.stop();
	}

	private releaseStream(): void {
		this.clearSegmentTimer();
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}

		if (this.micStream) {
			this.micStream.getTracks().forEach((track) => track.stop());
			this.micStream = null;
		}

		if (this.systemStream) {
			this.systemStream.getTracks().forEach((track) => track.stop());
			this.systemStream = null;
		}

		if (this.stream) {
			this.stream.getTracks().forEach((track) => track.stop());
			this.stream = null;
		}
		this.recorder = null;
	}

	private async initializeStream(
		captureMode: AudioCaptureMode
	): Promise<MediaStream> {
		console.log("[Whisper] Requesting microphone access...");
		this.micStream = await navigator.mediaDevices.getUserMedia({
			audio: true,
		});
		console.log(
			`[Whisper] Microphone stream acquired: ${this.micStream.getAudioTracks().length} audio track(s)`
		);

		if (captureMode === "microphone") {
			return this.micStream;
		}

		new Notice(
			"Capturing system audio. Make sure Obsidian has Screen & System Audio Recording permission in System Settings."
		);
		console.log("[Whisper] Requesting system audio capture...");

		// Try multiple approaches for system audio capture in Electron
		this.systemStream = await this.getSystemAudioStream();

		const hasSystemAudioTrack = this.systemStream
			.getAudioTracks()
			.some((track) => track.readyState === "live");
		if (!hasSystemAudioTrack) {
			throw new Error(
				"No system audio track detected. Enable audio sharing in the capture picker and try again."
			);
		}

		// Log track details for debugging
		const micTrack = this.micStream.getAudioTracks()[0];
		const sysTrack = this.systemStream.getAudioTracks()[0];
		console.log(
			`[Whisper] Mic track: label="${micTrack.label}", readyState=${micTrack.readyState}, settings=`,
			micTrack.getSettings()
		);
		console.log(
			`[Whisper] System track: label="${sysTrack.label}", readyState=${sysTrack.readyState}, settings=`,
			sysTrack.getSettings()
		);

		// Mix mic + system audio via AudioContext.
		// Use sinkId: none to prevent AudioContext from opening an output device,
		// which conflicts with chromeMediaSource loopback on macOS.
		this.audioContext = new AudioContext({
			sinkId: { type: "none" },
		} as any);
		const mixedDestination =
			this.audioContext.createMediaStreamDestination();

		const micSource =
			this.audioContext.createMediaStreamSource(this.micStream);
		micSource.connect(mixedDestination);
		console.log("[Whisper] Mic source connected to mix");

		const sysSource =
			this.audioContext.createMediaStreamSource(this.systemStream);
		sysSource.connect(mixedDestination);
		console.log("[Whisper] System source connected to mix");

		console.log(
			`[Whisper] Mixed stream: ${mixedDestination.stream.getAudioTracks().length} audio track(s)`
		);

		return mixedDestination.stream;
	}

	private async getSystemAudioStream(): Promise<MediaStream> {
		// Approach 1: Electron chromeMediaSource via getUserMedia
		// This works in Electron without needing setDisplayMediaRequestHandler
		try {
			console.log(
				"[Whisper] Trying Electron chromeMediaSource approach..."
			);
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					mandatory: {
						chromeMediaSource: "desktop",
					},
				} as any,
				video: {
					mandatory: {
						chromeMediaSource: "desktop",
					},
				} as any,
			});
			// We only need the audio track — drop video tracks
			stream
				.getVideoTracks()
				.forEach((track) => track.stop());
			console.log(
				`[Whisper] chromeMediaSource succeeded: ${stream.getAudioTracks().length} audio track(s)`
			);
			return stream;
		} catch (err) {
			console.log(
				"[Whisper] chromeMediaSource failed:",
				(err as Error).message
			);
		}

		// Approach 2: getDisplayMedia (standard Web API)
		try {
			console.log("[Whisper] Trying getDisplayMedia approach...");
			const stream =
				await navigator.mediaDevices.getDisplayMedia({
					audio: true,
					video: true,
				});
			console.log(
				`[Whisper] getDisplayMedia succeeded: ${stream.getAudioTracks().length} audio, ${stream.getVideoTracks().length} video track(s)`
			);
			// Drop video tracks — we only need audio
			stream
				.getVideoTracks()
				.forEach((track) => track.stop());
			return stream;
		} catch (err) {
			console.log(
				"[Whisper] getDisplayMedia failed:",
				(err as Error).message
			);
		}

		// Approach 3: getDisplayMedia audio-only (some Electron versions)
		try {
			console.log(
				"[Whisper] Trying getDisplayMedia audio-only approach..."
			);
			const stream =
				await navigator.mediaDevices.getDisplayMedia({
					audio: true,
					video: false,
				} as any);
			console.log(
				`[Whisper] getDisplayMedia audio-only succeeded: ${stream.getAudioTracks().length} audio track(s)`
			);
			return stream;
		} catch (err) {
			console.log(
				"[Whisper] getDisplayMedia audio-only failed:",
				(err as Error).message
			);
		}

		throw new Error(
			"System audio capture is not supported in this version of Obsidian. " +
				"Try updating Obsidian, or use a virtual audio device (like BlackHole on macOS) " +
				"and select it as your microphone input."
		);
	}
}
