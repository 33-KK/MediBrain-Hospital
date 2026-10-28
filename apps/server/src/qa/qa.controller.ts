import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QaService } from './qa.service';
import { GraphService } from '../neo4j/graph.service';
import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  Matches,
} from 'class-validator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { ConversationsService } from '../conversations/conversations.service';
import { DocumentQaService } from '../knowledge/document-qa.service';
import { previousTopics, clarificationResponse } from './followup-context';
import { Transform } from 'class-transformer';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

export class AskDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  question: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f\d]{24}$/i)
  conversationId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  documentId?: string;
}

@Controller('qa')
export class QaController {
  constructor(
    private readonly qaService: QaService,
    private readonly graph: GraphService,
    private readonly conversations: ConversationsService,
    private readonly documentQa: DocumentQaService,
  ) {}

  /** 图谱问答主接口（需登录） */
  @Post('ask')
  @UseGuards(AuthGuard('jwt'), RateLimitGuard)
  @RateLimit({ windowSeconds: 60, max: 30, byUser: true })
  async ask(
    @Body() dto: AskDto,
    @CurrentUser()
    user?: AuthenticatedUser,
  ) {
    if (!user?.userId) throw new UnauthorizedException('请先登录');
    return this.conversations.runTurn(
      user,
      dto,
      async (conversation, records) => {
        const previous = records.at(-1);
        if (conversation.documentId) {
          return this.documentQa.ask(
            conversation.documentId,
            dto.question,
            previous?.question,
          );
        }
        const resolution = await this.qaService.resolveQuestion(
          dto.question,
          previousTopics(previous?.snapshot),
        );
        if (resolution.needsClarification)
          return clarificationResponse(resolution);
        const response = await this.qaService.ask(resolution.resolvedQuestion);
        return {
          ...response,
          resolvedQuestion: resolution.resolvedQuestion,
          context: {
            inheritedEntities: resolution.inheritedEntities,
            needsClarification: false,
          },
        };
      },
    );
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
