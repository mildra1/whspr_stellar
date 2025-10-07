import { IsEnum, IsArray, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

export class CreateExportDto {
  @ApiProperty({ description: 'User ID to export data for' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: ExportFormat, default: ExportFormat.JSON })
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @IsOptional()
  fields?: string[];

  @ApiProperty({ default: false })
  @IsBoolean()
  @IsOptional()
  encrypt?: boolean;
}

