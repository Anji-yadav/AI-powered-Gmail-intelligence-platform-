# Architecture & Design Document
## AI-powered Gmail Intelligence Platform

---

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Database Schema](#database-schema)
3. [AI Design](#ai-design)
4. [Gmail API Strategy](#gmail-api-strategy)
5. [Tool & Technology Decisions](#tool--technology-decisions)
6. [Trade-offs & Limitations](#trade-offs--limitations)

---

## 1. System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌──────────────┬──────────────┬──────────────┬───────────────┐ │
│  │  Email List  │ Email Viewer │  Chat Agent  │  Compose UI   │ │
│  └──────────────┴──────────────┴──────────────┴───────────────┘ │
│                              │                                    │
│                    HTTP/WebSocket (Secured JWT)                 │
│                              │                                    │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                         Backend (Express)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              API Layer                                   │   │
│  │  ├── /auth           → OAuth flow & JWT tokens         │   │
│  │  ├── /emails         → Fetch, sync, categorize         │   │
│  │  ├── /chat           → Chat agent queries              │   │
│  │  └── /compose        → Draft & send emails             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Service Layer                                  │   │
│  │  ├── Gmail Service      → Gmail API client              │   │
│  │  ├── Embedding Service  → Vector generation             │   │
│  │  ├── RAG Pipeline       → Retrieval & reasoning          │   │
│  │  ├── Categorizer        → Email classification           │   │
│  │  ├── Gemini Service     → Primary AI model              │   │
│  │  └── NIM Service        → Secondary classification       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Background Workers (Bull Queue)                │   │
│  │  ├── Email Sync Worker    → Incremental sync            │   │
│  │  ├── Embedding Worker     → Generate vectors            │   │
│  │  ├── Categorization Worker→ Classify emails             │   │
│  │  └── Summary Worker       → Pre-compute summaries        │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
      ┌────▼───┐           ┌───▼────┐         ┌──▼──────┐
      │ Supabase│           │ Gmail  │         │Google   │
      │  (DB)   │           │ API    │         │Gemini   │
      └────┬────┘           └───┬────┘         └──┬──────┘
           │                   │                  │
    ┌──────▼──────┐       ┌──────▼───┐    ┌──────▼──────┐
    │ PostgreSQL  │       │ OAuth 2.0 │    │ LLM Model   │
    │ + pgvector  │       │ Tokens    │    │ Reasoning   │
    └─────────────┘       └───────────┘    └─────────────┘
                               │
                           ┌───▼────────┐
                           │  NVIDIA NIM │
                           │  (LLM)      │
                           └─────────────┘
```

### Component Descriptions

#### Frontend
- **Email List Component** — Displays threads with categories, previews, and unread counts
- **Email Viewer** — Shows full thread with messages, attachments, and formatting preserved
- **Chat Agent UI** — Conversational interface for querying emails
- **Compose UI** — Draft new emails or replies with AI assistance
- **Sidebar** — Navigation, category filters, sync status, user profile

#### Backend API Layer
- **Auth Endpoints** — OAuth callback, token refresh, logout
- **Email Endpoints** — Fetch threads, get email content, list categories
- **Chat Endpoints** — Accept queries, stream responses, maintain context
- **Compose Endpoints** — Generate drafts, validate before sending

#### Service Layer
- **Gmail Service** — Encapsulates Gmail API calls, rate limiting, token refresh
- **Embedding Service** — Converts email text to vectors using embedding model
- **RAG Pipeline** — Retrieval-augmented generation for the chat agent
- **Categorizer** — Multi-model classification pipeline
- **Gemini Service** — Primary LLM for summarization, drafting, reasoning
- **NIM Service** — Fast classification and secondary reasoning

#### Background Workers
- **Email Sync Worker** — Runs incrementally to fetch new/updated emails
- **Embedding Worker** — Generates and stores vectors for new emails
- **Categorization Worker** — Classifies emails after they're synced
- **Summary Worker** — Pre-computes summaries to reduce latency

---

## 2. Database Schema

### Core Tables

#### `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_sync_at TIMESTAMP,
  sync_state JSONB DEFAULT '{
    "last_email_id": null,
    "last_page_token": null,
    "initial_sync_complete": false,
    "total_synced": 0
  }'::jsonb,
  gmail_refresh_token TEXT ENCRYPTED,  -- Encrypted via pgcrypto
  settings JSONB DEFAULT '{
    "auto_categorize": true,
    "summarize_threads": true,
    "dedup_newsletters": true
  }'::jsonb
);

CREATE INDEX idx_users_email ON users(email);
```

#### `threads`
```sql
CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id VARCHAR(100) NOT NULL,
  subject TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP,
  message_count INT DEFAULT 1,
  unread_count INT DEFAULT 0,
  primary_sender VARCHAR(255),  -- Extracted from first message
  labels TEXT[] DEFAULT ARRAY[]::TEXT[],
  UNIQUE(user_id, gmail_thread_id)
);

CREATE INDEX idx_threads_user_id ON threads(user_id);
CREATE INDEX idx_threads_created_at ON threads(created_at DESC);
CREATE INDEX idx_threads_labels ON threads USING GIN(labels);
```

#### `emails`
```sql
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  gmail_message_id VARCHAR(100) NOT NULL,
  gmail_thread_id VARCHAR(100) NOT NULL,
  
  -- Email metadata
  "from" VARCHAR(255) NOT NULL,
  "to" TEXT[] NOT NULL,
  cc TEXT[] DEFAULT ARRAY[]::TEXT[],
  bcc TEXT[] DEFAULT ARRAY[]::TEXT[],
  subject TEXT,
  
  -- Email content
  body_text TEXT,
  body_html TEXT,
  
  -- Threading
  in_reply_to VARCHAR(100),
  references TEXT,
  
  -- System fields
  received_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  
  -- AI fields
  summary_short TEXT,                  -- One-line summary
  summary_full TEXT,                   -- Detailed summary
  summary_generated_at TIMESTAMP,
  embedding vector(1536),              -- text-embedding-3-small
  embedding_generated_at TIMESTAMP,
  
  UNIQUE(user_id, gmail_message_id)
);

