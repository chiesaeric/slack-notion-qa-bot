require('dotenv').config();
const { App } = require('@slack/bolt');
const { handleCreateTaskModal } = require('../views/modals');
const { createNotionTask } = require('../utils/notion');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// User token for reading thread messages
const userToken = process.env.SLACK_USER_TOKEN;

// ============================================
// HELPER: Extract data from thread messages
// ============================================
function extractDataFromThread(messages) {
  let projectName = '';
  let dueDate = '';
  
  // Combine all message texts
  const fullText = messages.map(m => m.text || '').join(' ');
  
  // Pattern untuk project name
  const projectPatterns = [
    /project[:\s]+([^\n,]+)/i,
    /nama\s*project[:\s]+([^\n,]+)/i,
    /project\s*name[:\s]+([^\n,]+)/i,
  ];
  
  for (const pattern of projectPatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      projectName = match[1].trim();
      break;
    }
  }
  
  // Pattern untuk due date (YYYY-MM-DD or DD-MM-YYYY or DD/MM/YYYY)
  const dueDatePatterns = [
    /due\s*date[:\s]+(\d{4}-\d{2}-\d{2})/i,
    /due[:\s]+(\d{4}-\d{2}-\d{2})/i,
    /deadline[:\s]+(\d{4}-\d{2}-\d{2})/i,
    /due[:\s]+(\d{2}-\d{2}-\d{4})/i,
    /due[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ];
  
  for (const pattern of dueDatePatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      dueDate = match[1].trim();
      // Convert DD-MM-YYYY or DD/MM/YYYY to YYYY-MM-DD
      if (dueDate.includes('-') && dueDate.split('-')[0].length === 2) {
        const [d, m, y] = dueDate.split('-');
        dueDate = `${y}-${m}-${d}`;
      } else if (dueDate.includes('/')) {
        const [d, m, y] = dueDate.split('/');
        dueDate = `${y}-${m}-${d}`;
      }
      break;
    }
  }
  
  return { projectName, dueDate };
}

// ============================================
// SLASH COMMAND: /qa-bot-create-task
// ============================================
app.command('/qa-bot-create-task', async ({ command, ack, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: handleCreateTaskModal(),
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

// ============================================
// APP MENTION IN THREAD
// Parse thread and respond with pre-filled button
// ============================================
app.event('app_mention', async ({ event, client }) => {
  const channelId = event.channel;
  const threadTs = event.thread_ts || event.event_ts;

  try {
    // Fetch thread messages using user token
    const threadReplies = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 20,
    }, { token: userToken });

    // Extract data from thread
    const messages = threadReplies.messages || [];
    const { projectName, dueDate } = extractDataFromThread(messages);

    // Prefilled data
    const prefilledData = {
      projectName: projectName || '',
      dueDate: dueDate || '',
    };

    // Reply in thread with a button
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Hi! Click the button below to create a QA task in Notion.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `👋 *QA Bot*\nCreate a new task in Notion by clicking the button below.${projectName || dueDate ? '\n\n📋 *Detected from thread:*' : ''}${projectName ? `\n• Project: ${projectName}` : ''}${dueDate ? `\n• Due Date: ${dueDate}` : ''}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '➕ Create Task',
                emoji: true,
              },
              action_id: 'create_task_button',
              style: 'primary',
              value: JSON.stringify(prefilledData),
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error('Error responding to app mention:', error);
  }
});

// ============================================
// BUTTON CLICK HANDLER - Opens Modal with Prefilled Data
// ============================================
app.action('create_task_button', async ({ ack, body, client }) => {
  await ack();

  try {
    // Parse prefilled data from button value
    let prefilledData = { projectName: '', dueDate: '' };
    try {
      if (body.actions && body.actions[0] && body.actions[0].value) {
        prefilledData = JSON.parse(body.actions[0].value);
      }
    } catch (e) {
      // Ignore parse errors, use empty data
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: handleCreateTaskModal({}, prefilledData),
    });
  } catch (error) {
    console.error('Error opening modal from button:', error);
  }
});

// ============================================
// MODAL SUBMISSION HANDLER
// ============================================
app.view('create_task_modal', async ({ ack, body, client }) => {
  const userId = body.user.id;
  
  const channelId = body.container?.channel_id;
  const threadTs = body.container?.thread_ts || body.container?.message_ts;

  const values = body.view.state.values;
  
  const taskName = values.task_name_block?.task_name_input?.value || '';
  const description = values.description_block?.description_input?.value || '';
  const priority = values.priority_block?.priority_input?.selected_option?.value || 'Medium';
  const dueDate = values.due_date_block?.due_date_input?.selected_date || null;
  const assignee = values.assignee_block?.assignee_input?.value || '';
  const labels = values.labels_block?.labels_input?.selected_conversations || [];

  const priorityEmoji = priority === 'High' ? '🔴' : priority === 'Medium' ? '🟡' : '🟢';

  try {
    const notionResult = await createNotionTask({
      taskName,
      description,
      priority,
      dueDate,
      assignee,
      labels,
    });

    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: '✅ Task Created',
          emoji: true,
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Task successfully created!*\n\n> *Name:* ${taskName}\n> *Priority:* ${priorityEmoji} ${priority}${assignee ? `\n> *Assignee:* ${assignee}` : ''}${dueDate ? `\n> *Due Date:* ${dueDate}` : ''}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🔗 *Notion Page:* <${notionResult.url}|Open in Notion>`,
            },
          },
        ],
        close: {
          type: 'plain_text',
          text: 'Close',
          emoji: true,
        },
      },
    });

    if (channelId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `✅ *Task created!*\n> *Name:* ${taskName}\n> *Priority:* ${priorityEmoji} ${priority}\n> *Notion Page:* ${notionResult.url}`,
      });
    }

  } catch (error) {
    console.error('Error creating task:', error);

    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: '❌ Error',
          emoji: true,
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Failed to create task*\n\n> Error: ${error.message}`,
            },
          },
        ],
        close: {
          type: 'plain_text',
          text: 'Close',
          emoji: true,
        },
      },
    });
  }
});

// ============================================
// HOME TAB
// ============================================
app.event('app_home_opened', async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*QA Bot*\nCreate tasks in Notion via Slack',
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Create Task',
                },
                action_id: 'open_create_modal',
              },
            ],
          },
        ],
      },
    });
  } catch (error) {
    console.error('Error publishing home tab:', error);
  }
});

// ============================================
// ACTION HANDLER (for home tab button)
// ============================================
app.action('open_create_modal', async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: handleCreateTaskModal(),
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

// ============================================
// START SERVER
// ============================================
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡ QA Slack Bot is running!');
})();
