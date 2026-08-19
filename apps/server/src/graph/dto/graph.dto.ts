import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/** 图谱中允许管理的节点标签（与 labels(n)[0] 一致） */
export const GRAPH_LABELS = [
  '疾病',
  '药品',
  '药品商',
  '疾病症状',
  '食物',
  '检查项目',
  '治疗方法',
  '科目',
] as const;

/** 图谱中允许管理的关系类型 */
export const GRAPH_RELATION_TYPES = [
  '疾病宜吃食物',
  '疾病的症状',
  '疾病使用药品',
  '治疗的方法',
  '疾病所需检查',
  '疾病忌吃食物',
  '生产',
  '疾病并发疾病',
  '疾病所属科目',
] as const;

export class CreateNodeDto {
  @IsEnum(GRAPH_LABELS)
  label: string;

  @IsObject()
  properties: Record<string, string | number>;
}

export class UpdateNodeDto {
  @IsEnum(GRAPH_LABELS)
  label: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsObject()
  properties: Record<string, string | number>;
}

export class DeleteNodeDto {
  @IsEnum(GRAPH_LABELS)
  label: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateRelationDto {
  @IsIn(GRAPH_RELATION_TYPES)
  type: string;

  @IsEnum(GRAPH_LABELS)
  fromLabel: string;

  @IsString()
  @IsNotEmpty()
  fromName: string;

  @IsEnum(GRAPH_LABELS)
  toLabel: string;

  @IsString()
  @IsNotEmpty()
  toName: string;
}

export class DeleteRelationDto extends CreateRelationDto {}

export class QueryNodesDto {
  @IsOptional()
  @IsEnum(GRAPH_LABELS)
  label?: string;

  @IsOptional()
  @IsString()
  kw?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 20;
}

export class QueryRelationsDto {
  @IsOptional()
  @IsString()
  kw?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 20;
}