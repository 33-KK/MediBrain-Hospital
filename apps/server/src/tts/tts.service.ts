import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'fs';
import { lstat, readdir, readFile, rename, unlink, utimes } from 'fs/promises';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import { isCompleteMp3 } from './mp3-validation';

const execFileAsync = promisify(execFile);
const AUDIO_NAME = /^[a-f0-9]{32}\.mp3$/;
const TEMP_NAME = /^\.[a-f0-9]{32}\.[a-f0-9-]{36}\.part$/;

export interface TtsOptions {
  text: string;
  voice?: string;
}

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly logger = new Logger(TtsService.name);
  private readonly audioDir: string;
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly maxConcurrent: number;
  private readonly maxAudioBytes = 8 * 1024 * 1024;
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private readonly activeTemps = new Set<string>();
  private active = 0;
  private sweepPromise?: Promise<void>;
  private lastSweep = 0;

  constructor(config: ConfigService) {
    const setting = (key: string, fallback: number) => {
      const value = Number(config.get<string | number>(key) ?? fallback);
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${key} 必须为正整数`);
      return value;
    };
    this.audioDir = resolve(
      config.get<string>('TTS_CACHE_DIR') ?? join(process.cwd(), 'tts-audio'),
    );
    this.ttlMs = setting('TTS_CACHE_TTL_SECONDS', 86400) * 1000;
    this.maxBytes = setting('TTS_CACHE_MAX_BYTES', 256 * 1024 * 1024);
    this.maxFiles = setting('TTS_CACHE_MAX_FILES', 512);
    this.maxConcurrent = setting('TTS_MAX_CONCURRENT', 2);
    mkdirSync(this.audioDir, { recursive: true });
  }

  async onModuleInit(): Promise<void> {
    await this.sweepCache(true);
  }

  /** Same-text requests share one operation. Only complete audio is published. */
  async synthesize(params: TtsOptions): Promise<Buffer> {
    const normalized = params.text?.trim();
    const voice = params.voice ?? 'zh-CN-XiaoxiaoNeural';
    if (!normalized || normalized.length > 2000)
      throw new BadRequestException('text 必须为 1 至 2000 字符');
    if (!/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice))
      throw new BadRequestException('音色名称无效');
    const hash = createHash('md5')
      .update(`${voice}:${normalized}`)
      .digest('hex');
    const filename = `${hash}.mp3`;
    const pending = this.inFlight.get(filename);
    if (pending) return pending;
    const operation = this.getOrCreate(filename, normalized, voice);
    this.inFlight.set(filename, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(filename);
    }
  }

  private async getOrCreate(
    filename: string,
    text: string,
    voice: string,
  ): Promise<Buffer> {
    await this.sweepCache();
    const filepath = join(this.audioDir, filename);
    const cached = await this.readCached(filepath);
    if (cached) return cached;
    if (this.active >= this.maxConcurrent)
      throw new ServiceUnavailableException('语音合成繁忙，请稍后重试');
    this.active++;
    const temporary = join(
      this.audioDir,
      `.${filename.slice(0, 32)}.${randomUUID()}.part`,
    );
    this.activeTemps.add(temporary);
    try {
      await this.generateAudio(text, voice, temporary);
      const stat = await lstat(temporary);
      if (
        !stat.isFile() ||
        stat.size > Math.min(this.maxAudioBytes, this.maxBytes)
      )
        throw new Error('音频大小无效');
      const audio = await readFile(temporary);
      if (!isCompleteMp3(audio)) throw new Error('合成音频不完整');
      // Temporary and final files share a directory; rename publishes atomically.
      await rename(temporary, filepath);
      await this.sweepCache(true);
      this.logger.log(`TTS 合成成功: ${filename} (${audio.length} bytes)`);
      return audio;
    } catch (error) {
      this.logger.warn(`TTS 合成失败: ${(error as Error).message}`);
      throw new ServiceUnavailableException('语音合成失败，请稍后重试');
    } finally {
      try {
        await this.removeFile(temporary);
      } finally {
        this.activeTemps.delete(temporary);
        this.active--;
      }
    }
  }

  protected async generateAudio(
    text: string,
    voice: string,
    filepath: string,
  ): Promise<void> {
    await execFileAsync(
      'python',
      [
        '-m',
        'edge_tts',
        '--voice',
        voice,
        '--text',
        text,
        '--write-media',
        filepath,
      ],
      { timeout: 60_000, windowsHide: true },
    );
  }

  private async readCached(filepath: string): Promise<Buffer | undefined> {
    try {
      const stat = await lstat(filepath);
      if (
        stat.isFile() &&
        stat.size <= Math.min(this.maxAudioBytes, this.maxBytes) &&
        Date.now() - stat.mtimeMs < this.ttlMs
      ) {
        const audio = await readFile(filepath);
        if (isCompleteMp3(audio)) {
          const now = new Date();
          await utimes(filepath, now, now);
          return audio;
        }
      }
      await this.removeFile(filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return undefined;
  }

  private async sweepCache(force = false): Promise<void> {
    if (this.sweepPromise) {
      await this.sweepPromise;
      if (force) return this.sweepCache(true);
      return;
    }
    if (!force && Date.now() - this.lastSweep < 60_000) return;
    this.sweepPromise = this.pruneFiles();
    try {
      await this.sweepPromise;
      this.lastSweep = Date.now();
    } finally {
      this.sweepPromise = undefined;
    }
  }

  private async pruneFiles(): Promise<void> {
    const files: { filepath: string; size: number; time: number }[] = [];
    for (const filename of await readdir(this.audioDir)) {
      if (!AUDIO_NAME.test(filename) && !TEMP_NAME.test(filename)) continue;
      const filepath = join(this.audioDir, filename);
      if (this.activeTemps.has(filepath)) continue;
      try {
        const stat = await lstat(filepath);
        const age = Date.now() - stat.mtimeMs;
        if (TEMP_NAME.test(filename)) {
          if (age > 120_000) await this.removeFile(filepath);
        } else if (!stat.isFile() || age >= this.ttlMs) {
          await this.removeFile(filepath);
        } else {
          files.push({ filepath, size: stat.size, time: stat.mtimeMs });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    files.sort((a, b) => a.time - b.time);
    let bytes = files.reduce((total, file) => total + file.size, 0);
    let count = files.length;
    for (const file of files) {
      if (count <= this.maxFiles && bytes <= this.maxBytes) break;
      await this.removeFile(file.filepath);
      bytes -= file.size;
      count--;
    }
  }

  private async removeFile(filepath: string): Promise<void> {
    try {
      await unlink(filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** Legacy lookup: only completed files are published at the final path. */
  async getAudioStream(filename: string): Promise<StreamableFile> {
    if (!AUDIO_NAME.test(filename))
      throw new BadRequestException('音频文件名无效');
    const filepath = resolve(this.audioDir, filename);
    const audio = await this.readCached(filepath);
    if (!audio) throw new NotFoundException('音频文件不存在或已失效');
    return new StreamableFile(audio);
  }
}