CREATE INDEX idx_emails_user_id ON emails(user_id);
CREATE INDEX idx_emails_thread_id ON emails(thread_id);
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_embedding ON emails USING ivfflat(embedding vector_cosine_ops);
```

#### `email_categories`
```sql
CREATE TABLE email_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  category VARCHAR(50) NOT NULL,  -- work, personal, newsletters, finance, recruitment, notifications, other
  confidence DECIMAL(3, 2),       -- 0.00 to 1.00
  assigned_by VARCHAR(50),        -- 'ai_gemini', 'ai_nim', 'rule_based', 'user'
  assigned_at TIMESTAMP DEFAULT NOW(),
  is_user_confirmed BOOLEAN DEFAULT FALSE,
  
  UNIQUE(email_id, category)  -- Email can have one of each category, but usually just one primary
);

CREATE INDEX idx_email_categories_email_id ON email_categories(email_id);
CREATE INDEX idx_email_categories_category ON email_categories(category);
```

#### `chat_history`
```sql
CREATE TABLE chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(100),        -- Groups conversation turns
  turn_number INT,
  
  user_message TEXT NOT NULL,
  assistant_response TEXT NOT NULL,
  
  -- RAG context
  retrieved_email_ids UUID[] DEFAULT ARRAY[]::UUID[],  -- Emails used for response
  reasoning JSONB,                -- { "query_intent": "...", "search_type": "...", ... }
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(session_id, turn_number)
);

CREATE INDEX idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX idx_chat_history_session_id ON chat_history(session_id);
```

#### `thread_summaries` (Optimized summary cache)
```sql
CREATE TABLE thread_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
  model_used VARCHAR(50)  -- 'gemini-1.5-pro', etc.
);

CREATE INDEX idx_thread_summaries_expires_at ON thread_summaries(expires_at);
```

#### `newsletter_items` (For deduplication)
```sql
CREATE TABLE newsletter_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  
  title TEXT NOT NULL,
  description TEXT,
  source_email_from VARCHAR(255),
  item_url TEXT,
  
  -- Deduplication
  canonical_item_id UUID,  -- Points to the first occurrence of this item
  similarity_score DECIMAL(3, 2),  -- To the canonical item
  extracted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_newsletter_items_user_id ON newsletter_items(user_id);
