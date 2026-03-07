import { MAX_AUDIO_SEGMENT_SIZE_BYTES } from "./audioConstants";

export type UploadedSegments = {
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

export async function createUploadedSegments(
	file: File
): Promise<UploadedSegments> {
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
