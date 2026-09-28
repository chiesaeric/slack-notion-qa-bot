/**
 * Modal View Definitions for QA Task Creation and Update
 */

/**
 * Initial modal - asks for thread link only (Create Task)
 */
function handleCreateTaskModal() {
  return {
    type: 'modal',
    callback_id: 'create_task_modal',
    title: {
      type: 'plain_text',
      text: 'Create QA Task',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Next',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'input',
        block_id: 'thread_link_block',
        element: {
          type: 'plain_text_input',
          action_id: 'thread_link_input',
          placeholder: {
            type: 'plain_text',
            text: 'Paste Slack thread link here...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Thread Link',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Paste a Slack thread link to auto-fill task details from that thread.',
          },
        ],
      },
    ],
  };
}

/**
 * Initial modal - asks for Notion page link and environment (Update Task)
 */
function handleUpdateTaskModal() {
  return {
    type: 'modal',
    callback_id: 'update_task_modal',
    title: {
      type: 'plain_text',
      text: 'Update QA Task',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Next',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'input',
        block_id: 'notion_link_block',
        element: {
          type: 'plain_text_input',
          action_id: 'notion_link_input',
          placeholder: {
            type: 'plain_text',
            text: 'Paste Notion page link here...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Notion Page Link',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Paste a Notion page link to update its status and progress.',
          },
        ],
      },
    ],
  };
}

/**
 * Initial modal - asks for Notion page link and sheet name (Report Task)
 */
function handleReportTaskModal() {
  return {
    type: 'modal',
    callback_id: 'report_task_modal',
    title: {
      type: 'plain_text',
      text: 'Report QA Task',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Next',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'input',
        block_id: 'notion_link_block',
        element: {
          type: 'plain_text_input',
          action_id: 'notion_link_input',
          placeholder: {
            type: 'plain_text',
            text: 'Paste Notion page link here...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Notion Page Link',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'env_block',
        element: {
          type: 'plain_text_input',
          action_id: 'env_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., Pre-Staging',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Environment / Sheet Name',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Paste a Notion page link and enter the Environment/Sheet name to fetch test coverage data.',
          },
        ],
      },
    ],
  };
}

module.exports = {
  handleCreateTaskModal,
  handleUpdateTaskModal,
  handleReportTaskModal,
};
