import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, readFile, writeFile, utimes, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { TtsService } from './tts.service';
import { isCompleteMp3 } from './mp3-validation';

// Two complete MPEG-1 Layer III frames (128 kbps, 44.1 kHz).
const completeAudio = Buffer.alloc(417 * 2);
completeAudio.writeUInt32BE(0xfffb9000, 0);
completeAudio.writeUInt32BE(0xfffb9000, 417);

class FixtureTts extends TtsService {
  generate = jest.fn(
    async (_text: string, _voice: string, filepath: string) => {
      await writeFile(filepath, completeAudio);
    },
  );
  protected generateAudio(text: string, voice: string, filepath: string) {
    return this.generate(text, voice, filepath);
  }
}

describe('语音缓存并发和恢复', () => {
  let dir: string;
  const create = (settings: Record<string, number> = {}) =>
    new FixtureTts(new ConfigService({ TTS_CACHE_DIR: dir, ...settings }));
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'medibrain-tts-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('并发同文本只合成一次，完成前无最终文件，默认音色与显式音色共用缓存', async () => {
    const service = create();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    service.generate.mockImplementationOnce(async (_text, _voice, filepath) => {
      await writeFile(filepath, completeAudio.subarray(0, 300));
      started();
      await gate;
      await writeFile(filepath, completeAudio);
    });
    const requests = Array.from({ length: 20 }, () =>
      service.synthesize({ text: '并发测试' }),
    );
    await begin;
    expect(
      (await readdir(dir)).filter((file) => file.endsWith('.mp3')),
    ).toHaveLength(0);
    release();
    const results = await Promise.all(requests);
    expect(results.every((audio) => audio.equals(completeAudio))).toBe(true);
    expect(service.generate).toHaveBeenCalledTimes(1);
    expect(
      (await readdir(dir)).filter((file) => file.endsWith('.part')),
    ).toHaveLength(0);
    await service.synthesize({
      text: '并发测试',
      voice: 'zh-CN-XiaoxiaoNeural',
    });
    expect(service.generate).toHaveBeenCalledTimes(1);
  });

  it('失败清理半成品，下一次请求可以重新合成', async () => {
    const service = create();
    service.generate.mockImplementationOnce(async (_text, _voice, filepath) => {
      await writeFile(filepath, completeAudio.subarray(0, 500));
      throw new Error('外部服务中断');
    });
    await expect(service.synthesize({ text: '恢复测试' })).rejects.toThrow(
      '语音合成失败',
    );
    expect(await readdir(dir)).toEqual([]);
    expect(await service.synthesize({ text: '恢复测试' })).toEqual(
      completeAudio,
    );
    expect(service.generate).toHaveBeenCalledTimes(2);
  });

  it('拒绝截断输出，不缓存它；已有坏缓存也会重新生成', async () => {
    const service = create();
    service.generate.mockImplementationOnce(async (_text, _voice, filepath) => {
      await writeFile(filepath, completeAudio.subarray(0, 700));
    });
    await expect(service.synthesize({ text: '坏缓存' })).rejects.toThrow(
      '语音合成失败',
    );
    expect(await readdir(dir)).toEqual([]);
    await service.synthesize({ text: '坏缓存' });
    const [file] = await readdir(dir);
    await writeFile(join(dir, file), 'ID3 invalid cached output');
    await service.synthesize({ text: '坏缓存' });
    expect(service.generate).toHaveBeenCalledTimes(3);
    expect(isCompleteMp3(await readFile(join(dir, file)))).toBe(true);
  });

  it('启动时清理过期音频和旧临时文件，只操作缓存命名的文件', async () => {
    const audio = join(dir, 'a'.repeat(32) + '.mp3');
    const part = join(
      dir,
      '.' + 'b'.repeat(32) + '.00000000-0000-0000-0000-000000000000.part',
    );
    const unrelated = join(dir, 'keep.txt');
    for (const file of [audio, part, unrelated]) {
      await writeFile(file, completeAudio);
      await utimes(file, new Date(0), new Date(0));
    }
    await create().onModuleInit();
    expect(await readdir(dir)).toEqual(['keep.txt']);
  });

  it('按最近访问顺序限制文件数和总大小', async () => {
    const service = create({
      TTS_CACHE_MAX_FILES: 2,
      TTS_CACHE_MAX_BYTES: completeAudio.length * 2,
    });
    await service.synthesize({ text: '甲' });
    const [oldest] = await readdir(dir);
    await utimes(
      join(dir, oldest),
      new Date(Date.now() - 5000),
      new Date(Date.now() - 5000),
    );
    await service.synthesize({ text: '乙' });
    await service.synthesize({ text: '丙' });
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    expect(files).not.toContain(oldest);
    const bytes = await Promise.all(
      files.map((file) => readFile(join(dir, file))),
    );
    expect(
      bytes.reduce((size, audio) => size + audio.length, 0),
    ).toBeLessThanOrEqual(completeAudio.length * 2);
  });

  it('限制不同文本的并发，释放名额后可以继续处理', async () => {
    const service = create({ TTS_MAX_CONCURRENT: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    service.generate.mockImplementationOnce(async (_text, _voice, filepath) => {
      started();
      await gate;
      await writeFile(filepath, completeAudio);
    });
    const pending = service.synthesize({ text: '占用名额' });
    await begin;
    await expect(service.synthesize({ text: '第二请求' })).rejects.toThrow(
      '繁忙',
    );
    release();
    await pending;
    await expect(service.synthesize({ text: '第二请求' })).resolves.toEqual(
      completeAudio,
    );
  });

  it('服务重建后仍可读取完整缓存', async () => {
    await create().synthesize({ text: '重启恢复' });
    const restarted = create();
    await restarted.onModuleInit();
    expect(await restarted.synthesize({ text: '重启恢复' })).toEqual(
      completeAudio,
    );
    expect(restarted.generate).not.toHaveBeenCalled();
  });

  it('无效音色和超长文本不会启动子进程', async () => {
    const service = create();
    await expect(
      service.synthesize({ text: '测试', voice: '--help' }),
    ).rejects.toThrow('音色');
    await expect(
      service.synthesize({ text: '字'.repeat(2001) }),
    ).rejects.toThrow('2000');
    expect(service.generate).not.toHaveBeenCalled();
  });

  it('旧音频接口拒绝坏缓存及非法路径，不返回任意文件内容', async () => {
    const service = create();
    const name = 'c'.repeat(32) + '.mp3';
    await writeFile(join(dir, name), 'incomplete audio');
    await expect(service.getAudioStream(name)).rejects.toThrow('已失效');
    expect(await readdir(dir)).toEqual([]);
    await expect(service.getAudioStream('../secret')).rejects.toThrow('文件名');
  });
});

describe('音频完整性', () => {
  it('支持完整帧和 ID3 标签，拒绝截断帧及非 MP3 输出', () => {
    expect(isCompleteMp3(completeAudio)).toBe(true);
    expect(
      isCompleteMp3(
        Buffer.concat([
          Buffer.from('49443304000000000000', 'hex'),
          completeAudio,
        ]),
      ),
    ).toBe(true);
    expect(isCompleteMp3(completeAudio.subarray(0, 700))).toBe(false);
    expect(isCompleteMp3(Buffer.alloc(1000))).toBe(false);
  });
});
