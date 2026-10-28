import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ConversationsService } from './conversations.service';

export class RenameConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title: string;
}

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser('userId') userId: string, @Query() query: PaginationDto) {
    return this.conversations.list(userId, query.page, query.pageSize);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.conversations.detail(id, userId);
  }

  @Patch(':id')
  rename(
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
    @Body() body: RenameConversationDto,
  ) {
    return this.conversations.rename(id, userId, body.title);
  }
}
