require('dotenv').config();
const { App } = require('@slack/bolt');
const { handleCreateTaskModal, handleUpdateTaskModal, handleReportTaskModal } = require('../views/modals');
const { createNotionTask, updateNotionTaskStatus, getThreadLinkFromPage, getPageInfo, parseNotionPageUrl } = require('../utils/notion');
const { fetchTestCoverageData, parseSpreadsheetUrl } = require('../utils/googleSheets');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// User token for reading thread messages
const userToken = process.env.SLACK_USER_TOKEN;

// Store context per user for thread reply
// Key: user_id, Value: { channelId, threadTs, threadLink, notionPageId }
const modalContext = new Map();

// ============================================
// HELPER: Extract data from thread messages
// ============================================
function extractDataFromThread(messages) {
  let projectName = '';
  let dueDate = '';
  let description = '';
  
  const userMessages = messages.filter(m => !m.bot_id);
  const fullText = userMessages.map(m => m.text || '').join('\n');
  
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
  
  if (userMessages.length > 0) {
    const firstMsg = userMessages[0].text || '';
    description = firstMsg;
  }
  
  return { projectName, dueDate, description };
}

// ============================================
// HELPER: Parse Slack thread URL to get channel & thread ts
// ============================================
function parseThreadLink(threadLink) {
  const patterns = [
    /archives\/([A-Z0-9]+)\/p([A-Z0-9]+)/i,
    /channels\/([A-Z0-9]+)\/([0-9]+\.[0-9]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = threadLink.match(pattern);
    if (match) {
      return {
        channelId: match[1],
        threadTs: match[2].replace(/^0+/, '').replace(/(\d{10})(\d{6})/, '$1.$2'),
      };
    }
  }
  return null;
}

// ============================================
// SLASH COMMAND: /qa-bot-create-task
// ============================================
app.command('/qa-bot-create-task', async ({ command, ack, client }) => {
  await ack();

  modalContext.set(command.user_id, {
    channelId: command.channel_id,
    threadTs: '',
    threadLink: '',
    notionPageId: '',
  });

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
// SLASH COMMAND: /qa-bot-update-task
// ============================================
app.command('/qa-bot-update-task', async ({ command, ack, client }) => {
  await ack();

  modalContext.set(command.user_id, {
    channelId: command.channel_id,
    threadTs: '',
    notionPageId: '',
  });

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: handleUpdateTaskModal(),
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

// ============================================
// SLASH COMMAND: /qa-bot-report-task
// ============================================
app.command('/qa-bot-report-task', async ({ command, ack, client }) => {
  await ack();

  modalContext.set(command.user_id, {
    channelId: command.channel_id,
    threadTs: '',
    notionPageId: '',
  });

  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: handleReportTaskModal(),
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

// ============================================
// VIEW SUBMISSION - Create Task: Parse thread link
// ============================================
app.view('create_task_modal', async ({ ack, body, client }) => {
  const values = body.view.state.values;
  
  const threadLink = values.thread_link_block?.thread_link_input?.value || '';

  modalContext.set(body.user.id, {
    channelId: body.container?.channel_id || '',
    threadTs: body.container?.thread_ts || body.container?.message_ts || '',
    threadLink: threadLink,
    notionPageId: '',
  });

  if (!threadLink) {
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        callback_id: 'create_task_modal_final',
        title: { type: 'plain_text', text: 'Create QA Task', emoji: true },
        blocks: [
          {
            type: 'input',
            block_id: 'thread_link_block',
            element: {
              type: 'plain_text_input',
              action_id: 'thread_link_input',
              placeholder: { type: 'plain_text', text: 'Paste Slack thread link here...' },
            },
            label: { type: 'plain_text', text: 'Thread Link', emoji: true },
          },
          {
            type: 'input',
            block_id: 'task_name_block',
            element: {
              type: 'plain_text_input',
              action_id: 'task_name_input',
              placeholder: { type: 'plain_text', text: 'Enter task name...' },
            },
            label: { type: 'plain_text', text: 'Task Name *', emoji: true },
          },
          {
            type: 'input',
            block_id: 'description_block',
            element: {
              type: 'plain_text_input',
              action_id: 'description_input',
              placeholder: { type: 'plain_text', text: 'Enter task description...' },
              multiline: true,
            },
            label: { type: 'plain_text', text: 'Description', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'priority_block',
            element: {
              type: 'static_select',
              action_id: 'priority_input',
              placeholder: { type: 'plain_text', text: 'Select priority' },
              options: [
                { text: { type: 'plain_text', text: '🔴 High', emoji: true }, value: 'High' },
                { text: { type: 'plain_text', text: '🟡 Medium', emoji: true }, value: 'Medium' },
                { text: { type: 'plain_text', text: '🟢 Low', emoji: true }, value: 'Low' },
              ],
            },
            label: { type: 'plain_text', text: 'Priority *', emoji: true },
          },
          {
            type: 'input',
            block_id: 'due_date_block',
            element: {
              type: 'datepicker',
              action_id: 'due_date_input',
              placeholder: { type: 'plain_text', text: 'Select due date' },
            },
            label: { type: 'plain_text', text: 'Due Date', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'assignee_block',
            element: {
              type: 'plain_text_input',
              action_id: 'assignee_input',
              placeholder: { type: 'plain_text', text: 'Enter assignee name(s)...' },
            },
            label: { type: 'plain_text', text: 'Assignee', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'labels_block',
            element: {
              type: 'multi_conversations_select',
              action_id: 'labels_input',
              placeholder: { type: 'plain_text', text: 'Select channels for labels' },
            },
            label: { type: 'plain_text', text: 'Labels / Channels', emoji: true },
            optional: true,
          },
        ],
        submit: { type: 'plain_text', text: 'Create', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
    return;
  }

  const parsed = parseThreadLink(threadLink);
  
  if (!parsed) {
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Invalid Thread Link', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Invalid thread link format*\n\nPlease use a valid Slack thread link:\n\`https://xxx.slack.com/archives/.../p...\``,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
    return;
  }

  try {
    const threadReplies = await client.conversations.replies(
      { channel: parsed.channelId, ts: parsed.threadTs, limit: 50 }
    );

    const messages = threadReplies.messages || [];
    const { projectName, dueDate, description } = extractDataFromThread(messages);

    modalContext.set(body.user.id, {
      channelId: parsed.channelId,
      threadTs: parsed.threadTs,
      threadLink: threadLink,
      notionPageId: '',
    });

    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'create_task_modal_final',
        title: { type: 'plain_text', text: 'Create QA Task', emoji: true },
        blocks: [
          {
            type: 'input',
            block_id: 'thread_link_block',
            element: {
              type: 'plain_text_input',
              action_id: 'thread_link_input',
              initial_value: threadLink,
            },
            label: { type: 'plain_text', text: 'Thread Link', emoji: true },
          },
          {
            type: 'input',
            block_id: 'task_name_block',
            element: {
              type: 'plain_text_input',
              action_id: 'task_name_input',
              placeholder: { type: 'plain_text', text: 'Enter task name...' },
              initial_value: projectName || '',
            },
            label: { type: 'plain_text', text: 'Task Name *', emoji: true },
          },
          {
            type: 'input',
            block_id: 'description_block',
            element: {
              type: 'plain_text_input',
              action_id: 'description_input',
              placeholder: { type: 'plain_text', text: 'Enter task description...' },
              multiline: true,
              initial_value: description || '',
            },
            label: { type: 'plain_text', text: 'Description', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'priority_block',
            element: {
              type: 'static_select',
              action_id: 'priority_input',
              placeholder: { type: 'plain_text', text: 'Select priority' },
              options: [
                { text: { type: 'plain_text', text: '🔴 High', emoji: true }, value: 'High' },
                { text: { type: 'plain_text', text: '🟡 Medium', emoji: true }, value: 'Medium' },
                { text: { type: 'plain_text', text: '🟢 Low', emoji: true }, value: 'Low' },
              ],
            },
            label: { type: 'plain_text', text: 'Priority *', emoji: true },
          },
          {
            type: 'input',
            block_id: 'due_date_block',
            element: {
              type: 'datepicker',
              action_id: 'due_date_input',
              placeholder: { type: 'plain_text', text: 'Select due date' },
              initial_date: dueDate || undefined,
            },
            label: { type: 'plain_text', text: 'Due Date', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'assignee_block',
            element: {
              type: 'plain_text_input',
              action_id: 'assignee_input',
              placeholder: { type: 'plain_text', text: 'Enter assignee name(s)...' },
            },
            label: { type: 'plain_text', text: 'Assignee', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'labels_block',
            element: {
              type: 'multi_conversations_select',
              action_id: 'labels_input',
              placeholder: { type: 'plain_text', text: 'Select channels for labels' },
            },
            label: { type: 'plain_text', text: 'Labels / Channels', emoji: true },
            optional: true,
          },
        ],
        submit: { type: 'plain_text', text: 'Create', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
  } catch (error) {
    console.error('Error fetching thread:', error);
    
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error Reading Thread', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Could not read thread*\n\nError: ${error.message}`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// VIEW SUBMISSION - Update Task: Parse Notion link
// ============================================
app.view('update_task_modal', async ({ ack, body, client }) => {
  const values = body.view.state.values;
  
  const notionLink = values.notion_link_block?.notion_link_input?.value || '';

  modalContext.set(body.user.id, {
    channelId: body.container?.channel_id || '',
    threadTs: body.container?.thread_ts || body.container?.message_ts || '',
    notionPageId: '',
    notionLink: notionLink,
  });

  if (!notionLink) {
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Please enter a Notion page link*`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
    return;
  }

  const pageId = parseNotionPageUrl(notionLink);
  
  if (!pageId) {
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Invalid Notion Link', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Invalid Notion page link format*\n\nPlease use a valid Notion page URL:\n\`https://notion.so/.../PageName-pageId\``,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
    return;
  }

  try {
    // Get page info and thread link
    const [pageInfo, threadLink] = await Promise.all([
      getPageInfo(pageId),
      getThreadLinkFromPage(pageId),
    ]);

    modalContext.set(body.user.id, {
      channelId: body.container?.channel_id || '',
      threadTs: body.container?.thread_ts || body.container?.message_ts || '',
      notionPageId: pageId,
      notionLink: notionLink,
      threadLink: threadLink || '',
    });

    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'update_task_modal_final',
        title: { type: 'plain_text', text: 'Update Task', emoji: true },
        blocks: [
          {
            type: 'input',
            block_id: 'notion_link_block',
            element: {
              type: 'plain_text_input',
              action_id: 'notion_link_input',
              initial_value: notionLink,
            },
            label: { type: 'plain_text', text: 'Notion Link', emoji: true },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *Task Info:*\n> *Name:* ${pageInfo.name || 'N/A'}\n> *Current Status:* ${pageInfo.status || 'N/A'}\n> *Current Progress:* ${pageInfo.progress || 0}%`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'input',
            block_id: 'status_block',
            element: {
              type: 'static_select',
              action_id: 'status_input',
              placeholder: { type: 'plain_text', text: 'Select status' },
              options: [
                { text: { type: 'plain_text', text: '⭕ Not Started', emoji: true }, value: 'Not Started' },
                { text: { type: 'plain_text', text: '🔄 In Progress', emoji: true }, value: 'In Progress' },
                { text: { type: 'plain_text', text: '✅ Done', emoji: true }, value: 'Done' },
              ],
            },
            label: { type: 'plain_text', text: 'Status *', emoji: true },
          },
          {
            type: 'input',
            block_id: 'progress_block',
            element: {
              type: 'plain_text_input',
              action_id: 'progress_input',
              placeholder: { type: 'plain_text', text: 'Enter progress (0-100)' },
            },
            label: { type: 'plain_text', text: 'Progress (%)', emoji: true },
            optional: true,
          },
        ],
        submit: { type: 'plain_text', text: 'Update', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
  } catch (error) {
    console.error('Error fetching Notion page:', error);
    
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Could not fetch Notion page*\n\nError: ${error.message}`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// FINAL MODAL SUBMISSION - Create Notion Task
// ============================================
app.view('create_task_modal_final', async ({ ack, body, client }) => {
  const values = body.view.state.values;
  
  const taskName = values.task_name_block?.task_name_input?.value || '';
  const description = values.description_block?.description_input?.value || '';
  const priority = values.priority_block?.priority_input?.selected_option?.value || 'Medium';
  const dueDate = values.due_date_block?.due_date_input?.selected_date || null;
  const assignee = values.assignee_block?.assignee_input?.value || '';
  const labels = values.labels_block?.labels_input?.selected_conversations || [];
  const threadLink = values.thread_link_block?.thread_link_input?.value || '';

  const context = modalContext.get(body.user.id);
  const channelId = context?.channelId;
  const threadTs = context?.threadTs;

  const priorityEmoji = priority === 'High' ? '🔴' : priority === 'Medium' ? '🟡' : '🟢';

  try {
    const notionResult = await createNotionTask({
      taskName,
      description,
      priority,
      dueDate,
      assignee,
      labels,
      threadLink: threadLink || context?.threadLink || '',
    });

    await ack({ response_action: 'clear' });

    if (channelId && threadTs) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `✅ *Task Created!*\n\n> *Project:* ${taskName}${assignee ? `\n> *Assignee:* ${assignee}` : ''}\n> *Priority:* ${priorityEmoji} ${priority}\n> 🔗 <${notionResult.url}|Open in Notion>`,
      });
    }

  } catch (error) {
    console.error('Error creating task:', error);

    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Failed to create task*\n\n> Error: ${error.message}`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// FINAL MODAL SUBMISSION - Update Notion Task
// ============================================
app.view('update_task_modal_final', async ({ ack, body, client }) => {
  const values = body.view.state.values;
  
  const status = values.status_block?.status_input?.selected_option?.value || '';
  const progress = values.progress_block?.progress_input?.value || '';

  const context = modalContext.get(body.user.id);
  const channelId = context?.channelId;
  const threadTs = context?.threadTs;
  const notionPageId = context?.notionPageId;
  const threadLink = context?.threadLink;
  const notionLink = context?.notionLink;

  const statusEmoji = status === 'Done' ? '✅' : status === 'In Progress' ? '🔄' : '⭕';

  try {
    await updateNotionTaskStatus(notionPageId, status, progress ? parseInt(progress, 10) : null);

    await ack({ response_action: 'clear' });

    // Determine where to post - prefer threadLink from Notion comment if available
    let replyChannelId = channelId;
    let replyThreadTs = threadTs;

    // If we have threadLink from Notion comment, parse it for channel and ts
    if (threadLink) {
      const parsed = parseThreadLink(threadLink);
      if (parsed) {
        replyChannelId = parsed.channelId;
        replyThreadTs = parsed.threadTs;
      }
    }

    // Reply to thread if we have channel and thread_ts
    if (replyChannelId && replyThreadTs) {
      await client.chat.postMessage({
        channel: replyChannelId,
        thread_ts: replyThreadTs,
        text: `🔄 *Task Updated!*\n\n> *Status:* ${statusEmoji} ${status}\n> *Progress:* ${progress || 0}%\n> 🔗 <${notionLink}|Open in Notion>`,
      });
    }

  } catch (error) {
    console.error('Error updating task:', error);

    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Failed to update task*\n\n> Error: ${error.message}`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// VIEW SUBMISSION - Report Task: Fetch spreadsheet and show data modal
// ============================================
app.view('report_task_modal', async ({ ack, body, client }) => {
  const values = body.view.state.values;
  
  const notionLink = values.notion_link_block?.notion_link_input?.value || '';
  const env = values.env_block?.env_input?.value || '';

  if (!notionLink || !env) {
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Please fill in all fields*\n\n> Notion Link and Environment are required.`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
    return;
  }

  const pageId = parseNotionPageUrl(notionLink);
  
  if (!pageId) {
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Invalid Notion Link', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Invalid Notion page link format*\n\nPlease use a valid Notion page URL.`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
    return;
  }

  try {
    // Get thread link from Notion page
    const threadLink = await getThreadLinkFromPage(pageId);
    
    // Get page info for context
    const pageInfo = await getPageInfo(pageId);

    // Store context
    modalContext.set(body.user.id, {
      channelId: body.container?.channel_id || '',
      threadTs: body.container?.thread_ts || body.container?.message_ts || '',
      notionPageId: pageId,
      notionLink: notionLink,
      threadLink: threadLink || '',
      env: env,
    });

    // Push data entry modal with coverage data summary
    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'report_task_modal_final',
        title: { type: 'plain_text', text: '📊 Report QA Task', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *Task:* ${pageInfo.name || 'N/A'}\n🌍 *Env:* ${env}`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'input',
            block_id: 'coverage_block',
            element: {
              type: 'plain_text_input',
              action_id: 'coverage_input',
              placeholder: { type: 'plain_text', text: 'e.g., 85' },
            },
            label: { type: 'plain_text', text: 'Coverage (%)', emoji: true },
          },
          {
            type: 'input',
            block_id: 'total_passed_block',
            element: {
              type: 'plain_text_input',
              action_id: 'total_passed_input',
              placeholder: { type: 'plain_text', text: 'e.g., 150' },
            },
            label: { type: 'plain_text', text: 'Total Passed', emoji: true },
          },
          {
            type: 'input',
            block_id: 'total_testing_block',
            element: {
              type: 'plain_text_input',
              action_id: 'total_testing_input',
              placeholder: { type: 'plain_text', text: 'e.g., 20' },
            },
            label: { type: 'plain_text', text: 'Total In Testing', emoji: true },
          },
          {
            type: 'input',
            block_id: 'not_tested_block',
            element: {
              type: 'plain_text_input',
              action_id: 'not_tested_input',
              placeholder: { type: 'plain_text', text: 'e.g., 30' },
            },
            label: { type: 'plain_text', text: 'Total Not Tested', emoji: true },
          },
          {
            type: 'input',
            block_id: 'total_failed_block',
            element: {
              type: 'plain_text_input',
              action_id: 'total_failed_input',
              placeholder: { type: 'plain_text', text: 'e.g., 5' },
            },
            label: { type: 'plain_text', text: 'Total Failed', emoji: true },
          },
          {
            type: 'input',
            block_id: 'notes_block',
            element: {
              type: 'plain_text_input',
              action_id: 'notes_input',
              placeholder: { type: 'plain_text', text: 'Enter any additional notes...' },
              multiline: true,
            },
            label: { type: 'plain_text', text: 'Notes', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'cc_block',
            element: {
              type: 'plain_text_input',
              action_id: 'cc_input',
              placeholder: { type: 'plain_text', text: 'e.g., @john, @jane' },
            },
            label: { type: 'plain_text', text: 'CC (people to notify)', emoji: true },
            optional: true,
          },
        ],
        submit: { type: 'plain_text', text: 'Submit Report', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
  } catch (error) {
    console.error('Error fetching Notion page:', error);
    
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Could not fetch Notion page*\n\nError: ${error.message}`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// FINAL SUBMISSION - Report Task
// ============================================
app.view('report_task_modal_final', async ({ ack, body, client }) => {
  const values = body.view.state.values;
  
  const coverage = values.coverage_block?.coverage_input?.value || '0';
  const totalPassed = values.total_passed_block?.total_passed_input?.value || '0';
  const totalTesting = values.total_testing_block?.total_testing_input?.value || '0';
  const notTested = values.not_tested_block?.not_tested_input?.value || '0';
  const totalFailed = values.total_failed_block?.total_failed_input?.value || '0';
  const notes = values.notes_block?.notes_input?.value || '';
  const cc = values.cc_block?.cc_input?.value || '';

  const context = modalContext.get(body.user.id);
  const channelId = context?.channelId;
  const threadTs = context?.threadTs;
  const notionPageId = context?.notionPageId;
  const notionLink = context?.notionLink;
  const threadLink = context?.threadLink;
  const env = context?.env || '';

  const total = parseInt(totalPassed) + parseInt(totalTesting) + parseInt(notTested) + parseInt(totalFailed);

  try {
    // Add report as comment in Notion
    const { Client } = require('@notionhq/client');
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    
    const reportContent = `📊 *Test Report - ${env}*
${notes ? `📝 *Notes:* ${notes}` : ''}
${cc ? `👥 *CC:* ${cc}` : ''}
${'─'.repeat(20)}
✅ *Passed:* ${totalPassed}
🔄 *In Testing:* ${totalTesting}
❌ *Not Tested:* ${notTested}
❌ *Failed:* ${totalFailed}
${'─'.repeat(20)}
📈 *Coverage:* ${coverage}%`;

    await notion.comments.create({
      parent: { page_id: notionPageId },
      rich_text: [
        {
          type: 'text',
          text: { content: reportContent },
        },
      ],
    });

    await ack({ response_action: 'clear' });

    // Determine where to reply
    let replyChannelId = channelId;
    let replyThreadTs = threadTs;

    if (threadLink) {
      const parsed = parseThreadLink(threadLink);
      if (parsed) {
        replyChannelId = parsed.channelId;
        replyThreadTs = parsed.threadTs;
      }
    }

    // Build report message
    let reportText = `📊 *Test Report - ${env}*\n\n`;
    reportText += `✅ *Passed:* ${totalPassed}\n`;
    reportText += `🔄 *In Testing:* ${totalTesting}\n`;
    reportText += `❌ *Not Tested:* ${notTested}\n`;
    reportText += `❌ *Failed:* ${totalFailed}\n`;
    reportText += `${'─'.repeat(20)}\n`;
    reportText += `📈 *Coverage:* ${coverage}%\n\n`;
    if (notes) reportText += `📝 *Notes:* ${notes}\n`;
    if (cc) reportText += `👥 *CC:* ${cc}\n`;
    reportText += `🔗 <${notionLink}|Open in Notion>`;

    // Reply to thread if we have channel and thread_ts
    if (replyChannelId && replyThreadTs) {
      await client.chat.postMessage({
        channel: replyChannelId,
        thread_ts: replyThreadTs,
        text: reportText,
      });
    }

  } catch (error) {
    console.error('Error submitting report:', error);

    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Failed to submit report*\n\n> Error: ${error.message}`,
            },
          },
        ],
        close: { type: 'plain_text', text: 'Close', emoji: true },
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
            text: { type: 'mrkdwn', text: '*QA Bot*\nCreate, update, and report tasks in Notion via Slack' },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '➕ Create Task' },
                action_id: 'open_create_modal',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '🔄 Update Task' },
                action_id: 'open_update_modal',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '📊 Report Task' },
                action_id: 'open_report_modal',
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
// ACTION HANDLERS
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

app.action('open_update_modal', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: handleUpdateTaskModal(),
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

app.action('open_report_modal', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: handleReportTaskModal(),
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
