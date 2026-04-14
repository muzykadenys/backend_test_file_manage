import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, IsInt, Min, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateFolderDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean()
  isPublic?: boolean;
}

export class ReorderItemDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class ReorderDto {
  @ApiProperty({ type: [ReorderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

export class ShareCreateDto {
  @ApiProperty()
  @IsString()
  email: string;

  @ApiProperty({ enum: ['read', 'write', 'admin'] })
  @IsIn(['read', 'write', 'admin'])
  permission: 'read' | 'write' | 'admin';

  @ApiPropertyOptional({ description: 'If true, generate public link token' })
  @IsOptional()
  @IsBoolean()
  createPublicLink?: boolean;
}
