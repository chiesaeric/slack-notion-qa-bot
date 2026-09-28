/**
 * Notion API Integration
 * Handles creation of tasks in Notion Database
 */

const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Create a new task in Notion Database
 * @param {Object} taskData - Task data from modal submission
 * @returns {Promise<Object>} Created page result with URL
 */
async function createNotionTask(taskData) {
  const { taskName, description, priority, dueDate, assignee, labels, threadLink } = taskData;

  // Build Notion page properties based on your database schema
  const properties = {
    Name: {
      title: [
        {
          text: {
            content: taskName,
          },
        },
      ],
    },
  };

  if (description) {
    properties.Description = {
      rich_text: [
        {
          text: {
            content: description,
          },
        },
      ],
    };
  }

  properties.Priority = {
    select: {
      name: priority || 'Medium',
    },
  };

  if (dueDate) {
    properties['Due Date'] = {
      date: {
        start: dueDate,
      },
    };
  }

  if (assignee) {
    properties.Assignee = {
      rich_text: [
        {
          text: {
            content: assignee,
          },
        },
      ],
    };
  }

  if (labels && labels.length > 0) {
    properties.Labels = {
      multi_select: labels.map(channelId => ({ name: channelId })),
    };
  }

  // Create the page in Notion
  const response = await notion.pages.create({
    parent: {
      database_id: DATABASE_ID,
    },
    properties: properties,
  });

  // Add thread link as a comment if provided
  if (threadLink) {
    try {
      await notion.comments.create({
        parent: { page_id: response.id },
        rich_text: [
          {
            type: 'text',
            text: {
              content: 'Link Request: ',
            },
          },
          {
            type: 'text',
            link: {
              url: threadLink,
            },
            text: {
              content: threadLink,
            },
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

module.exports = {
  createNotionTask,
};
