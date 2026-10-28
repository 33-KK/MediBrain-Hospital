import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { HistoryService } from './history.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

@Controller('history')
@UseGuards(AuthGuard('jwt'))
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  /** 仅查询当前登录用户的问答历史。 */
  @Get()
  list(@CurrentUser() user: { userId: string }, @Query() query: PaginationDto) {
    return this.historyService.listByUser(
      user.userId,
      query.page,
      query.pageSize,
    );
  }

  /** 清空我的全部记录 */
  @Delete()
  clear(@CurrentUser('userId') userId: string) {
    return this.historyService.clearByUser(userId);
  }

  /** 删除单条记录 */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.historyService.remove(id, user.userId);
  }
}
