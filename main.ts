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
						const extension = fileName.split(".").pop() ?? "webm";
						const audioBlobs: Blob[] = [];
						for (
							let offset = 0;
							offset < file.size;
							offset += MAX_AUDIO_SEGMENT_SIZE_BYTES
						) {
							const chunkEnd = Math.min(
								offset + MAX_AUDIO_SEGMENT_SIZE_BYTES,
								file.size
							);
							audioBlobs.push(file.slice(offset, chunkEnd, file.type));
						}

						if (audioBlobs.length > 1) {
							new Notice(
								`Large upload detected. Splitting into ${audioBlobs.length} segments for transcription.`
							);
						}

						await this.audioHandler.sendAudioData(
							audioBlobs,
							baseFileName,
							extension
						);
					}
				};

				// Programmatically open the file dialog
				fileInput.click();
			},
		});
	}
}