CREATE INDEX idx_newsletter_items_canonical_item_id ON newsletter_items(canonical_item_id);
```

### Schema Design Decisions

1. **Normalization**: Threads and emails are separate entities because:
   - Multiple emails belong to one thread
   - Threads have their own metadata (subject, labels, primary sender)
   - Allows efficient querying of threads vs. individual messages

2. **pgvector for Embeddings**:
   - Stores 1536-dimensional vectors (text-embedding-3-small)
   - IVF indexing for fast approximate nearest neighbor search
   - Enables semantic similarity queries for the RAG pipeline

3. **JSONB Fields**:
   - `users.sync_state` — Tracks incremental sync progress
   - `email_categories.reasoning` — Explains categorization decisions
   - `chat_history.reasoning` — Documents RAG retrieval and reasoning steps
   - Allows schema flexibility without migrations

4. **Encrypted Columns**:
   - `users.gmail_refresh_token` encrypted with pgcrypto
   - Protects OAuth tokens at rest

5. **Indexes**:
   - Composite indexes on frequently filtered combinations (user_id + category)
   - IVF index for vector searches
   - GIN index for array searches (labels)

---

## 3. AI Design

### Email Summarization

#### Approach: Hierarchical Summarization

```
Individual Email Summarization:
┌─────────────────────────┐
│  Raw Email Body Text    │
└────────────┬────────────┘
             │
      ┌──────▼──────┐
      │ Chunk (512   │
      │ tokens max)  │
      └──────┬───────┘
             │
      ┌──────▼──────────────────────┐
      │ Gemini: Summarize chunk     │
      │ Prompt: "Summarize this     │
      │ part in 1-2 sentences"      │
      └──────┬───────────────────────┘
             │
      ┌──────▼──────┐
      │ Short Summary│  (cached)
      └──────────────┘

Thread-Level Summarization:
┌─────────────────────────────────┐
│  All Email Summaries + Subjects  │
│  (ordered by date, ascending)    │
└────────────┬────────────────────┘
             │
      ┌──────▼──────────────────────┐
      │ Gemini: Thread context      │
      │ Prompt: "These emails form  │
      │ a conversation about X.     │
      │ Summarize the arc and       │
      │ key decisions"               │
      └──────┬───────────────────────┘
             │
      ┌──────▼───────────────────┐
      │ Thread Summary + Timeline │  (cached for 30 days)
      └──────────────────────────┘
```

**Chunking Strategy:**
- For emails > 512 tokens: Chunk and summarize each chunk independently
- For threads > 2048 tokens: Summarize individual emails first, then thread
- Always include sender and timestamp in context

**Caching:**
- Individual email summaries cached indefinitely (immutable content)
- Thread summaries cached for 30 days (updated when new messages arrive)
- Summaries stored in both `emails.summary_short/full` and `thread_summaries` table

### Chat Agent & RAG Pipeline

#### Multi-Step RAG Architecture

```
User Query
    │
    ├─→ [Query Intent Detection]
    │   ├─ Is this about a specific sender?
    │   ├─ Is this about a specific topic/date range?
    │   ├─ Is this asking for synthesis across threads?
    │   └─ Is this asking for categorized results?
    │
    ├─→ [Embedding Generation]
    │   Query → embedding vector (1536 dims)
    │
    ├─→ [Semantic Search]
    │   pgvector: Find top-k emails by cosine similarity
    │   Filter by: date range, sender, category (if applicable)
    │   Retrieve: Top 10-20 emails
    │
    ├─→ [Relevance Reranking] (optional, for expensive queries)
    │   NIM fast classifier: "Is this email relevant?"
    │   Reorder by relevance, keep top-5
    │
    ├─→ [Context Assembly]
    │   ├─ For individual email queries: Include email + summary
    │   ├─ For thread queries: Include full thread with timestamps
    │   ├─ For cross-email synthesis: Include all emails grouped by sender
    │
    ├─→ [Prompt Assembly]
    │   "Based on these emails [list sources], answer: [query]"
    │   "If information is not in the emails, say 'Not found in emails'"
    │
    ├─→ [Gemini Reasoning]
    │   Generate response with source attribution
    │   Format: "From [email_from] on [date]: [quote/fact]"
    │
    └─→ [Response + Sources]
        User sees: Answer + list of source emails
        Chat history: Stores retrieved_email_ids + reasoning
```

#### Source Clarity & Attribution

Every response includes:
1. **Direct Quotes** — When applicable, pull exact text from source email
2. **Email Metadata** — Show From, Date, Subject for context
3. **Thread Links** — Link back to the original thread in the UI
4. **Confidence Indicator** — "Directly stated in emails" vs. "Inferred from context"

Example response structure:
```
Q: "Which companies rejected my job application?"
A: "Based on your emails, these companies have rejected your application:

1. **Acme Corp** — Rejection email from hr@acme.com on June 15, 2024
   Subject: 'Application Status Update - Senior Engineer Role'
   [Quote: 'We regret to inform you...']

