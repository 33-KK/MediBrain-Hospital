/** Verify complete Layer III frames, including optional ID3 tags. */
export function isCompleteMp3(audio: Buffer): boolean {
  let offset = 0;
  let end = audio.length;
  if (end < 256) return false;
  if (audio.subarray(0, 3).toString('ascii') === 'ID3') {
    if (end < 10 || audio.subarray(6, 10).some((byte) => byte >= 128))
      return false;
    const size =
      audio[6] * 2 ** 21 + audio[7] * 2 ** 14 + audio[8] * 128 + audio[9];
    offset = 10 + size + (audio[5] & 0x10 ? 10 : 0);
  }
  if (audio.subarray(end - 128, end - 125).toString('ascii') === 'TAG')
    end -= 128;
  let frames = 0;
  while (offset + 4 <= end) {
    const header = audio.readUInt32BE(offset);
    if (header >>> 21 !== 0x7ff) return false;
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleIndex = (header >>> 10) & 3;
    if (version === 1 || layer !== 1 || sampleIndex === 3) return false;
    const bitrates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const bitrate = bitrates[bitrateIndex];
    if (!bitrate) return false;
    const sampleRate =
      [44100, 48000, 32000][sampleIndex] /
      (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length =
      Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / sampleRate) +
      ((header >>> 9) & 1);
    if (length < 4 || offset + length > end) return false;
    offset += length;
    frames++;
  }
  return offset === end && frames >= 2;
}
