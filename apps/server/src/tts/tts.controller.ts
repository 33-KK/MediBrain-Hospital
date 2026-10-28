import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { TtsService } from './tts.service';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

class SynthesizeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;

  @IsOptional()
  @IsString()
  voice?: string;
}

@Controller('tts')
@UseGuards(AuthGuard('jwt'))
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

  /** 文本转语音：直接返回 mp3 音频（多副本无共享存储，不走文件） */
  @Post('synthesize')
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowSeconds: 60, max: 10, byUser: true })
  async synthesize(
    @Body() dto: SynthesizeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const audio = await this.ttsService.synthesize(dto);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
    });
    return new StreamableFile(audio);
  }

  /** 获取音频文件流（mp3） */
  @Get('audio/:file')
  async audio(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const stream = await this.ttsService.getAudioStream(file);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `inline; filename="${file}"`,
    });
    return stream;
  }
}
