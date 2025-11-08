import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
  IsUUID,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { EventStatus } from '../entities/event.entity';

export class UpdateEventDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(EventStatus)
  @IsOptional()
  status?: EventStatus;

  @IsDateString()
  @IsOptional()
  startTime?: string;

  @IsDateString()
  @IsOptional()
  endTime?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ValidateIf((o) => o.inviteeIds !== undefined)
  @ArrayMinSize(1, { message: 'At least one invitee is required when updating invitees' })
  inviteeIds?: string[];
}
