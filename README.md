# AI-powered Gmail Intelligence Platform

An intelligent Gmail assistant that syncs your emails, summarizes conversations, drafts replies, and provides AI-driven insights through a conversational chat agent.

## ✨ Features

- **Gmail Integration** — OAuth 2.0 authentication, secure email sync with pagination and rate limiting
- **Email Summarization** — Context-aware summaries for individual emails and full threads
- **AI-Powered Replies** — Draft professional emails and replies with full thread context
- **Email Categorization** — Automatic classification into Work, Personal, Newsletters, Finance, Recruitment, Notifications
- **Chat Agent** — Conversational assistant that reasons over your entire email knowledge base
- **Newsletter Deduplication** — Deduplicate news items across multiple sources using semantic similarity
- **Thread Awareness** — All features operate on threads as first-class objects

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (via Supabase)
- Google Cloud Project with Gmail API enabled
- Google Gemini API key
- NVIDIA NIM API key (free tier)

### Installation

```bash
# Clone the repository
git clone https://github.com/Anji-yadav/AI-powered-Gmail-intelligence-platform-.git
cd AI-powered-Gmail-intelligence-platform-

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Copy environment template
cp .env.example .env
cp frontend/.env.example frontend/.env
```

### Configuration

Edit `.env` and `frontend/.env` with:

```
# Backend (.env)
DATABASE_URL=postgresql://user:password@host/dbname
GMAIL_CLIENT_ID=your_google_oauth_client_id
GMAIL_CLIENT_SECRET=your_google_oauth_secret
GMAIL_REDIRECT_URI=http://localhost:5000/auth/callback
GEMINI_API_KEY=your_gemini_api_key
NVIDIA_NIM_API_KEY=your_nvidia_nim_key
JWT_SECRET=your_jwt_secret
PORT=5000

# Frontend (.env)
REACT_APP_API_URL=http://localhost:5000
```

### Running Locally

```bash
# Terminal 1: Start backend
npm run dev

# Terminal 2: Start frontend
cd frontend && npm start
```

The application will be available at `http://localhost:3000`.

## 📁 Project Structure

```
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── auth.js              # OAuth 2.0 flow
│   │   │   ├── emails.js            # Gmail sync & retrieval
│   │   │   ├── chat.js              # Chat agent endpoints
│   │   │   └── compose.js           # Email composition
│   │   ├── services/
│   │   │   ├── gmail.js             # Gmail API client
│   │   │   ├── gemini.js            # Google Gemini integration
│   │   │   ├── nim.js               # NVIDIA NIM integration
│   │   │   ├── embeddings.js        # Vector embeddings
│   │   │   ├── categorizer.js       # Email categorization
│   │   │   └── rag.js               # RAG pipeline
│   │   ├── models/
│   │   │   ├── email.js             # Email schema & queries
│   │   │   ├── thread.js            # Thread schema & queries
│   │   │   └── chat.js              # Chat history schema
│   │   ├── utils/
│   │   │   ├── rateLimiter.js       # Gmail quota management
│   │   │   ├── db.js                # Database connection
│   │   │   └── logger.js            # Logging utility
│   │   └── index.js                 # Express app setup
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── EmailList.jsx
│   │   │   ├── EmailViewer.jsx
│   │   │   ├── ChatAgent.jsx
│   │   │   ├── ComposeEmail.jsx
│   │   │   └── Sidebar.jsx
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   └── ChatPage.jsx
│   │   ├── hooks/
│   │   │   ├── useEmails.js
│   │   │   ├── useChat.js
│   │   │   └── useAuth.js
│   │   ├── styles/
│   │   │   └── index.css
│   │   └── App.jsx
│   ├── .env.example
│   └── package.json
├── Architecture.md                   # Design & system documentation
├── .env.example
└── package.json
```

## 🏗️ Architecture Highlights

### System Design
- **Frontend**: React with real-time updates via WebSockets
- **Backend**: Express.js with async job queue for heavy operations
- **Database**: Supabase (PostgreSQL + pgvector for semantic search)
- **AI Models**: Google Gemini (primary), NVIDIA NIM (secondary classification)
- **Authentication**: OAuth 2.0 with JWT tokens

### Key Features Implementation

**Gmail Sync**
- Incremental sync strategy to minimize API calls
- Exponential backoff for rate limiting (429 responses)
- Batch processing with pagination for large inboxes
- Thread-level message grouping

**Email Summarization**
- Uses Gemini's long-context window for full thread summaries
- Individual email summaries cached for performance
- Thread context preserved through message linking

**Chat Agent (RAG Pipeline)**
- Vector embeddings stored in pgvector
- Semantic search to find relevant emails
- Multi-step reasoning with cross-thread synthesis
- Source attribution for all answers

**Categorization**
- NVIDIA NIM for primary classification
- Rule-based secondary filtering
- User feedback loop for accuracy improvement

See `Architecture.md` for detailed design decisions.

## 📊 Database Schema

Core tables:
- `users` — Authentication and sync state
- `threads` — Email thread grouping
- `emails` — Individual email messages with vector embeddings
- `email_categories` — Classification labels
- `chat_history` — Conversation logs
- `email_embeddings` — pgvector embeddings for semantic search

## 🔒 Security

- OAuth tokens stored encrypted in Supabase
- JWT for session management
- No plaintext credentials in code
- Rate limiting to prevent abuse
- Input validation on all endpoints

## 🚢 Deployment

### Vercel (Frontend)
```bash
cd frontend
vercel deploy
```

### Heroku/Railway (Backend)
```bash
git push heroku main
```

Ensure all environment variables are set in your hosting platform.

## 📝 Environment Variables

See `.env.example` for complete list with descriptions.

## 🧪 Testing

```bash
npm run test          # Backend tests
cd frontend && npm test  # Frontend tests
```

## 📚 Documentation

- **Architecture.md** — System design, data modeling, AI pipeline, trade-offs
- **API.md** — Endpoint documentation (if added)

## 🤝 Contributing

This is a technical assessment project. Direct contributions should go through pull requests.

## 📄 License

MIT

## 🙋 Support

For issues or questions, open a GitHub issue in this repository.

---

**Submission Deadline:** June 19th, 10:00 PM, 2026
