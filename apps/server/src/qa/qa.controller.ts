import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QaService } from './qa.service';
import { GraphService } from '../neo4j/graph.service';
import { HistoryService } from '../history/history.service';
import { IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

export class AskDto {
  @IsString()
  @MinLength(2)
  question: string;
}

@Controller('qa')
export class QaController {
  constructor(
    private readonly qaService: QaService,
    private readonly graph: GraphService,
    private readonly historyService: HistoryService,
  ) {}

  /** 图谱问答主接口（需登录，按用户身份个性化回答） */
  @Post('ask')
  @UseGuards(AuthGuard('jwt'), RateLimitGuard)
  @RateLimit({ windowSeconds: 60, max: 30, byUser: true })
  async ask(
    @Body() dto: AskDto,
    @CurrentUser() user?: { userId: string; username: string; role: string; identity?: string },
  ) {
    const result = await this.qaService.ask(dto.question, user?.identity);
    if (user?.userId) {
      await this.historyService.save({
        userId: user.userId,
        username: user.username,
        identity: user.identity,
        question: dto.question,
        answer: result.answer,
        dimension: result.dimension ?? '',
        provider: result.provider,
        graphMatched: result.graphMatched,
        entityNames: (result.entities ?? []).map((e) => e.name),
      });
    }
    return result;
  }

  /** 实体检索（供前端联想/搜索使用） */
  @Get('search')
  search(@Query('kw') kw: string) {
    return this.graph.searchEntity(kw ?? '');
  }

  /** 疾病详情图谱 */
  @Get('disease')
  disease(@Query('name') name: string) {
    return this.graph.getDiseaseInfo(name ?? '');
  }
}
