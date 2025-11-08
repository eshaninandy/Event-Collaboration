import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { Event } from '../event/entities/event.entity';
import { CacheService } from './cache.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey: string;
  private readonly useMock: boolean;
  private readonly chatModel: ChatOpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.apiKey = this.configService.get<string>('AI_API_KEY', 'mock-key');
    this.useMock = this.configService.get<string>('AI_USE_MOCK', 'true') === 'true';

    if (!this.useMock && this.apiKey && this.apiKey !== 'mock-key') {
      this.chatModel = new ChatOpenAI({
        modelName: 'gpt-3.5-turbo',
        temperature: 0.7,
        openAIApiKey: this.apiKey,
      });
      this.logger.log('LangChain ChatOpenAI model initialized');
    } else {
      this.chatModel = null;
      if (!this.useMock) {
        this.logger.warn('AI_USE_MOCK=false but no valid AI_API_KEY provided. Falling back to mock mode.');
      }
    }
  }

  // Summarizes merged events into a one-line description
  async summarizeMergedEvents(events: Event[]): Promise<string> {
    const cacheKey = this.generateCacheKey(events);

    const cachedSummary = await this.cacheService.get<string>(cacheKey);
    if (cachedSummary) {
      this.logger.log(`Cache hit for events: ${events.map((e) => e.id).join(', ')}`);
      return cachedSummary;
    }

    let summary: string;
    if (this.useMock) {
      summary = await this.generateMockSummary(events);
    } else {
      summary = await this.generateAISummary(events);
    }

    await this.cacheService.set(cacheKey, summary, 3600);

    return summary;
  }

  private async generateMockSummary(events: Event[]): Promise<string> {
    const titles = events.map((e) => e.title).join(' + ');
    const eventCount = events.length;
    return `Merged ${eventCount} overlapping events: ${titles}.`;
  }

   // Builds the AI prompt for event summarization.
  private buildPrompt(events: Event[]): string {
    const eventDetails = events.map((event) => {
      const startTime = new Date(event.startTime).toLocaleString();
      const endTime = new Date(event.endTime).toLocaleString();
      const creator = event.creator ? (event.creator.name || event.creator.email) : 'Unknown';
      const invitees = event.invitees?.map((inv) => inv.name || inv.email).join(', ') || 'None';
      return `- Title: ${event.title}\n  Description: ${event.description || 'N/A'}\n  Creator: ${creator}\n  Time: ${startTime} to ${endTime}\n  Status: ${event.status}\n  Invitees: ${invitees}`;
    }).join('\n\n');

    const prompt = `You are a professional calendar assistant. Analyze these ${events.length} overlapping events that have been merged into a single meeting:
${eventDetails}

Generate a professional, concise summary (max 150 chars) that highlights the primary objective or meeting type, mentions key stakeholders/participants, and includes relevant timing if critical.

Format: Professional, clear, actionable. No markdown, just plain text.`;


    return prompt;
  }

  private async generateAISummary(events: Event[]): Promise<string> {
    if (!this.chatModel) {
      this.logger.warn('ChatOpenAI model not available, falling back to mock');
      return this.generateMockSummary(events);
    }

    try {
      const prompt = this.buildPrompt(events);
      
      this.logger.log(`Generating AI summary for ${events.length} merged events`);
      this.logger.log(`\n=== AI PROMPT ===\n${prompt}\n================\n`);
      
      const response = await this.chatModel.invoke(prompt);
      const summary = typeof response.content === 'string' 
        ? response.content.trim() 
        : String(response.content).trim();

      this.logger.log(`\n=== AI RESPONSE ===\n${summary}\n==================\n`);

      if (summary && summary.length > 0) {
        this.logger.log(`AI summary generated successfully: ${summary.substring(0, 50)}...`);
        return summary;
      } else {
        this.logger.warn('AI returned empty summary, falling back to mock');
        return this.generateMockSummary(events);
      }
    } catch (error) {
      this.logger.error('Error generating AI summary with LangChain', error);
      this.logger.warn('Falling back to mock summary due to error');
      return this.generateMockSummary(events);
    }
  }

  private generateCacheKey(events: Event[]): string {
    const sortedIds = events.map((e) => e.id).sort().join('-');
    return `event-summary:${sortedIds}`;
  }
}

