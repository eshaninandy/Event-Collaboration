# Event Collaboration API

A production-ready NestJS backend system for event collaboration with intelligent conflict detection, smart merging, and AI-powered summarization.

## Features

- *Event Management*: Full CRUD operations for events
- *User Management*: Create and manage users
- *Conflict Detection*: Automatically detect overlapping events
- *Smart Merging*: Intelligently merge overlapping events with validation
- *AI Summarization*: Generate summaries for merged events (async processing)
- *Batch Operations*: Create up to 500 events efficiently
- *Audit Trail*: Track all merge operations with AI summaries

## Tech Stack

- *NestJS*: Progressive Node.js framework
- *TypeORM*: Object-Relational Mapping
- *PostgreSQL*: Database
- *Redis*: Message queue (BullMQ) and caching
- *Docker & Docker Compose*: Containerization
- *BullMQ*: Background job processing for async AI summarization

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ (for local development)
- Make (for running project commands)

## How to Run Project & Tests

*Using Docker Compose:*

1. Start all services:
   make up

2. View API logs:
   make logs

3. Stop services:
   make down

The API will be available at `http://localhost:3000`

*Local Development:*

1. Install dependencies:
   make install

2. Start PostgreSQL and Redis:
   make up-deps

3. Run the application:
   make dev

*Running Tests:*

- Unit Tests:
  make test

- E2E Tests (Contains health check only - all testing covered under unit and integration):
  make test-e2e

- Docker-based Tests:
  make test-docker      # Run unit tests in Docker
  make test-e2e-docker  # Run e2e tests in Docker

- View available commands:
  make help

## AI Summarization

*Current Implementation:*
- *Mock AI Service*: Default implementation using simple string concatenation (currently active in demo)
- *LangChain Integration*: Real AI summarization code exists in `src/ai/ai.service.ts` using OpenAI GPT-3.5-turbo via LangChain
- *Caching*: Redis-based caching with 1-hour TTL for summaries

*Important Note:*
The demo currently uses mock AI summaries. The real OpenAI integration code is fully implemented in `src/ai/ai.service.ts` (lines 82-116), but requires a valid, working OpenAI API key with sufficient quota. Without a valid API key, the system automatically falls back to mock mode.

*Configuration:*

The AI service supports two modes:

- *Mock Mode (Currently Active)*:
  - Default mode when `AI_USE_MOCK=true` or when OpenAI API key is invalid/restricted
  - Returns: `"Merged N overlapping events: Event Title 1 + Event Title 2."`
  - No external API calls
  - Used in demo due to API key restrictions

- *Real AI Mode*:
  - Requires `AI_USE_MOCK=false` AND a valid OpenAI API key with sufficient quota
  - Code location: `src/ai/ai.service.ts` - `generateAISummary()` method (lines 82-116)
  - Uses LangChain with OpenAI GPT-3.5-turbo to generate intelligent, context-aware summaries
  - Automatically falls back to mock mode if:
    - API key is invalid or missing
    - API quota is exceeded
    - API calls fail for any reason

*How It Works:*

1. *Merge Operation*:
   - User calls `POST /events/merge-all/:userId`
   - Events are merged and audit log is created
   - AI summary job is queued (async) or generated immediately (sync fallback)

2. *Async Processing (Production)*:
   - BullMQ queues the summary generation job
   - Background worker (`AiSummaryProcessor`) processes the job
   - Summary is cached in Redis for future use
   - Audit log is updated with the AI summary

3. *Sync Processing (Local/Testing)*:
   - If queue unavailable, summary is generated synchronously
   - Summary appears immediately in the response

*Enabling Real AI Mode:*

**Note:** The code for real AI is implemented but currently falls back to mock due to API key restrictions. To use real AI:

1. *Get a Valid OpenAI API Key:*
   - Sign up at https://platform.openai.com/
   - Add payment method and ensure sufficient quota
   - Generate API key at https://platform.openai.com/api-keys

2. *Set Environment Variables:*
   - Create a `.env` file in the project root (or add to `docker-compose.yml`)
   - Add: `AI_USE_MOCK=false`
   - Add: `AI_API_KEY=your-valid-openai-api-key-here`
   - The `.env` file is already in `.gitignore` for security

3. *Restart Services:*
   make down
   make up

4. *Verify AI Initialization:*
   - Check logs: `make logs`
   - Look for: `LangChain ChatOpenAI model initialized`
   - If you see quota errors, the API key needs billing setup or has exceeded limits