2. **TechFlow Inc** — Rejection email from careers@techflow.io on June 10, 2024
   [Quote: 'We have decided to move forward with other candidates...']

Sources: 2 emails, 2 senders"
```

#### Hallucination Prevention

1. **Explicit Scope Limiting**:
   - Prompt: "Answer ONLY based on these emails. If the answer is not in the emails, say 'Not found in your emails.'"
   - System check: Verify that every fact in the response comes from at least one retrieved email

2. **Consistency Checking**:
   - If multiple emails say conflicting things (e.g., two different meeting times), the agent flags the conflict and shows both
   - Never automatically resolves ambiguities

3. **Confidence Scoring**:
   - Low confidence if semantic search retrieves dissimilar emails (cosine similarity < 0.6)
   - Alert user: "I found some emails, but I'm not highly confident in the match"

4. **Fallback Behavior**:
   - If no relevant emails found: "I couldn't find emails matching your query. Try refining with specific sender, date, or keywords."

### Email Categorization

#### Two-Stage Classification

**Stage 1: Fast Rule-Based + NIM Classifier**
```
Email arrives → Immediate categorization
  ├─ Rule-based checks:
  │  ├─ From "@domain.com" (company domain) → Work (high confidence)
  │  ├─ From unsubscribe/marketing patterns → Newsletters
  │  ├─ From "no-reply@" and OTP/code patterns → Notifications
  │  └─ From banking/payment services → Finance
  │
  └─ If no rule match → NIM classifier
     ├─ Input: Subject + first 200 chars of body
     ├─ Output: [Work, Personal, Newsletters, Finance, Recruitment, Notifications]
     └─ Confidence score + selected category
```

**Stage 2: Gemini Refinement (Async)**
```
After email categorized:
  ├─ Background worker picks up email
  ├─ Passes full email + current category to Gemini
  ├─ Gemini evaluates: "Is this really a [category]?"
  ├─ Gemini can override or confirm NIM decision
  └─ Update database with refined category + timestamp
```

**Why two models?**
- **NIM**: Fast, free-tier, optimized for classification tasks — good for real-time first-pass
- **Gemini**: Slower, more capable reasoning — used for edge cases and refinement

### Choice of NVIDIA NIM

- **Why NIM?** — Free tier available, decent performance on text classification, lightweight inference
- **Specific Model** — `meta/llama-2-7b-chat-quantized` or `nvidia/nemotron-3-8b-chat-128k` (lightweight, classifies well)
- **Role** — Secondary classifier, real-time categorization, and relevance reranking for RAG
- **Trade-off** — Faster than Gemini but less sophisticated; used for high-volume classification tasks

---

## 4. Gmail API Strategy

### OAuth 2.0 Flow

```
User clicks "Connect Gmail"
    │
    ├─→ Backend generates authorization URL
    │   Scopes: 
    │   - https://www.googleapis.com/auth/gmail.readonly
    │   - https://www.googleapis.com/auth/gmail.modify
    │   - https://www.googleapis.com/auth/gmail.send
    │
    ├─→ User redirected to Google login
    │   User grants permissions
    │
    ├─→ Google redirects to /auth/callback?code=[code]
    │
    ├─→ Backend exchanges code for tokens
    │   Stores: access_token, refresh_token
    │   Encrypts: refresh_token in database
    │
    └─→ Backend creates JWT, redirects to dashboard
```

### Initial Sync vs. Incremental Sync

#### Initial Sync (First Time)
```
1. Fetch list of labels (for categorization)
2. Start from most recent email, page backward
   ├─ Batch size: 100 emails per API call
   ├─ Pages: Configurable limit (default 10 pages = ~1000 emails)
   ├─ Rate limit: 1 request per 100ms (safe margin)
   └─ Backoff: Exponential on 429 responses
3. For each email:
   ├─ Fetch full content (headers, body, attachments)
   ├─ Extract thread information
   ├─ Store in database
4. Mark as complete: users.sync_state.initial_sync_complete = true
```

**Pagination Details:**
- Gmail uses `pageToken` for pagination
- Each page lists message metadata; full message requires separate API call
- Optimize: Batch full-message fetches (max 100 per batch with `batch/gmail/v1/users/me/messages`)

#### Incremental Sync (Background, Every 5 min)
```
Every 5 minutes (configurable):
  ├─ Check: users.last_sync_at vs. NOW()
  ├─ If > 5 min, trigger sync worker
  │
  └─→ Query Gmail: q=newer_than:[last_sync_at_unix]
      ├─ Fetch only new message IDs
      ├─ For each new ID: Fetch full message + thread context
      ├─ Store new emails and link to existing threads
      ├─ Mark processed emails in sync_state
      └─ Update users.last_sync_at
