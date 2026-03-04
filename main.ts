import { Notice, Plugin } from "obsidian";
import { Timer } from "src/Timer";
import { Controls } from "src/Controls";
import { AudioHandler } from "src/AudioHandler";
import { WhisperSettingsTab } from "src/WhisperSettingsTab";
import { SettingsManager, WhisperSettings } from "src/SettingsManager";
import { NativeAudioRecorder } from "src/AudioRecorder";
import { RecordingStatus, StatusBar } from "src/StatusBar";
import { MAX_AUDIO_SEGMENT_SIZE_BYTES } from "src/audioConstants";
import { getBaseFileName } from "src/utils";

type UploadedSegments = {
	blobs: Blob[];
	extension: string;
};

function writeWavHeader(
	view: DataView,
	dataLength: number,
	sampleRate: number,
	channelCount: number
): void {
	const writeAscii = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) {
			view.setUint8(offset + i, value.charCodeAt(i));
		}
	};

	const bitsPerSample = 16;
	const byteRate = sampleRate * channelCount * (bitsPerSample / 8);
	const blockAlign = channelCount * (bitsPerSample / 8);

	writeAscii(0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	writeAscii(8, "WAVE");
	writeAscii(12, "fmt ");
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeAscii(36, "data");
	view.setUint32(40, dataLength, true);
}

function audioBufferToWavChunk(
	audioBuffer: AudioBuffer,
	startFrame: number,
	endFrame: number
): Blob {
	const channelCount = audioBuffer.numberOfChannels;
	const sampleRate = audioBuffer.sampleRate;
	const frameCount = endFrame - startFrame;
	const bytesPerSample = 2; // 16-bit PCM
	const dataLength = frameCount * channelCount * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(buffer);

	writeWavHeader(view, dataLength, sampleRate, channelCount);

	let offset = 44;
	for (let frame = startFrame; frame < endFrame; frame++) {
		for (let channel = 0; channel < channelCount; channel++) {
			const sample = audioBuffer.getChannelData(channel)[frame];
			const clamped = Math.max(-1, Math.min(1, sample));
			const int16 =
				clamped < 0
					? Math.round(clamped * 0x8000)
					: Math.round(clamped * 0x7fff);
			view.setInt16(offset, int16, true);
			offset += bytesPerSample;
		}
	}

	return new Blob([buffer], { type: "audio/wav" });
}

async function createUploadedSegments(file: File): Promise<UploadedSegments> {
	if (file.size <= MAX_AUDIO_SEGMENT_SIZE_BYTES) {
		console.log(
			`[Whisper] Upload is within single-segment limit (${file.size} bytes).`
		);
		const extension = file.name.split(".").pop() ?? "webm";
		return {
			blobs: [file.slice(0, file.size, file.type)],
			extension,
		};
	}

	const context = new AudioContext();
	try {
		console.log(
			`[Whisper] Large upload detected (${file.size} bytes). Decoding for safe chunking.`
		);
		const sourceBuffer = await file.arrayBuffer();
		const decoded = await context.decodeAudioData(sourceBuffer.slice(0));
		const bytesPerFrame = decoded.numberOfChannels * 2; // 16-bit PCM
		const maxFramesPerSegment = Math.max(
			1,
			Math.floor((MAX_AUDIO_SEGMENT_SIZE_BYTES - 44) / bytesPerFrame)
		);
		const blobs: Blob[] = [];

		for (
			let startFrame = 0;
			startFrame < decoded.length;
			startFrame += maxFramesPerSegment
		) {
			const endFrame = Math.min(
				startFrame + maxFramesPerSegment,
				decoded.length
			);
			blobs.push(audioBufferToWavChunk(decoded, startFrame, endFrame));
		}
		console.log(
			`[Whisper] Split upload into ${blobs.length} WAV segment(s).`
		);

		return {
			blobs,
			extension: "wav",
		};
	} finally {
		await context.close();
	}
}

export default class Whisper extends Plugin {
	settings: WhisperSettings;
	settingsManager: SettingsManager;
	timer: Timer;
	recorder: NativeAudioRecorder;
	audioHandler: AudioHandler;
	controls: Controls | null = null;
	statusBar: StatusBar;

	async onload() {
		this.settingsManager = new SettingsManager(this);
		this.settings = await this.settingsManager.loadSettings();

		this.addRibbonIcon("activity", "Open recording controls", (evt) => {
			if (!this.controls) {
				this.controls = new Controls(this);
			}
			this.controls.open();
		});

		this.addSettingTab(new WhisperSettingsTab(this.app, this));

		this.timer = new Timer();
		this.audioHandler = new AudioHandler(this);
		this.recorder = new NativeAudioRecorder();

		this.statusBar = new StatusBar(this);

		this.addCommands();
	}

	onunload() {
		if (this.controls) {
			this.controls.close();
		}

		this.statusBar.remove();
	}

	addCommands() {
		this.addCommand({
			id: "start-stop-recording",
			name: "Start/stop recording",
			callback: async () => {
				if (this.statusBar.status !== RecordingStatus.Recording) {
					this.statusBar.updateStatus(RecordingStatus.Recording);
					await this.recorder.startRecording();
				} else {
					this.statusBar.updateStatus(RecordingStatus.Processing);
					const audioBlobs = await this.recorder.stopRecording();
					const extension = this.recorder
						.getMimeType()
						?.split("/")[1] ?? "webm";
					const baseFileName = new Date()
						.toISOString()
						.replace(/[:.]/g, "-");
					await this.audioHandler.sendAudioData(audioBlobs, baseFileName, extension);
					this.statusBar.updateStatus(RecordingStatus.Idle);
				}
			},
			hotkeys: [
				{
					modifiers: ["Alt"],
					key: "Q",
				},
			],
		});

		this.addCommand({
			id: "upload-audio-file",
			name: "Upload audio file",
			callback: () => {
				// Create an input element for file selection
				const fileInput = document.createElement("input");
				fileInput.type = "file";
				fileInput.accept = "audio/*"; // Accept only audio files

				// Handle file selection
				fileInput.onchange = async (event) => {
					const files = (event.target as HTMLInputElement).files;
					if (files && files.length > 0) {
						const file = files[0];
						const fileName = file.name;
						const baseFileName = getBaseFileName(fileName);
						console.log(
							`[Whisper] Selected upload "${fileName}" (${file.size} bytes).`
						);
						let uploadedSegments: UploadedSegments;
						try {
							uploadedSegments = await createUploadedSegments(file);
						} catch (err) {
							console.error("Error preparing uploaded audio:", err);
							new Notice(
								"Unable to chunk this audio file. Try uploading a smaller file or a WAV/MP3/M4A file."
							);
							return;
						}
						console.log(
							`[Whisper] Prepared ${uploadedSegments.blobs.length} segment(s) for transcription.`
						);

						if (uploadedSegments.blobs.length > 1) {
							new Notice(
								`Large upload detected. Splitting into ${uploadedSegments.blobs.length} segments for transcription.`
							);
						}

						console.log(
							`[Whisper] Sending ${uploadedSegments.blobs.length} segment(s) to AudioHandler.`
						);
						await this.audioHandler.sendAudioData(
							uploadedSegments.blobs,
							baseFileName,
							uploadedSegments.extension
						);
					}
				};

				// Programmatically open the file dialog
				fileInput.click();
			},
		});
	}
}
