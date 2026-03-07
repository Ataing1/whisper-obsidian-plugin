import { Notice, Plugin } from "obsidian";
import { Timer } from "src/Timer";
import { Controls } from "src/Controls";
import { AudioHandler } from "src/AudioHandler";
import { WhisperSettingsTab } from "src/WhisperSettingsTab";
import { SettingsManager, WhisperSettings } from "src/SettingsManager";
import { NativeAudioRecorder } from "src/AudioRecorder";
import { RecordingStatus, StatusBar } from "src/StatusBar";
import { createUploadedSegments } from "src/wavUtils";
import { getBaseFileName } from "src/utils";

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

		// Configure recorder with settings
		this.recorder.setSegmentDuration(
			this.settings.segmentDurationMinutes
		);

		// Wire up segment flush to disk
		if (this.settings.saveAudioFile) {
			this.recorder.setOnSegmentReady(async (blob, index) => {
				const baseFileName = new Date()
					.toISOString()
					.replace(/[:.]/g, "-");
				const extension =
					this.recorder.getMimeType()?.split("/")[1] ?? "webm";
				const fileName = `${baseFileName}-part${index + 1}.${extension}`;
				const audioFilePath = this.settings.saveAudioFilePath
					? `${this.settings.saveAudioFilePath}/${fileName}`
					: fileName;

				try {
					const arrayBuffer = await blob.arrayBuffer();
					await this.app.vault.adapter.writeBinary(
						audioFilePath,
						arrayBuffer
					);
					console.log(
						`[Whisper] Flushed segment ${index + 1} to disk: ${audioFilePath}`
					);
				} catch (err) {
					console.error(
						`[Whisper] Error flushing segment ${index + 1}:`,
						err
					);
				}
			});
		}

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
					// Update segment duration from settings before recording
					this.recorder.setSegmentDuration(
						this.settings.segmentDurationMinutes
					);

					await this.recorder.startRecording(
						this.settings.captureMode
					);
					if (this.recorder.getRecordingState() === "recording") {
						this.statusBar.updateStatus(RecordingStatus.Recording);
					} else {
						this.statusBar.updateStatus(RecordingStatus.Idle);
						new Notice(
							"Recording did not start. Check microphone/system audio permissions and try again."
						);
					}
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
						let uploadedSegments;
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
