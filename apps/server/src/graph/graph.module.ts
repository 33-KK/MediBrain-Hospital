import { Module } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { GraphManageService } from './graph-manage.service';

@Module({
  controllers: [GraphController],
  providers: [GraphManageService],
})
export class GraphModule {}