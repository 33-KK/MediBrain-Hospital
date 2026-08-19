import { Injectable, Logger, NotFoundException, StreamableFile } from '@nestjs/common';
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const execFileAsync = promisify(execFile);

export interface TtsOptions {
  /** 合成语音的文本 */
  text: string;
  /** 音色（edge-tts 声音名，默认晓晓） */
  voice?: string;
}

export interface TtsResult {
  /** 音频文件相对路径（可通过 GET /tts/audio/:file 获取） */
  file: string;
  /** 音频时长（秒，若可获取） */
  duration?: number;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly audioDir: string;

  constructor() {
    this.audioDir = join(process.cwd(), 'tts-audio');
    mkdirSync(this.audioDir, { recursive: true });
  }

  /** 文本转语音：合成并直接返回音频内容（避免多副本共享存储问题） */
  async synthesize(params: TtsOptions): Promise<Buffer> {
    const { text, voice } = params;
    if (!text || !text.trim()) {
      throw new NotFoundException('text 不能为空');
    }
    const normalized = text.trim();
    // 文件名 = 文本 hash + 音色，实现内容缓存（同一文本不重复合成）
    const hash = createHash('md5').update(`${voice ?? 'default'}:${normalized}`).digest('hex');
    const filename = `${hash}.mp3`;
    const filepath = join(this.audioDir, filename);

    if (!existsSync(filepath)) {
      const ttsVoice = voice ?? 'zh-CN-XiaoxiaoNeural';
      try {
        await execFileAsync(
          'python',
          ['-m', 'edge_tts', '--voice', ttsVoice, '--text', normalized, '--write-media', filepath],
          { timeout: 60_000, windowsHide: true },
        );
        this.logger.log(`TTS 合成成功: ${filename} (${normalized.slice(0, 30)})`);
      } catch (err) {
        this.logger.error(`TTS 合成失败: ${(err as Error).message}`);
        throw new NotFoundException(`语音合成失败: ${(err as Error).message}`);
      }
    }
    return readFileSync(filepath);
  }

  /** 返回音频文件流 */
  getAudioStream(filename: string): StreamableFile {
    const filepath = join(this.audioDir, filename);
    if (!existsSync(filepath)) {
      throw new NotFoundException('音频文件不存在');
    }
    return new StreamableFile(createReadStream(filepath));
  }
}