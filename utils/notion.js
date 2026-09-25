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
  const { taskName, description, priority, dueDate, assignee, labels } = taskData;

  // Build Notion page properties based on your database schema
  // Adjust property names to match your actual Notion database schema
  const properties = {
    // Title property - change 'Name' to your actual title property name
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

  // Add description if provided
  if (description) {
    // Change 'Description' to your actual property name (rich_text)
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

  // Add priority select
  // Change 'Priority' to your actual property name
  properties.Priority = {
    select: {
      name: priority || 'Medium',
    },
  };

  // Add due date if provided
  if (dueDate) {
    // Change 'Due Date' to your actual property name
    properties['Due Date'] = {
      date: {
        start: dueDate,
      },
    };
  }

  // Add assignee if provided - stored as text
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

  // Add labels if provided (multi-select)
  if (labels && labels.length > 0) {
    // Change 'Labels' to your actual property name
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

  return {
    id: response.id,
    url: response.url,
    createdTime: response.created_time,
  };
}

/**
 * Get database schema (properties)
 * Useful for debugging or dynamically matching schema
 */
async function getDatabaseSchema() {
  const database = await notion.databases.retrieve({
    database_id: DATABASE_ID,
  });

  return database.properties;
}

/**
 * List all tasks in the database (for debugging)
 */
async function listTasks(pageSize = 10) {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    page_size: pageSize,
  });

  return response.results;
}

module.exports = {
  createNotionTask,
  getDatabaseSchema,
  listTasks,
};
