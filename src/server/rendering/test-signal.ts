export function createSineWaveWav(options: { durationSeconds: number; frequencyHz?: number; sampleRate?: number; amplitude?: number }) {
  const sampleRate = options.sampleRate ?? 48_000; const sampleCount = Math.round(options.durationSeconds * sampleRate); const amplitude = Math.max(0, Math.min(0.95, options.amplitude ?? 0.12));
  const dataLength = sampleCount * 2; const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataLength, 4); buffer.write("WAVE", 8); buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(dataLength, 40);
  const frequency = options.frequencyHz ?? 440;
  for (let index = 0; index < sampleCount; index += 1) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude * 32767), 44 + index * 2);
  return new Uint8Array(buffer);
}
