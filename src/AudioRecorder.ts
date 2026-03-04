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
	private mixedDestination: MediaStreamAudioDestinationNode | null = null;
	private mimeType: string | undefined;
	private segments: Blob[] = [];
	private currentChunkSize = 0;

	getRecordingState(): "inactive" | "recording" | "paused" | undefined {
		return this.recorder?.state;
	}

	getMimeType(): string | undefined {
		return this.mimeType;
	}

	async startRecording(captureMode: AudioCaptureMode = "microphone"): Promise<void> {
		if (!this.stream) {
			try {
				this.stream = await this.initializeStream(captureMode);
				this.mimeType = getSupportedMimeType();

				if (!this.mimeType) {
					throw new Error("No supported mimeType found");
				}
			} catch (err) {
				new Notice("Error initializing recorder: " + err);
				console.error("Error initializing recorder:", err);
				return;
			}
		}

		if (!this.recorder || this.recorder.state === "inactive") {
			this.createNewRecorder();
		}

		this.recorder!.start(100);
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

			if (
				this.currentChunkSize >=
				MAX_AUDIO_SEGMENT_SIZE_BYTES
			) {
				this.cycleRecorder();
			}
		});

		this.recorder = recorder;
	}

	private cycleRecorder(): void {
		if (!this.recorder || this.recorder.state === "inactive") return;

		const wasPaused = this.recorder.state === "paused";

		this.recorder.addEventListener(
			"stop",
			() => {
				const segmentBlob = new Blob(this.chunks, {
					type: this.mimeType,
				});
				this.segments.push(segmentBlob);
				console.log(
					`Segment ${this.segments.length} created: ${segmentBlob.size} bytes`
				);

				this.createNewRecorder();
				this.recorder!.start(100);

				if (wasPaused) {
					this.recorder!.pause();
				}
			},
			{ once: true }
		);

		this.recorder.stop();
	}

	private releaseStream(): void {
		this.mixedDestination = null;
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
		this.micStream = await navigator.mediaDevices.getUserMedia({
			audio: true,
		});

		if (captureMode === "microphone") {
			return this.micStream;
		}

		new Notice(
			"Select a screen/window and enable system audio sharing to capture meeting audio."
		);
		this.systemStream = await navigator.mediaDevices.getDisplayMedia({
			audio: true,
			video: true,
		});

		const hasSystemAudioTrack = this.systemStream
			.getAudioTracks()
			.some((track) => track.readyState === "live");
		if (!hasSystemAudioTrack) {
			throw new Error(
				"No system audio track detected. Enable audio sharing in the capture picker and try again."
			);
		}

		this.audioContext = new AudioContext();
		this.mixedDestination = this.audioContext.createMediaStreamDestination();

		const addStreamToMix = (stream: MediaStream) => {
			const source = this.audioContext!.createMediaStreamSource(stream);
			source.connect(this.mixedDestination!);
		};

		addStreamToMix(this.micStream);
		addStreamToMix(this.systemStream);

		return this.mixedDestination.stream;
	}
}
