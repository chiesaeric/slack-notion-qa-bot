# QA Slack Bot - Create Tasks via Modal → Notion

Slack bot yang menerima command `/qa-bot-create-task` di thread, menampilkan modal untuk fill task data, dan auto-insert ke Notion Database.

## Architecture

```
User: /qa-bot-create-task (thread)
         ↓
    Slack Modal Opens
         ↓
    User fills & submits
         ↓
    Backend receives payload
         ↓
    Insert to Notion Database
         ↓
    Bot replies: "✅ Task created!"
```

## Prerequisites

- Node.js 18+
- Slack Workspace (admin access to create app)
- Notion Account (with API integration)
- ngrok (untuk local development webhook)

## Setup

### 1. Clone & Install

```bash
cd slack-notion-bot
npm install
```

### 2. Create Slack App

1. Buka https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name: `qa-bot` → Pick your workspace
4. **Basic Information** → Copy:
   - `Signing Secret` → your `.env`
   - `App-Level Tokens` → Generate with `authorization:read` scope → Copy → your `.env` as `SLACK_APP_TOKEN`

### 3. Enable Features

#### a. Slash Commands
1. **Slash Commands** → **Create New Command**
2. Fill:
   - Command: `/qa-bot-create-task`
   - Request URL: `https://your-domain.com/slack/events`
   - Description: `Create a QA task in Notion`
3. Save

#### b. Interactivity
1. **Interactivity & Shortcuts** → Toggle ON
2. Request URL: `https://your-domain.com/slack/events`
3. Save

#### c. Permissions
1. **OAuth & Permissions** → **Bot Token Scopes** → Add:
   - `chat:write`
   - `commands`
   - `im:write`
   - `app_mentions:read`
2. **Install to Workspace** → Copy `Bot User OAuth Token` → your `.env` as `SLACK_BOT_TOKEN`

#### d. Socket Mode
1. **Socket Mode** → Toggle ON
2. Use your App-Level Token from step 2

### 4. Setup Notion Integration

1. Buka https://www.notion.so/my-integrations
2. **New integration** → Name: `qa-bot`
3. Select workspace → Enable **Read content** and **Update content**
4. Copy **Internal Integration Token** → your `.env` as `NOTION_API_KEY`

5. **Create Notion Database** with these properties:
   - `Name` (title) - Task name
   - `Description` (text) - Optional
   - `Priority` (select) - High / Medium / Low
   - `Due Date` (date) - Optional
   - `Assignee` (people) - Optional
   - `Labels` (multi-select) - Optional

6. Open your Database → **Share** → Invite `qa-bot` integration
7. Copy Database ID from URL → your `.env` as `NOTION_DATABASE_ID`
   - URL format: `notion.so/{workspace}/{DATABASE_ID}?v=...`

### 5. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
NOTION_API_KEY=secret_your-notion-token
NOTION_DATABASE_ID=your-database-id
PORT=3000
```

### 6. Run

```bash
npm start
# ⚡ QA Slack Bot is running!
```

### 7. Expose to Internet (Development)

```bash
ngrok http 3000
```

Copy HTTPS URL → Update Slack App:
- **Slash Command** → Request URL: `https://your-ngrok-url.slack/events`
- **Interactivity** → Request URL: `https://your-ngrok-url/slack/events`

### 8. Test

1. Buka Slack → Channel apapun
2. Buat thread (atau reply di existing thread)
3. Ketik `/qa-bot-create-task`
4. Modal muncul → Fill data → Submit
5. Task terbuat di Notion → Bot reply confirmation

## Project Structure

```
slack-notion-bot/
├── app/
│   └── index.js          # Main app - Slack handlers
├── views/
│   └── modals.js         # Modal view definitions
├── utils/
│   └── notion.js         # Notion API integration
├── .env.example          # Environment template
├── package.json
└── README.md
```

## Customization

### Modify Modal Fields
Edit `views/modals.js` → `handleCreateTaskModal()`

### Modify Notion Properties
Edit `utils/notion.js` → `createNotionTask()` → match your DB schema

### Change Command Name
Edit `app/index.js` → `app.command('/qa-bot-create-task', ...)`

## Troubleshooting

| Error | Solution |
|-------|----------|
| `App home not installed` | Install app to workspace first |
| `channel_not_found` | Check `SLACK_CHANNEL_ID` env |
| `notion validation error` | Match property names with your DB schema |
| `interactive component not enabled` | Enable Interactivity in app settings |

## Production Deployment

For production, deploy to:
- **Railway** (`railway.app`)
- **Render** (`render.com`)
- **AWS Lambda + API Gateway** (with Serverless framework)

Update Slack App Request URLs to your production domain.
