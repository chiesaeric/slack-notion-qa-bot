# QA Slack Bot

Slack bot untuk QA workflow: create task, update task status, dan submit test report via modal → Notion integration dengan Google Sheets untuk test coverage data.

## Features

- **Create Task** - `/qa-bot-create-task` - Buat task di Notion dari thread Slack
- **Update Task** - `/qa-bot-update-task` - Update status, progress, dan test case
- **Report Task** - `/qa-bot-report-task` - Submit test coverage report dari Google Sheets
- **Slack User Mapping** - Assignee menggunakan Slack person picker, auto-convert ke Notion user ID

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
- Google Cloud Project (for Sheets API)
- ngrok (untuk local development)

## Slack App Setup

### 1. Create Slack App

1. Buka https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Name: `qa-bot` → Pick your workspace

### 2. Enable Features

#### Socket Mode
1. **Socket Mode** → Toggle **ON**
2. **Basic Information** → **App-Level Tokens** → Generate with scope `connections:write`
3. Copy token → your `.env` as `SLACK_APP_TOKEN`

#### Interactivity
1. **Interactivity & Shortcuts** → Toggle **ON**
2. Request URL: `https://your-domain.com/slack/events`

#### Slash Commands
Create these commands:

| Command | Description | Request URL |
|---------|-------------|-------------|
| `/qa-bot-create-task` | Create a new QA task in Notion | `https://your-domain.com/slack/events` |
| `/qa-bot-update-task` | Update task status and progress | `https://your-domain.com/slack/events` |
| `/qa-bot-report-task` | Submit test coverage report | `https://your-domain.com/slack/events` |

### 3. Permissions (OAuth & Permissions)

#### Bot Token Scopes
Add these **Bot Token Scopes**:

| Scope | Description |
|-------|-------------|
| `chat:write` | Post messages to channels |
| `chat:write.public` | Post messages to public channels |
| `commands` | Create slash commands |
| `im:write` | Send direct messages |
| `im:read` | Read direct messages |
| `im:history` | Read direct message history |
| `mpim:write` | Send group messages |
| `mpim:history` | Read group message history |
| `channels:history` | Read channel history |
| `groups:history` | Read private channel history |
| `app_mentions:read` | Read app mentions |
| `files:read` | Read files |
| `files:write` | Upload files |
| `users:read` | Read user profiles |

#### User Token Scopes (if needed)
Add **User Token Scopes**:

| Scope | Description |
|-------|-------------|
| `channels:history` | Read public channel messages |
| `groups:history` | Read private channel messages |
| `im:history` | Read DM history |
| `mpim:history` | Read group DM history |
| `users:read` | Read user profiles |

### 4. Install App

1. **Install App** → **Install to Workspace**
2. Copy **Bot User OAuth Token** → your `.env` as `SLACK_BOT_TOKEN`
3. Copy **User OAuth Token** → your `.env` as `SLACK_USER_TOKEN` (if using user token)

### 5. App Home

1. **App Home** → Enable **Home Tab** and **Messages Tab**

## Notion Integration

### 1. Create Integration

1. Buka https://www.notion.so/my-integrations
2. **New integration** → Name: `qa-bot`
3. Select workspace → Enable:
   - `Read content`
   - `Update content`
   - `Insert content`
4. Copy **Internal Integration Token** → your `.env` as `NOTION_API_KEY`

### 2. Create Notion Database

Create a database with these properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `Name` | Title | Yes | Task name |
| `Status` | Status | Yes | Not Started, Created Test Plan, In Prestaging, In Staging, Ready to Release, Released |
| `Description` | Text | No | Task description |
| `Priority` | Select | No | High, Medium, Low |
| `Due Date` | Date | No | Task due date |
| `Assignee` | People | No | Assigned person(s) |
| `Labels` | Multi-select | No | Tags/labels |
| `Slack Thread` | URL | No | Link to Slack thread |
| `Test Case` | URL | No | Link to test case spreadsheet |
| `Progress` | Number | No | Progress percentage (0-100) |

### 3. Share Database

1. Open your Database
2. Click **Share** → Invite `qa-bot` integration
3. Copy Database ID from URL → your `.env` as `NOTION_DATABASE_ID`
   - URL format: `notion.so/{workspace}/{DATABASE_ID}?v=...`

## Google Sheets Integration

### 1. Create Google Cloud Project

1. Go to https://console.cloud.google.com
2. Create new project
3. Enable **Google Sheets API**

### 2. Create Service Account

