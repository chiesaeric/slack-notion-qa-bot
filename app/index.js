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
// Key: user_id, Value: { channelId, threadTs, threadLink, notionPageId, notionLink, ...reportData }
const modalContext = new Map();

// Helper function to get emoji for status
function getStatusEmoji(status) {
  const emojiMap = {
    'Not Started': '⭕',
    'Created Test Plan': '📋',
    'In Staging': '🧪',
    'In Prestaging': '🧪',
    'Ready to Release': '✅',
    'Released': '🚀',
  };
  return emojiMap[status] || '⭕';
}

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
    /client\/([A-Z0-9]+)\/([0-9]+\.[0-9]+)/i,
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
// (4-step update flow: Modal 1 -> Modal 2 -> branch to Update OR (Modal 3 -> Modal 4 -> submit))
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
// VIEW SUBMISSION - Update Task Modal 1: Parse Notion link
// Pushes Modal 2 with status/progress/testcase + action buttons to branch
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
    console.log('Fetching page info from Notion...');
    const [pageInfo, threadLink] = await Promise.all([
      getPageInfo(pageId),
      getThreadLinkFromPage(pageId),
    ]);
    console.log('Notion fetch done. pageInfo:', JSON.stringify(pageInfo));

    // Get thread link from Notion Slack Thread property
    const notionThreadLink = pageInfo.slackThread || '';
    console.log('threadLink:', threadLink);
    console.log('notionThreadLink:', notionThreadLink);

    modalContext.set(body.user.id, {
      channelId: body.container?.channel_id || '',
      threadTs: body.container?.thread_ts || body.container?.message_ts || '',
      notionPageId: pageId,
      notionLink: notionLink,
      threadLink: threadLink || '',
      notionThreadLink: notionThreadLink,
      testCaseUrl: pageInfo.testCaseUrl || '',
      hasTestCase: !!pageInfo.testCaseUrl,
      status: pageInfo.status || '',
      progress: pageInfo.progress || 0,
      taskName: pageInfo.name || 'N/A',
    });

    console.log('Building Modal 2 view...');

    // Check if task has test case
    const hasTestCase = !!pageInfo.testCaseUrl;
    const testCaseInfo = hasTestCase
      ? `> *Test Case:* Attached`
      : `> *Test Case:* Not attached yet`;

    // Modal 2 view with task info
    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'update_task_modal_step2',
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
              text: `📋 *Task Info:*\n> *Name:* ${pageInfo.name || 'N/A'}\n> *Current Status:* ${pageInfo.status || 'N/A'}\n> *Current Progress:* ${pageInfo.progress || 0}%\n${testCaseInfo}`,
            },
          },
          { type: 'divider' },
          {
            type: 'input',
            block_id: 'status_block',
            element: {
              type: 'static_select',
              action_id: 'status_input',
              placeholder: { type: 'plain_text', text: 'Select status' },
              initial_option: pageInfo.status ? {
                text: { type: 'plain_text', text: pageInfo.status },
                value: pageInfo.status,
              } : undefined,
              options: [
                { text: { type: 'plain_text', text: 'Not Started' }, value: 'Not Started' },
                { text: { type: 'plain_text', text: 'Created Test Plan' }, value: 'Created Test Plan' },
                { text: { type: 'plain_text', text: 'In Prestaging' }, value: 'In Prestaging' },
                { text: { type: 'plain_text', text: 'In Staging' }, value: 'In Staging' },
                { text: { type: 'plain_text', text: 'Ready to Release' }, value: 'Ready to Release' },
                { text: { type: 'plain_text', text: 'Released' }, value: 'Released' },
              ],
            },
            label: { type: 'plain_text', text: 'Status *', emoji: true },
          },
          {
            type: 'input',
            block_id: 'sheet_block',
            element: {
              type: 'plain_text_input',
              action_id: 'sheet_input',
              placeholder: { type: 'plain_text', text: hasTestCase ? 'Required: Pre-Staging / Staging' : 'Optional: for manual input' },
            },
            label: { type: 'plain_text', text: 'Sheet Name', emoji: true },
            optional: true,
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_Enter the sheet name if the test case is attached and you are selecting In Pre-Staging or In Staging status._',
            },
          },
          { type: 'divider' },
        ],
        submit: { type: 'plain_text', text: 'Next', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
    console.log('Modal 2 pushed!');
  } catch (error) {
    console.error('Error in Modal 1:', error);

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
// VIEW SUBMISSION - Modal 2 (Final): All fields
// Branch: Created Test Plan → Modal 3 (Progress+TestCase) | In Staging/Prestaging → Modal 3 (Coverage) | Ready to Release/Released → direct update
// ============================================
app.view('update_task_modal_step2', async ({ ack, body, client }) => {
  console.log('=== Modal 2 Handler Started ===');
  console.log('user_id:', body.user.id);

  const values = body.view.state.values;

  const status = values.status_block?.status_input?.selected_option?.value || '';
  const sheetName = values.sheet_block?.sheet_input?.value || '';

  console.log('status:', status);
  console.log('sheetName:', sheetName);

  const context = modalContext.get(body.user.id);
  const notionPageId = context?.notionPageId;
  const notionLink = context?.notionLink || values.notion_link_block?.notion_link_input?.value || '';
  const notionThreadLink = context?.notionThreadLink || '';
  const channelId = context?.channelId || '';
  const threadTs = context?.threadTs || '';
  const taskName = context?.taskName || 'N/A';
  const testCaseUrl = context?.testCaseUrl || '';
  const progress = context?.progress || 0;

  // Update context with latest values
  modalContext.set(body.user.id, {
    ...context,
    updateStatus: status,
    sheetName,
  });

  console.log('context found:', !!context);
  console.log('notionPageId:', notionPageId);
  console.log('testCaseUrl:', testCaseUrl);

  // ============================================
  // Branch: Ready to Release or Released
  // Direct update + reply (skip Modal 3)
  // ============================================
  if (status === 'Ready to Release' || status === 'Released') {
    console.log('=== Ready to Release/Released branch ===');
    // Get thread info from Notion Slack Thread property
    const notionThreadLink = context?.notionThreadLink || '';
    let replyChannelId = channelId;
    let replyThreadTs = threadTs;
    if (notionThreadLink) {
      const parsed = parseThreadLink(notionThreadLink);
      console.log('parsed thread:', parsed);
      if (parsed) {
        replyChannelId = parsed.channelId;
        replyThreadTs = parsed.threadTs;
      }
    }

    try {
      await updateNotionTaskStatus(notionPageId, status, 100);

      await ack({ response_action: 'clear' });

      console.log('replyChannelId:', replyChannelId);
      console.log('replyThreadTs:', replyThreadTs);

      // Reply to thread
      if (replyChannelId && replyThreadTs) {
        console.log('Posting message to thread...');
        await client.chat.postMessage({
          channel: replyChannelId,
          thread_ts: replyThreadTs,
          text: `:arrows_counterclockwise: *Task Updated!*\n\nStatus: ${status}\n:link: <${notionLink}|Open in Notion>`,
        });
        console.log('Message posted successfully');
      } else {
        console.log('SKIPPED: replyChannelId or replyThreadTs is empty');
      }
    } catch (error) {
      console.error('Error updating task:', error);
      await ack({
        response_action: 'update',
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: '❌ Error', emoji: true },
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `❌ *Failed to update task*\n\nError: ${error.message}` },
          }],
          close: { type: 'plain_text', text: 'Close', emoji: true },
        },
      });
    }
    return;
  }

  // ============================================
  // Branch: In Staging or In Prestaging
  // Has test case → fetch coverage from Google Sheets
  // No test case → skip fetch, go to Modal 3 for manual input
  // ============================================
  if (status === 'In Staging' || status === 'In Prestaging') {
    console.log('=== In Staging/Prestaging branch ===');
    console.log('sheetName:', sheetName);
    console.log('testCaseUrl:', testCaseUrl);

    // Check if task has test case
    const hasTestCase = !!testCaseUrl;

    // If has test case, sheet name is required
    if (hasTestCase && !sheetName) {
      console.log('Sheet name is required when test case exists');
      await ack({
        response_action: 'update',
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: '❌ Validation Error', emoji: true },
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: '❌ *Sheet Name is required because this task has a Test Case*' },
          }],
          close: { type: 'plain_text', text: 'Close', emoji: true },
        },
      });
      return;
    }

    let coverageData = {
      coverage: 0,
      scopeTest: 0,
      totalPassed: 0,
      totalFailed: 0,
      totalNotTested: 0,
    };

    // Fetch coverage only if has test case and sheet name
    if (hasTestCase && sheetName) {
      console.log('Fetching coverage data...');
      const spreadsheetId = parseSpreadsheetUrl(testCaseUrl);
      if (!spreadsheetId) {
        console.log('Invalid spreadsheet URL');
        await ack({
          response_action: 'update',
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: '❌ Invalid URL', emoji: true },
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: '❌ *Invalid Test Case URL in Notion*' },
            }],
            close: { type: 'plain_text', text: 'Close', emoji: true },
          },
        });
        return;
      }

      try {
        coverageData = await Promise.race([
          fetchTestCoverageData(spreadsheetId, sheetName),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 3000)),
        ]);
        console.log('Coverage data received:', coverageData);
      } catch (apiError) {
        console.log('Coverage fetch error:', apiError.message);
        await ack({
          response_action: 'update',
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: '❌ Connection Error', emoji: true },
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `❌ *Could not fetch coverage data*\n\nError: ${apiError.message}` },
            }],
            close: { type: 'plain_text', text: 'Close', emoji: true },
          },
        });
        return;
      }
    } else {
      console.log('No test case or sheet name - will use manual input');
    }

    // Store in context for Modal 3
    modalContext.set(body.user.id, {
      ...context,
      updateStatus: status,
      sheetName: sheetName,
      coverageData: coverageData,
    });

    console.log('Pushing Modal 3...');

    // Push Modal 3 with coverage input fields + Notes + CC
    const coverageFormatted = parseFloat(coverageData.coverage || 0).toFixed(2);

    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'update_task_modal_step3',
        title: { type: 'plain_text', text: 'Report Coverage', emoji: true },
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `📋 *Task:* ${taskName}\n> Status: *${status}*` },
          },
          { type: 'divider' },
          {
            type: 'input',
            block_id: 'coverage_block',
            element: {
              type: 'plain_text_input',
              action_id: 'coverage_input',
              initial_value: coverageFormatted,
            },
            label: { type: 'plain_text', text: 'Total Coverage Test (%)' },
          },
          {
            type: 'input',
            block_id: 'testcases_block',
            element: {
              type: 'plain_text_input',
              action_id: 'testcases_input',
              initial_value: String(coverageData.scopeTest || 0),
            },
            label: { type: 'plain_text', text: 'Test Cases' },
          },
          {
            type: 'input',
            block_id: 'passed_block',
            element: {
              type: 'plain_text_input',
              action_id: 'passed_input',
              initial_value: String(coverageData.totalPassed || 0),
            },
            label: { type: 'plain_text', text: 'Passed Test' },
          },
          {
            type: 'input',
            block_id: 'failed_block',
            element: {
              type: 'plain_text_input',
              action_id: 'failed_input',
              initial_value: String(coverageData.totalFailed || 0),
            },
            label: { type: 'plain_text', text: 'Failed Test' },
          },
          {
            type: 'input',
            block_id: 'untested_block',
            element: {
              type: 'plain_text_input',
              action_id: 'untested_input',
              initial_value: String(coverageData.totalNotTested || 0),
            },
            label: { type: 'plain_text', text: 'Untested Test' },
          },
          { type: 'divider' },
          {
            type: 'input',
            block_id: 'notes_block',
            element: { type: 'plain_text_input', action_id: 'notes_input', placeholder: { type: 'plain_text', text: 'Enter any additional notes...' }, multiline: true },
            label: { type: 'plain_text', text: 'Notes', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'cc_block',
            element: { type: 'multi_conversations_select', action_id: 'cc_input', placeholder: { type: 'plain_text', text: 'Select people to notify...' } },
            label: { type: 'plain_text', text: 'CC (Slack mentions)', emoji: true },
            optional: true,
          },
        ],
        submit: { type: 'plain_text', text: 'Submit Report', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
    return;
  }

  // ============================================
  // Branch: Created Test Plan
  // Push Modal 3 (Progress + Test Case URL)
  // ============================================
  if (status === 'Created Test Plan') {
    modalContext.set(body.user.id, {
      ...context,
      updateStatus: status,
      sheetName: sheetName,
    });

    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'update_task_modal_step3',
        title: { type: 'plain_text', text: 'Created Test Plan', emoji: true },
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `📋 *Task:* ${taskName}\n> Status will be: *${status}*` },
          },
          { type: 'divider' },
          {
            type: 'input',
            block_id: 'progress_block',
            element: { type: 'plain_text_input', action_id: 'progress_input', placeholder: { type: 'plain_text', text: 'Enter progress (0-100)' }, initial_value: String(context?.progress || 0) },
            label: { type: 'plain_text', text: 'Progress (%)', emoji: true },
          },
          {
            type: 'input',
            block_id: 'testcase_block',
            element: { type: 'plain_text_input', action_id: 'testcase_input', placeholder: { type: 'plain_text', text: 'Paste test case spreadsheet link here...' }, initial_value: testCaseUrl || '' },
            label: { type: 'plain_text', text: 'Test Case URL', emoji: true },
          },
        ],
        submit: { type: 'plain_text', text: 'Create', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
    return;
  }

  // ============================================
  // Branch: Others (Not Started, Ready to Release, Released, etc.)
  // Direct update + reply
  // ============================================
  // Status emoji mapping
  const statusEmoji = {
    'Not Started': '⭕',
    'Created Test Plan': '📋',
    'In Prestaging': '🧪',
    'In Staging': '🧪',
    'Ready to Release': '✅',
    'Released': '🚀',
  };
  const statusIcon = statusEmoji[status] || '';

  console.log('=== Modal 2 Debug (Ready to Release) ===');
  console.log('context:', JSON.stringify(context));
  console.log('notionThreadLink:', notionThreadLink);
  console.log('channelId:', channelId);
  console.log('threadTs:', threadTs);
  console.log('=====================================');

  let replyChannelId = channelId;
  let replyThreadTs = threadTs;
  if (notionThreadLink) {
    const parsed = parseThreadLink(notionThreadLink);
    console.log('parsed thread:', parsed);
    if (parsed) {
      replyChannelId = parsed.channelId;
      replyThreadTs = parsed.threadTs;
    }
  }

  try {
    await updateNotionTaskStatus(notionPageId, status, null);

    await ack({ response_action: 'clear' });

    console.log('replyChannelId:', replyChannelId);
    console.log('replyThreadTs:', replyThreadTs);

    if (replyChannelId && replyThreadTs) {
      console.log('Posting message to thread...');
      await client.chat.postMessage({
        channel: replyChannelId,
        thread_ts: replyThreadTs,
        text: `:arrows_counterclockwise: *Task Updated!*\n\nStatus: ${statusIcon} ${status}\n:link: <${notionLink}|Open in Notion>`,
      });
      console.log('Message posted successfully');
    } else {
      console.log('SKIPPED: replyChannelId or replyThreadTs is empty');
    }
  } catch (error) {
    console.error('Error updating task:', error);
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `❌ *Failed to update task*\n\nError: ${error.message}` },
        }],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// VIEW SUBMISSION - Modal 3: Dynamic based on status
