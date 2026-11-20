/**
 * Wraps raw 16kHz 16-bit mono signed little-endian PCM buffer into a valid WAV container.
 * Required for speech-to-text APIs like Groq Whisper.
 */
export function pcmToWav(pcmData: Buffer, sampleRate: number = 16000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const header = Buffer.alloc(headerSize);

  // RIFF Chunk Descriptor
  header.write('RIFF', 0); // ChunkID
  header.writeUInt32LE(totalSize - 8, 4); // ChunkSize
  header.write('WAVE', 8); // Format

  // "fmt " Sub-chunk
  header.write('fmt ', 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = Linear PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels (1 = Mono)
  header.writeUInt32LE(sampleRate, 24); // SampleRate (16000)
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample (16)

  // "data" Sub-chunk
  header.write('data', 36); // Subchunk2ID
  header.writeUInt32LE(dataSize, 40); // Subchunk2Size

  return Buffer.concat([header, pcmData]);
}
