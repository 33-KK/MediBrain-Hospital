import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { KnowledgeService } from './knowledge.service';

export class KnowledgeQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  kw?: string;
}

@Controller('knowledge')
@UseGuards(AuthGuard('jwt'))
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('stats')
  stats() {
    return this.knowledge.stats();
  }

  @Get('documents')
  search(@Query() query: KnowledgeQueryDto) {
    return this.knowledge.search(
      query.kw,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  @Get('documents/:id')
  document(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.knowledge.document(id, query.page ?? 1);
  }
}