// Created Test Plan → Progress + TestCase | In Staging/Pre-staging → Notes + CC + Report
// ============================================
app.view('update_task_modal_step3', async ({ ack, body, client }) => {
  const values = body.view.state.values;

  const context = modalContext.get(body.user.id);
  const status = context?.updateStatus;
  const notionPageId = context?.notionPageId;
  const notionLink = context?.notionLink;
  const threadLink = context?.threadLink;
  const channelId = context?.channelId;
  const threadTs = context?.threadTs;
  const taskName = context?.taskName || 'N/A';

  // ============================================
  // Branch: Created Test Plan
  // ============================================
  if (status === 'Created Test Plan') {
    const progress = values.progress_block?.progress_input?.value || '';
    const testCaseUrl = values.testcase_block?.testcase_input?.value || '';

    // Get thread info from Notion Slack Thread property
    const notionThreadLink = context?.notionThreadLink || '';
    // Status emoji mapping
    const statusEmoji = {
      'Not Started': '⭕',
      'Created Test Plan': '📋',
      'In Prestaging': '🧪',
      'In Staging': '🧪',
      'Ready to Release': '✅',
      'Released': '🚀',
    };
    const statusIcon = statusEmoji[status] || '';

    console.log('=== Modal 3 Debug (Created Test Plan) ===');
    console.log('notionThreadLink:', notionThreadLink);
    console.log('channelId:', channelId);
    console.log('threadTs:', threadTs);
    console.log('================================');

    let replyChannelId = channelId;
    let replyThreadTs = threadTs;
    if (notionThreadLink) {
      const parsed = parseThreadLink(notionThreadLink);
      console.log('parsed thread:', parsed);
      if (parsed) {
        replyChannelId = parsed.channelId;
        replyThreadTs = parsed.threadTs;
      }
    }

    try {
      // Update Notion: status + progress
      await updateNotionTaskStatus(notionPageId, status, progress ? parseInt(progress, 10) : null);

      // Update Test Case URL if provided
      if (testCaseUrl) {
        const { Client } = require('@notionhq/client');
        const notion = new Client({ auth: process.env.NOTION_API_KEY });
        await notion.pages.update({
          page_id: notionPageId,
          properties: { 'Test Case': { url: testCaseUrl } },
        });
      }

      await ack({ response_action: 'clear' });

      if (replyChannelId && replyThreadTs) {
        await client.chat.postMessage({
          channel: replyChannelId,
          thread_ts: replyThreadTs,
          text: `:arrows_counterclockwise: *Task Updated!*\n\nStatus: ${statusIcon} ${status}\nProgress: ${progress || 0}%\n:link: <${notionLink}|Open in Notion>`,
        });
      }
    } catch (error) {
      console.error('Error updating task:', error);
      await ack({
        response_action: 'update',
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: '❌ Error', emoji: true },
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `❌ *Failed to update task*\n\nError: ${error.message}` },
          }],
          close: { type: 'plain_text', text: 'Close', emoji: true },
        },
      });
    }
    return;
  }

  // ============================================
  // Branch: In Staging / In Prestaging (Report)
  // ============================================
  const notionThreadLink = context?.notionThreadLink || '';
  const notes = values.notes_block?.notes_input?.value || '';
  const ccUsers = values.cc_block?.cc_input?.selected_conversations || [];
  const sheetName = context?.sheetName || '';

  // Read coverage values from input fields
  const coverageInput = values.coverage_block?.coverage_input?.value || '0';
  const testcasesInput = values.testcases_block?.testcases_input?.value || '0';
  const passedInput = values.passed_block?.passed_input?.value || '0';
  const failedInput = values.failed_block?.failed_input?.value || '0';
  const untestedInput = values.untested_block?.untested_input?.value || '0';

  // Parse values
  const coverageFormatted = parseFloat(coverageInput) || 0;
  const totalPassed = parseInt(passedInput, 10) || 0;
  const totalFailed = parseInt(failedInput, 10) || 0;
  const totalNotTested = parseInt(untestedInput, 10) || 0;
  const scopeTest = parseInt(testcasesInput, 10) || 0;

  console.log('=== Modal 3 Debug (Report) ===');
  console.log('coverage:', coverageFormatted);
  console.log('totalPassed:', totalPassed);
  console.log('totalFailed:', totalFailed);
  console.log('totalNotTested:', totalNotTested);
  console.log('sheetName:', sheetName);
  console.log('================================');

  let replyChannelId = channelId;
  let replyThreadTs = threadTs;

  // Parse thread link from Notion if available
  if (notionThreadLink) {
    const parsed = parseThreadLink(notionThreadLink);
    console.log('parsed thread:', parsed);
    if (parsed) {
      replyChannelId = parsed.channelId;
      replyThreadTs = parsed.threadTs;
    }
  }

  try {
    // Update Notion: status + progress from coverage
    await updateNotionTaskStatus(notionPageId, status, coverageFormatted);

    // Update Slack Thread in Notion if we have thread info
    if (replyChannelId && replyThreadTs) {
      const threadUrl = `https://app.slack.com/client/${replyChannelId}/${replyThreadTs}`;
      const { Client } = require('@notionhq/client');
      const notion = new Client({ auth: process.env.NOTION_API_KEY });
      await notion.pages.update({
        page_id: notionPageId,
        properties: {
          'Slack Thread': { url: threadUrl },
        },
      });
    }

    await ack({ response_action: 'clear' });

    // Build report message
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const coverageDisplay = coverageFormatted.toFixed(2);
    const testcasesFormatted = `${scopeTest} cases`;
    const testCaseUrl = context?.testCaseUrl || '';

    // Notion format
    let notionReport = `[Testing Report] ${taskName}\n`;
    notionReport += `Date: ${today} Env: ${status}\n`;
    notionReport += `Total Coverage Test: ${coverageDisplay}%\n`;
    notionReport += `Testcases: ${testcasesFormatted}`;
    if (testCaseUrl) notionReport += ` (${testCaseUrl})`;
    notionReport += `\nPassed Test: ${totalPassed} cases\n`;
    notionReport += `Failed Test: ${totalFailed} cases\n`;
    notionReport += `Untested Test: ${totalNotTested} cases`;
    if (notes) notionReport += `\nNotes: ${notes}`;

    // Slack format
    let slackReport = `📊 *[Testing Report] Name: ${taskName}*\n`;
    slackReport += `>Date: ${today}\n`;
    slackReport += `>Env: ${status}\n\n`;
    slackReport += `*Total Coverage Test:* ${coverageDisplay}%\n`;
    slackReport += `Test Cases: ${testcasesFormatted}`;
    if (testCaseUrl) slackReport += ` (<${testCaseUrl}|link>)`;
    slackReport += `\nPassed Test: ${totalPassed} cases\n`;
    slackReport += `Failed Test: ${totalFailed} cases\n`;
    slackReport += `Untested Test: ${totalNotTested} cases\n\n`;
    if (notes) slackReport += `*Notes:*\n${notes}\n\n`;
    if (ccUsers.length > 0) {
      const ccFormatted = ccUsers.map(u => `<@${u}>`).join(' ');
      slackReport += `cc: ${ccFormatted}`;
    }

    // Reply to Notion if thread link exists
    if (notionThreadLink) {
      try {
        const { Client } = require('@notionhq/client');
        const notion = new Client({ auth: process.env.NOTION_API_KEY });
        await notion.comments.create({
          parent: { page_id: notionPageId },
          rich_text: [{ type: 'text', text: { content: notionReport } }],
        });
      } catch (notionErr) {
        console.error('Error posting to Notion:', notionErr.message);
      }
    }

    // Reply to Slack thread
    if (replyChannelId && replyThreadTs) {
      await client.chat.postMessage({
        channel: replyChannelId,
        thread_ts: replyThreadTs,
        text: slackReport,
      });
    }
  } catch (error) {
    console.error('Error submitting report:', error);
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: '❌ Error', emoji: true },
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `❌ *Failed to submit report*\n\nError: ${error.message}` },
        }],
        close: { type: 'plain_text', text: 'Close', emoji: true },
      },
    });
  }
});

