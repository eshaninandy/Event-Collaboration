import {
  IsArray,
  IsNotEmpty,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateEventDto } from './create-event.dto';

export class BatchCreateEventDto {
  @IsArray()
  @IsNotEmpty()
  @ArrayMaxSize(500, { message: 'Maximum 500 events allowed per batch' })
  @ValidateNested({ each: true })
  @Type(() => CreateEventDto)
  events: CreateEventDto[];
}