1. **IAM & Admin** → **Service Accounts** → Create
2. Generate **JSON key** → download as `google-credentials.json`
3. Copy content to your `.env` as `GOOGLE_CREDENTIALS`

### 3. Share Spreadsheet

1. Open your test case spreadsheet
2. Share with service account email (from JSON)
3. Ensure service account has **Viewer** or **Editor** access

### 4. Environment Variable

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## User Mapping (Slack → Notion)

Create `slack_notion_user_map.json` for assignee mapping:

```json
{
  "U0C57TKBLDN": "be7693993f7e82dd903381e117527a99",
  "U0C4KS6UKQ9": "xyz789uvw012"
}
```

- **Key**: Slack User ID
- **Value**: Notion User ID

### Get Notion User ID
1. Open Notion → Click avatar
2. Copy link URL - format: `notion.so/{workspace}/{USER_ID}`

### Get Slack User ID
1. Slack → Click user → **Copy member ID**
2. Or from user profile URL

## Environment Setup

```bash
cp .env.example .env
# Edit .env with your values
```

### Required Variables

```env
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_USER_TOKEN=xoxp-your-user-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# Notion
NOTION_API_KEY=secret_your-notion-token
NOTION_DATABASE_ID=your-database-id

# Google Sheets
GOOGLE_CREDENTIALS={"type":"service_account",...}
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Project Structure

```
slack-notion-bot/
├── app/
│   └── index.js              # Main app - Slack handlers, modal logic
├── utils/
│   ├── notion.js             # Notion API client
│   └── googleSheets.js       # Google Sheets API client
├── views/
│   └── modals.js             # Modal view definitions
├── scripts/
│   └── setup-sheets.js       # Google Sheets setup helper
├── tests/
│   └── bot.test.js           # Unit tests
├── .env.example              # Environment template
├── .gitignore
├── package.json
└── README.md
```

## Commands

| Command | Description |
|---------|-------------|
| `/qa-bot-create-task` | Create new task from thread |
| `/qa-bot-update-task` | Update existing task status |
| `/qa-bot-report-task` | Submit test coverage report |

## Workflows

### Create Task Flow
1. User triggers `/qa-bot-create-task` in a thread
2. Bot opens modal (Modal 1)
3. User pastes thread link → Bot extracts data from messages
4. Modal 2 opens with pre-filled data
5. User confirms/edits → Submit
6. Task created in Notion → Bot replies in thread

### Update Task Flow
1. User triggers `/qa-bot-update-task`
2. Bot opens modal (Modal 1)
3. User pastes Notion page link → Bot fetches current data
4. Modal 2 opens with current status/progress
5. User selects new status → Branch to different flows:
   - **Created Test Plan** → Modal 3 (Progress + Test Case URL)
   - **In Prestaging/In Staging** → Modal 3 (Coverage input)
   - **Ready to Release/Released** → Direct update
6. Task updated in Notion → Bot replies in thread

### Report Task Flow
1. User triggers `/qa-bot-report-task`
2. Bot opens modal
3. User pastes Notion page link + Sheet name
4. Bot fetches coverage from Google Sheets
5. Report generated → Posted to thread + Notion page

## Troubleshooting

| Error | Solution |
|-------|----------|
| `App home not installed` | Install app to workspace first |
| `channel_not_found` | Check `SLACK_CHANNEL_ID` env |
| `notion validation error` | Match property names with your DB schema |
| `interactive component not enabled` | Enable Interactivity in app settings |
| `invalid_trigger_id` | Modal push timeout - reduce fetch time or simplify view |
| `Could not fetch coverage data` | Check Google Sheets sharing settings |
| `Sheet name is required` | Enter sheet name for In Prestaging/In Staging status |
| `Sheet Name is required because this task has a Test Case` | Test case URL exists in Notion, sheet name is mandatory |

## Development

### Run Locally

```bash
# Install dependencies
npm install

# Start bot
npm start

# Development mode (auto-reload)
npm run dev
```

### Expose to Internet (Development)

```bash
ngrok http 3000
```

Copy HTTPS URL → Update Slack App:
- **Slash Command** → Request URL: `https://your-ngrok-url.slack/events`
- **Interactivity** → Request URL: `https://your-ngrok-url/slack/events`

## Production Deployment

Recommended platforms:
- **Railway** (`railway.app`)
- **Render** (`render.com`)
- **AWS Lambda + API Gateway** (with Serverless framework)

Update Slack App Request URLs to your production domain.

## License

MIT