// ============================================
// VIEW SUBMISSION - Update Task Modal 3: Report form submitted
// Pushes Modal 4 with report preview
// ============================================
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
    // Get page info including test case URL
    const pageInfo = await getPageInfo(pageId);

    if (!pageInfo.testCaseUrl) {
      await ack({
        response_action: 'update',
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: '❌ No Test Case URL', emoji: true },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *No "Test Case" URL found in this Notion page.*\n\nPlease add a "Test Case" property with the Google Sheets URL in your Notion page.`,
              },
            },
          ],
          close: { type: 'plain_text', text: 'Close', emoji: true },
        },
      });
      return;
    }

    // Parse spreadsheet ID from URL
    const spreadsheetId = parseSpreadsheetUrl(pageInfo.testCaseUrl);
    if (!spreadsheetId) {
      await ack({
        response_action: 'update',
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: '❌ Invalid Spreadsheet URL', emoji: true },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *Could not parse spreadsheet ID from Test Case URL.*\n\nPlease check the "Test Case" property in Notion.`,
              },
            },
          ],
          close: { type: 'plain_text', text: 'Close', emoji: true },
        },
      });
      return;
    }

    // Fetch coverage data from Google Sheets - use env as sheet name
    const coverageData = await fetchTestCoverageData(spreadsheetId, env);

    // Get thread link from Notion page
    const threadLink = await getThreadLinkFromPage(pageId);

    // Store context
    modalContext.set(body.user.id, {
      channelId: body.container?.channel_id || '',
      threadTs: body.container?.thread_ts || body.container?.message_ts || '',
      notionPageId: pageId,
      notionLink: notionLink,
      threadLink: threadLink || '',
      env: env,
      testCaseUrl: pageInfo.testCaseUrl,
      coverageData: coverageData,
      taskName: pageInfo.name || 'N/A',
    });

    // Push data entry modal with pre-filled coverage data
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
              text: `📋 *Task:* ${pageInfo.name || 'N/A'}`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'input',
            block_id: 'testcase_link_block',
            element: {
              type: 'plain_text_input',
              action_id: 'testcase_link_input',
              placeholder: { type: 'plain_text', text: 'Paste test case spreadsheet link here...' },
              initial_value: pageInfo.testCaseUrl || '',
            },
            label: { type: 'plain_text', text: 'Test Case Link', emoji: true },
            optional: true,
          },
          {
            type: 'input',
            block_id: 'testcases_block',
            element: {
              type: 'plain_text_input',
              action_id: 'testcases_input',
              placeholder: { type: 'plain_text', text: 'e.g., 78' },
              initial_value: coverageData.scopeTest || '',
            },
            label: { type: 'plain_text', text: 'Testcases (count)', emoji: true },
          },
          {
            type: 'input',
            block_id: 'passed_block',
            element: {
              type: 'plain_text_input',
              action_id: 'passed_input',
              placeholder: { type: 'plain_text', text: 'e.g., 78' },
              initial_value: coverageData.totalPassed || '0',
            },
            label: { type: 'plain_text', text: 'Passed (count)', emoji: true },
          },
          {
            type: 'input',
            block_id: 'failed_block',
            element: {
              type: 'plain_text_input',
              action_id: 'failed_input',
              placeholder: { type: 'plain_text', text: 'e.g., 0' },
              initial_value: coverageData.totalFailed || '0',
            },
            label: { type: 'plain_text', text: 'Failed (count)', emoji: true },
          },
          {
            type: 'input',
            block_id: 'untested_block',
            element: {
              type: 'plain_text_input',
              action_id: 'untested_input',
              placeholder: { type: 'plain_text', text: 'e.g., 0' },
              initial_value: coverageData.totalNotTested || '0',
            },
            label: { type: 'plain_text', text: 'Untested (count)', emoji: true },
          },
          {
            type: 'input',
            block_id: 'coverage_block',
            element: {
              type: 'plain_text_input',
              action_id: 'coverage_input',
              placeholder: { type: 'plain_text', text: 'e.g., 100.00' },
              initial_value: coverageData.coverage || '0',
            },
            label: { type: 'plain_text', text: 'Coverage (%)', emoji: true },
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
              type: 'multi_conversations_select',
              action_id: 'cc_input',
              placeholder: { type: 'plain_text', text: 'Select people to notify...' },
            },
            label: { type: 'plain_text', text: 'CC (Slack mentions)', emoji: true },
            optional: true,
          },
        ],
        submit: { type: 'plain_text', text: 'Submit Report', emoji: true },
        close: { type: 'plain_text', text: 'Cancel', emoji: true },
      },
    });
  } catch (error) {
    console.error('Error fetching data:', error);

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
              text: `❌ *Could not fetch data*\n\nError: ${error.message}\n\nMake sure:\n1. The Google Sheet is shared with the service account\n2. The sheet name "${env}" exists in the spreadsheet`,
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

  const testcases = values.testcases_block?.testcases_input?.value || '0';
  const testcaseLink = values.testcase_link_block?.testcase_link_input?.value || '';
  const passed = values.passed_block?.passed_input?.value || '0';
  const failed = values.failed_block?.failed_input?.value || '0';
  const untested = values.untested_block?.untested_input?.value || '0';
  const coverage = values.coverage_block?.coverage_input?.value || '0';
  const notes = values.notes_block?.notes_input?.value || '';
  const ccUsers = values.cc_block?.cc_input?.selected_conversations || [];

  const context = modalContext.get(body.user.id);
  const channelId = context?.channelId;
  const threadTs = context?.threadTs;
  const notionPageId = context?.notionPageId;
  const notionLink = context?.notionLink;
  const threadLink = context?.threadLink;
  const env = context?.env || '';
  const testCaseUrl = context?.testCaseUrl || '';
  const taskName = context?.taskName || 'N/A';

  // Format coverage to 2 decimal places
  const coverageFormatted = parseFloat(coverage).toFixed(2);

  // Format testcases with "cases" prefix
  const testcasesFormatted = `${testcases} cases`;

  try {
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
    const testcaseLineFormatted = testcaseLink
      ? `${testcasesFormatted} (<${testcaseLink}|link>)`
      : `${testcasesFormatted}`;

    // Format CC mentions for Slack
    const ccLine = ccUsers.length > 0 ? ccUsers.map(userId => `<@${userId}>`).join(' ') : '';

    let reportText = `*[Testing Report] ${taskName}*\n`;
    reportText += `> Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}\n`;
    reportText += `> Env: ${env}\n\n`;
    reportText += `*Total Coverage Test:* ${coverageFormatted}%\n\n`;
    reportText += `Test Cases: ${testcaseLineFormatted}\n`;
    reportText += `Passed Test: ${passed} cases\n`;
    reportText += `Failed Test: ${failed} cases\n`;
    reportText += `Untested Test: ${untested} cases\n\n`;
    reportText += `*Notes:*\n${notes || '-'}`;
    if (ccLine) {
      reportText += `\n\ncc: ${ccLine}`;
    }
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
