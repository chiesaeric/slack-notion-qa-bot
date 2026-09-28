/**
 * Notion API Integration
 * Handles creation and updates of tasks in Notion Database
 */

const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// ============================================
// CREATE TASK
// ============================================
async function createNotionTask(taskData) {
  const { taskName, description, priority, dueDate, assignee, labels, threadLink } = taskData;

  const properties = {
    Name: {
      title: [{ text: { content: taskName } }],
    },
  };

  if (description) {
    properties.Description = {
      rich_text: [{ text: { content: description } }],
    };
  }

  properties.Priority = {
    select: { name: priority || 'Medium' },
  };

  if (dueDate) {
    properties['Due Date'] = { date: { start: dueDate } };
  }

  if (assignee) {
    properties.Assignee = {
      rich_text: [{ text: { content: assignee } }],
    };
  }

  if (labels && labels.length > 0) {
    properties.Labels = {
      multi_select: labels.map(channelId => ({ name: channelId })),
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: properties,
  });

  // Add thread link as comment
  if (threadLink) {
    try {
      await notion.comments.create({
        parent: { page_id: response.id },
        rich_text: [
          { type: 'text', text: { content: 'Link Request: ' } },
          {
            type: 'text',
            link: { url: threadLink },
            text: { content: threadLink },
          },
        ],
      });
    } catch (commentError) {
      console.error('Error creating comment:', commentError);
    }
  }

  return {
    id: response.id,
    url: response.url,
    createdTime: response.created_time,
  };
}

// ============================================
// GET THREAD LINK FROM NOTION PAGE
// ============================================
async function getThreadLinkFromPage(pageId) {
  try {
    const comments = await notion.comments.list({ block_id: pageId });
    
    for (const comment of comments.results) {
      const textContent = comment.rich_text
        .map(block => block.plain_text)
        .join('');
      
      // Look for Slack URL pattern
      const slackMatch = textContent.match(/https:\/\/[\w.-]+\.slack\.com\/archives\/[\w]+\/p[\w]+/);
      if (slackMatch) {
        return slackMatch[0];
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting thread link:', error);
    return null;
  }
}

// ============================================
// UPDATE TASK STATUS AND PROGRESS
// ============================================
async function updateNotionTaskStatus(pageId, status, progress) {
  const properties = {};

  // Update Status (status type)
  if (status) {
    properties.Status = { status: { name: status } };
  }

  // Update Number (this is the progress field)
  if (progress !== undefined && progress !== null) {
    properties.Number = { number: parseInt(progress, 10) };
  }

  const response = await notion.pages.update({
    page_id: pageId,
    properties: properties,
  });

  return {
    id: response.id,
    url: response.url,
  };
}

// ============================================
// GET PAGE INFO
// ============================================
async function getPageInfo(pageId) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  
  const props = page.properties;
  
  return {
    id: page.id,
    url: page.url,
    name: props.Name?.title?.[0]?.plain_text || '',
    status: props.Status?.status?.name || '',
    progress: props.Number?.number || 0,
  };
}

// ============================================
// HELPER: Parse Notion page URL to get page ID
// ============================================
function parseNotionPageUrl(pageUrl) {
  // Format: https://notion.so/workspace/PageName-pageId
  // Or: https://www.notion.so/workspace/PageName-pageId?v=...
  
  const patterns = [
    /notion\.so\/[\w-]+\/([a-f0-9]{32})/i,
    /([a-f0-9]{32})\?/,
  ];

  for (const pattern of patterns) {
    const match = pageUrl.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

module.exports = {
  createNotionTask,
  getThreadLinkFromPage,
  updateNotionTaskStatus,
  getPageInfo,
  parseNotionPageUrl,
};