*Editing AI Prompts:*

The AI prompt can be customized in `src/ai/ai.service.ts`:
- *Method*: `buildPrompt()` (around line 80). Restart the application after changing prompt and then trigger merge events and check logs for prompts and responses.

*Viewing AI Summaries:*

In Database:
make shell-db

Then run:
SELECT notes FROM audit_logs ORDER BY "createdAt" DESC LIMIT 1;

In Response:
- Check `auditLog.aiSummary` field in mergeAll response (sync mode)
- In async mode, query database after a few seconds

In Logs:
- Prompts are logged: `=== AI PROMPT ===`
- Responses are logged: `=== AI RESPONSE ===`
- Use `make logs` to view

*Prompt Engineering & Iterative Improvement:*

The AI service supports iterative prompt refinement:
- *Mock Summary*: `"Merged 2 overlapping events: Event 1 + Event 2."`
- *AI Summary*: `"Team planning session with Jane and Bob discussing Q1 roadmap"`
- Different prompts produce different styles and tones
- Caching ensures instant results for repeated operations
- Fallback to mock mode if AI fails


## Merge Algorithm

The merge algorithm intelligently combines overlapping events based on several criteria:

*1. Time Overlap Detection*
- Events are considered overlapping if they share any time period
- Boundary condition: Events that touch exactly (endTime1 = startTime2) are merged
- Uses standard interval overlap logic: `startTime1 < endTime2 && startTime2 < endTime1`

*2. Participant Overlap Validation*
- Events must have at least one common participant *other than* the user performing the merge
- This ensures events are truly collaborative before merging
- Example: User A's events with only User B won't merge with events containing only User C

*3. Title Compatibility Check*
- Prevents merging semantically different events
- Uses keyword pattern matching to detect incompatible pairs:
  - "1:1" vs "demo"
  - "1:1" vs "meeting"
  - Other incompatible patterns
- Example: "1:1 manager call" and "demo meeting" won't merge even if they overlap

*4. Status Filtering*
- `CANCELED` events are excluded from merging
- Only active events (TODO, IN_PROGRESS, COMPLETED) are considered for merge

*5. Merge Group Selection*
- When multiple overlapping groups exist, the largest group is merged first
- Groups are identified by finding all connected overlapping events

*6. Metadata Combination*
- *Title*: Concatenated with " | " separator (e.g., "Event 1 | Event 2")
- *Description*: Combined from all merged events
- *Status*: Priority order: COMPLETED > IN_PROGRESS > TODO
- *Time Range*: `startTime = min(all startTimes)`, `endTime = max(all endTimes)`
- *Invitees*: Union of all unique invitees from merged events
- *MergedFrom*: JSONB array storing IDs of all merged events


## API Endpoints

*Events:*
- `POST /events` - Create a new event (requires at least one invitee)
- `GET /events/:id` - Get event by ID
- `PATCH /events/:id` - Update an event
- `DELETE /events/:id` - Delete an event
- `POST /events/batch` - Batch create up to 500 events
- `POST /events/merge-all/:userId` - Merge all overlapping events for a user
- `GET /events/conflicts/:userId` - Get all conflicts (overlapping events) for a user

*Users:*
- `POST /users` - Create a new user
- `GET /users/:id` - Get user by ID
- `GET /users` - Get all users

## Test Coverage

*Overview:*
- Unit tests: Event service, User service, AI service, Cache service, Database repositories
- Integration tests: CRUD operations, merge logic, batch insert, property-based tests
- Total: 51 unit tests + 18 integration tests + property-based test

*Edge Cases Tested:*

*Event Service:*
- Validation Edge Cases:
  - Events with no invitees (rejected)
  - Creator in invitee list (rejected)
  - Invalid time ranges (startTime >= endTime)
  - Events not found (NotFoundException)
  - Users not found (NotFoundException)

- Merge Edge Cases:
  - Less than 2 events for merge (rejected)
  - All events CANCELED (excluded from merge)
  - No common participants besides userId (rejected)
  - Incompatible titles (1:1 vs demo/presentation, not merged)
  - No overlapping events by time (rejected)
  - Events that touch at boundary (endTime1 = startTime2, merged)
  - Concurrent events with same start/end times (merged)
  - Events with empty titles (handled gracefully)
  - Largest group selection when multiple overlapping groups exist
  - Status priority handling (COMPLETED > IN_PROGRESS > TODO)

