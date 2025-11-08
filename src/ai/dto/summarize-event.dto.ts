import { IsArray, IsString, IsNotEmpty } from 'class-validator';
import { Event } from '../../event/entities/event.entity';

export class SummarizeEventDto {
  @IsArray()
  @IsNotEmpty()
  events: Event[];
}

export class SummarizeEventResponseDto {
  summary: string;
}

