import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { BatchCreateEventDto } from './dto/batch-create-event.dto';
import { Event } from './entities/event.entity';

@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Post()
  async create(@Body() createEventDto: CreateEventDto): Promise<Event> {
    return await this.eventService.create(createEventDto);
  }

  @Post('batch')
  async batchCreate(@Body() batchDto: BatchCreateEventDto): Promise<Event[]> {
    return await this.eventService.batchCreate(batchDto);
  }

  @Get(':id')
  async getEventById(@Param('id', ParseUUIDPipe) id: string): Promise<Event> {
    return await this.eventService.getEventById(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateEventDto: UpdateEventDto,
  ): Promise<Event> {
    return await this.eventService.update(id, updateEventDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return await this.eventService.remove(id);
  }

  @Post('merge-all/:userId')
  async mergeAll(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<Event> {
    return await this.eventService.mergeAll(userId);
  }

  @Get('conflicts/:userId')
  async findConflicts(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<Event[]> {
    return await this.eventService.findConflicts(userId);
  }
}