- Batch Operations Edge Cases:
  - Empty events array (rejected)
  - More than 500 events (rejected)
  - No invitees in batch event (rejected)
  - Creator not found in batch (NotFoundException)
  - Invitee not found in batch (NotFoundException)
  - Creator in inviteeIds in batch (rejected)
  - Invalid time range in batch (rejected)
  - Transaction rollback on error
  - Batch with 500 events (maximum limit)
  - Duplicate invitee IDs (deduplicated)
  - Efficient batch user fetching (single query)

*User Service:*
- Duplicate email (unique constraint violation)
- User not found (NotFoundException)
- Different email formats (handled)
- Empty results (returns empty array)
- User relations loading (events)

*AI Service:*
- Events with empty titles (handled)
- Very long titles (handled)
- Cache miss/hit scenarios
- AI service failure (fallback to mock summary)
- Deterministic cache keys (sorted event IDs)
- Single event summarization
- Multiple events summarization

*Cache Service:*
- Non-existent keys (returns null)
- Expired entries (returns null)
- Different value types (strings, objects, arrays)
- Zero TTL (immediate expiration)
- Very long TTL (handled)
- Null/undefined values (stored and retrieved correctly)
- Empty string keys (handled)
- Very long keys (handled)
- Concurrent operations (thread-safe)
- Cache clear operations

*Database Repository:*
- Event Repository:
  - JSONB column handling (mergedFrom)
  - Relations loading (creator, invitees)
  - Query builder with joins and filters
  - Date and status filtering

- AuditLog Repository:
  - JSONB columns (mergedEventIds)
  - Empty mergedEventIds array
  - Null notes field
  - Automatic timestamp generation (createdAt)
  - Filtering by user ID and new event ID
  - Date range filtering

- User Repository:
  - Relations loading (events)
  - Basic CRUD operations
  - Unique email constraint

*Integration Tests:*
- Property-based testing (startTime = min, endTime = max)
- Batch insert performance (500 events within 2 seconds)
- Multiple overlapping groups (largest group merged)
- Boundary conditions (touching events)
- Database transaction consistency
- Audit log creation and persistence
- CRUD operations with relations

## Project Structure

```
src/
├── event/           # Event module (CRUD, merge, conflicts)
├── user/            # User module
├── ai/              # AI service and caching
├── queue/           # BullMQ queue and processor
├── audit-log/       # Audit log entity
└── main.ts          # Application entry point

test/
├── unit/            # Unit tests
├── integration/     # Integration tests
└── app.e2e-spec.ts  # E2E tests
```

## System Architecture

*System Components:*
1. *NestJS Application*: REST API with modular architecture
2. *PostgreSQL*: Primary database for events, users, audit logs
3. *Redis*: Message queue (BullMQ) and caching layer
4. *BullMQ*: Background job processing for async AI summarization

*Key Services:*
- *EventService*: Core business logic for events, merging, conflicts
- *UserService*: User management
- *AiService*: AI summarization with caching
- *CacheService*: Redis-based caching
- *AiSummaryProcessor*: Background worker for async summary generation

*Data Flow:*
1. User creates/updates events → EventService
2. Merge request → EventService finds overlaps → Validates → Merges
3. Audit log created → AI job queued (async) or generated (sync)
4. Background worker processes job → Updates audit log with summary

## AI Used For

This project used AI assistance for the following areas to accelerate development:

*Boilerplate & Infrastructure:*
- *Project boilerplate*: Initial NestJS project setup, module structure, and configuration files
- *BullMQ integration*: Code for setting up BullMQ queue system, processor configuration, and job handling
- *Redis integration*: Redis client setup, connection handling, and caching service implementation

*AI Integration:*
- *LangChain integration*: Implementation of LangChain with OpenAI GPT-3.5-turbo for AI-powered event summarization
- *AI service structure*: Service architecture for AI summarization with both mock and real AI implementations

*Documentation:*
- *README document*: Initial README structure and documentation content

*Testing:*
- *Test boilerplate*: Basic test structure and setup code for unit and integration tests
- *Test utilities*: Helper functions and test utilities (e.g., pg-mem datasource setup)

*What Was NOT AI-Generated:*

The following critical components were designed and implemented manually:

- *Business logic*: All conflict detection algorithms, merge logic, and validation rules
- *Database operations*: All TypeORM repository queries, transactions, and data operations
- *Test design*: Test scenarios, edge cases, and test strategies
- *System architecture*: Overall system design, component organization, and architectural decisions
- *Merge algorithm*: Core merging algorithm, overlap detection, and participant validation logic


