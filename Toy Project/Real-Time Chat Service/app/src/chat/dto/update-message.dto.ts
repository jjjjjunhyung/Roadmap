import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

