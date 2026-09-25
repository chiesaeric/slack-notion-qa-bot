require('dotenv').config();
const { App } = require('@slack/bolt');
const { handleCreateTaskModal, handleModalSubmit } = require('../views/modals');
const { createNotionTask } = require('../utils/notion');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || 'C07XXXXXXXXX';

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
// MODAL SUBMISSION HANDLER
// ============================================
app.view('create_task_modal', async ({ ack, body, client }) => {
  await ack();

  const userId = body.user.id;
  const channelId = body.container.channel_id;
  const threadTs = body.container.thread_ts || body.container.message_ts;

  // Parse values from modal submission
  const values = body.view.state.values;
  
  const taskName = values.task_name_block?.task_name_input?.value || '';
  const description = values.description_block?.description_input?.value || '';
  const priority = values.priority_block?.priority_input?.selected_option?.value || 'Medium';
  const dueDate = values.due_date_block?.due_date_input?.selected_date || null;
  const assignee = values.assignee_block?.assignee_input?.selected_users || [];
  const labels = values.labels_block?.labels_input?.selected_conversations || [];

  try {
    // Insert to Notion
    const notionResult = await createNotionTask({
      taskName,
      description,
      priority,
      dueDate,
      assignee,
      labels,
    });

    // Reply to thread
    const priorityEmoji = priority === 'High' ? '🔴' : priority === 'Medium' ? '🟡' : '🟢';
    
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `✅ *Task created!*\n> *Name:* ${taskName}\n> *Priority:* ${priorityEmoji} ${priority}\n> *Notion Page:* ${notionResult.url}`,
    });

  } catch (error) {
    console.error('Error creating task:', error);

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `❌ *Failed to create task*\n> Error: ${error.message}`,
    });
  }
});

// ============================================
// HOME TAB (optional - for quick access)
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
