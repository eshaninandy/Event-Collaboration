import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
  IsUUID,
  ArrayMinSize,
} from 'class-validator';
import { EventStatus } from '../entities/event.entity';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(EventStatus)
  @IsNotEmpty()
  status: EventStatus;

  @IsDateString()
  @IsNotEmpty()
  startTime: string;

  @IsDateString()
  @IsNotEmpty()
  endTime: string;

  @IsUUID()
  @IsNotEmpty()
  creatorId: string;

  @IsArray({ message: 'inviteeIds must be an array' })
  @IsNotEmpty({ message: 'inviteeIds is required' })
  @ArrayMinSize(1, { message: 'At least one invitee is required' })
  @IsUUID('4', { each: true, message: 'Each inviteeId must be a valid UUID' })
  inviteeIds: string[];
}