```

### Rate Limiting & Quota Management

**Gmail API Quotas:**
- 250 requests per user per second (hard limit)
- 5 billion requests per day per project (soft limit)
- Our strategy: Target ~60 requests per minute (safe margin)

**Implementation:**

```
Rate Limiter Middleware:
  ├─ Token bucket algorithm
  │  ├─ Capacity: 60 tokens
  │  ├─ Refill rate: 1 token per second
  │  └─ Cost per request: 1 token
  │
  ├─ On rate limit (429 response):
  │  ├─ Backoff strategy:
  │  │  ├─ Attempt 1: wait 1s
  │  │  ├─ Attempt 2: wait 2s
  │  │  ├─ Attempt 3: wait 4s
  │  │  ├─ ...
  │  │  └─ Max retry: 5 times
  │  │
  │  └─ If exhausted: Queue for later, notify user
  │
  └─ Monitoring:
     ├─ Log: Requests made, quota remaining
     ├─ Alert: If quota drops below 10%
     └─ Pause sync if quota < 1%
```

**Batch Operations:**
- Gmail's `/batch/gmail/v1/users/me/messages` allows fetching multiple full messages in one request
- Use this for incremental sync to minimize API calls

---

## 5. Tool & Technology Decisions

### Backend: Express.js + Node.js

**Why?**
- Lightweight, fast for I/O-heavy operations (Gmail API, database queries)
- Easy integration with async/background jobs (Bull for queues)
- Rich ecosystem for authentication, validation, and logging

**Key Libraries:**
- `express` — Web framework
- `@google-auth-library/oauth2-client` — OAuth 2.0
- `bull` — Background job queue on Redis
- `pg` + `node-postgres` — Database access
- `ioredis` — Redis client
- `axios` — HTTP client for Gemini & NIM APIs
- `jsonwebtoken` — JWT auth
- `dotenv` — Environment variable management

### Frontend: React + TypeScript

**Why?**
- Component-based architecture suits email UI (list, detail, compose panels)
- Real-time updates via WebSockets for live chat
- Strong TypeScript support for type safety

**Key Libraries:**
- `react` — UI framework
- `react-router-dom` — Routing
- `zustand` or `redux` — State management
- `axios` — API calls
- `socket.io-client` — WebSocket for chat
- `react-markdown` — Render formatted email content
- `date-fns` — Date formatting

### Database: Supabase (PostgreSQL + pgvector)

**Why?**
- Managed PostgreSQL with built-in pgvector extension
- No separate vector database needed
- Handles encryption (pgcrypto) and row-level security (RLS)
- Simple pricing, generous free tier

**Advantages over Alternatives:**
- **vs. Weaviate/Pinecone:** Supabase combines relational + vector in one database, reducing complexity
- **vs. Firebase:** PostgreSQL is more powerful for complex queries (threads, categories)
- **vs. Self-hosted:** Managed service eliminates DevOps overhead

### Background Job Queue: Bull (Redis-backed)

**Why?**
- Simple API for async tasks
- Reliable retry logic and exponential backoff
- Built on Redis, which is fast and well-tested
- Good monitoring via Bull Dashboard UI

**Job Types:**
1. **Sync Gmail** — Runs every 5 minutes
2. **Generate Embeddings** — Batches 25 emails at a time
3. **Categorize Emails** — Runs async after sync
4. **Pre-compute Summaries** — Low priority, runs when queue is quiet

### AI Models: Gemini + NIM

**Gemini (Primary):**
- Used for: Summarization, reply drafting, main reasoning
- Model: `gemini-1.5-pro` (handles long context, good reasoning)
- Why: Best-in-class LLM, strong at understanding email nuances

**NVIDIA NIM (Secondary):**
- Used for: Real-time classification, fast reranking
- Model: Llama 2 7B or Nemotron 3 8B (quantized, free tier)
- Why: Fast, lightweight, suitable for high-frequency classification

### Embedding Model: text-embedding-3-small

- Dimensions: 1536
- Why: Good quality-to-cost ratio; widely compatible with pgvector
- Cost: Free tier available via Google/OpenAI APIs

---

## 6. Trade-offs & Limitations

### What We Deliberately Didn't Build

#### 1. **Full Gmail Label Management**
- **Current**: Sync Gmail labels as metadata, no two-way sync of our categories back to Gmail labels
- **Why**: Adds complexity; our categories (Work, Personal, etc.) are platform-specific, not aligned with Gmail's label system
- **Future**: Implement if users want automatic Gmail label application

#### 2. **Attachment Handling**
- **Current**: Store attachment metadata (size, type, filename) but not the file content
- **Why**: Files are large; storing in database is expensive. Better to fetch on-demand from Gmail API.
- **Future**: Implement S3 storage for common file types (PDF, images)

#### 3. **Advanced Scheduling & Send Later**
- **Current**: Drafts are always "ready to send now"
- **Why**: Email scheduling adds complexity to Gmail API + job queue management
- **Future**: Optional feature after MVP

#### 4. **Multi-Account Support**
- **Current**: Single Gmail account per user
- **Why**: Schema supports it (user_id), but UI/UX for switching accounts is non-trivial
- **Future**: Phase 2

#### 5. **Conversation Streaming**
- **Current**: Chat responses are generated fully, then shown to user
- **Why**: Simpler implementation; users can see response in 2-3 seconds anyway
- **Future**: Implement WebSocket streaming for longer responses (20+ seconds)

#### 6. **Advanced NLP: Sentiment Analysis, Entity Recognition**
- **Current**: Not implemented
- **Why**: Out of scope for MVP; basic categorization + summarization cover core needs
- **Future**: If users want to analyze email tone or extract action items

### Known Limitations

#### 1. **Large Inbox Sync**
- **Issue**: Initial sync of 10,000+ emails will take time (1000 emails ≈ 10-15 minutes)
- **Reason**: Gmail API rate limits + network latency
- **Mitigation**: Limit initial sync to last 30 days (configurable); offer background sync for older emails

#### 2. **Semantic Search Accuracy**
- **Issue**: Cosine similarity may retrieve tangentially related emails
- **Reason**: Embedding model is general-purpose, not email-specific
- **Mitigation**: Reranking with NIM; user can refine search with more specific terms

#### 3. **Hallucination in Edge Cases**
- **Issue**: If two emails discuss different topics with similar language, agent may conflate them
- **Reason**: LLM's inherent tendency to infer connections
- **Mitigation**: Source attribution and explicit conflict flagging when contradictions are detected

#### 4. **Cost Scaling**
- **Issue**: Embedding cost grows with email volume (1M emails = significant API spend)
- **Reason**: Each embedding call incurs cost
- **Mitigation**: Cache embeddings; only regenerate on user request or re-categorization

#### 5. **Privacy: Emails Processed by AI APIs**
- **Issue**: Emails are sent to Google Gemini + NVIDIA NIM for processing
- **Reason**: No way to avoid if we want AI capabilities
- **Mitigation**: 
  - Clear user consent on login
  - No long-term retention of emails by Gemini/NIM APIs (use their ephemeral APIs)
  - Future: On-premise LLM option for privacy-conscious users

### Performance Trade-offs

| Decision | Trade-off |
|----------|-----------|
| **Cache thread summaries for 30 days** | Summaries may be stale if new emails arrive; recalculate on demand if needed |
| **Batch email sync instead of streaming** | Slight delay (5-10 seconds) before new emails appear; reduces API overhead |
| **Rerank only top-20 results** | Fastest, but may miss relevance of emails ranked 20-50; good enough for MVP |
| **NIM for categorization, Gemini for refinement** | Two-stage process is slower than one-stage Gemini; justified by cost savings |
| **Incremental sync every 5 minutes** | New emails visible within 5-10 minutes, not real-time; acceptable for email use case |

### Timeline for Missing Features

**If more time available (prioritized):**
1. Streaming chat responses (20% extra effort)
2. Attachment S3 storage (30% extra effort)
3. Multi-account support (25% extra effort)
4. Email scheduling (40% extra effort)
5. Advanced NLP features (50% extra effort)

---

## Conclusion

This architecture balances **functionality, cost, and complexity** for a working MVP. The design is modular—each component can be independently improved or swapped without affecting others. The use of Supabase + pgvector eliminates the need for a separate vector database, reducing operational overhead. The two-tier AI approach (NIM + Gemini) optimizes for both speed and quality.

The implementation prioritizes **doing core features well** (Gmail sync, summarization, RAG-based chat) over building many half-baked features. The system is designed to scale gracefully—background workers handle async tasks, rate limiting protects against API quota exhaustion, and the schema supports 100K+ emails without performance degradation.
