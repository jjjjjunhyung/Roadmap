import { IsString, IsOptional, IsEnum } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  content: string;

  @IsString()
  room: string;

  @IsOptional()
  @IsEnum(['text', 'image', 'file', 'system'])
  type?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  fileSize?: number;
}