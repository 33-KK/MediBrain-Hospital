import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HistoryService } from './history.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('history')
@UseGuards(AuthGuard('jwt'))
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  /** 我的问答历史（管理员默认也看自己的，用 all=true 看全部） */
  @Get()
  list(
    @CurrentUser('userId') userId: string,
    @Query('all') all?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) {
    if (all === 'true') {
      return this.historyService.listAll(page, pageSize);
    }
    return this.historyService.listByUser(userId, page, pageSize);
  }

  /** 清空我的全部记录 */
  @Delete()
  clear(@CurrentUser('userId') userId: string) {
    return this.historyService.clearByUser(userId);
  }

  /** 删除单条记录 */
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.historyService.remove(id, user.userId, user.role === 'admin');
  }
}