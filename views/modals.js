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
 * Initial modal - asks for Notion page link (Update Task)
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

module.exports = {
  handleCreateTaskModal,
  handleUpdateTaskModal,
};
