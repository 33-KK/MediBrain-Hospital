import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GraphManageService } from './graph-manage.service';
import { GraphGuard } from './guards/graph.guard';
import {
  CreateNodeDto,
  CreateRelationDto,
  DeleteNodeDto,
  DeleteRelationDto,
  QueryNodesDto,
  QueryRelationsDto,
  UpdateNodeDto,
} from './dto/graph.dto';

@Controller('graph')
@UseGuards(AuthGuard('jwt'), GraphGuard)
export class GraphController {
  constructor(private readonly graphManage: GraphManageService) {}

  /** 元数据：标签与关系类型列表 */
  @Get('meta')
  meta() {
    return this.graphManage.getMeta();
  }

  /** 分页查询节点 */
  @Get('nodes')
  nodes(@Query() query: QueryNodesDto) {
    return this.graphManage.listNodes({
      ...query,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  /** 创建节点 */
  @Post('nodes')
  createNode(@Body() dto: CreateNodeDto) {
    return this.graphManage.createNode(dto);
  }

  /** 更新节点 */
  @Put('nodes')
  updateNode(@Body() dto: UpdateNodeDto) {
    return this.graphManage.updateNode(dto);
  }

  /** 删除节点 */
  @Delete('nodes')
  deleteNode(@Body() dto: DeleteNodeDto) {
    return this.graphManage.deleteNode(dto);
  }

  /** 分页查询关系 */
  @Get('relations')
  relations(@Query() query: QueryRelationsDto) {
    return this.graphManage.listRelations({
      ...query,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  /** 创建关系 */
  @Post('relations')
  createRelation(@Body() dto: CreateRelationDto) {
    return this.graphManage.createRelation(dto);
  }

  /** 删除关系 */
  @Delete('relations')
  deleteRelation(@Body() dto: DeleteRelationDto) {
    return this.graphManage.deleteRelation(dto);
  }
}