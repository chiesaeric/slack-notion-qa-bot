/**
 * Modal View Definitions for QA Task Creation
 */

/**
 * Initial modal - asks for thread link only
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
      // ========================================
      // THREAD LINK
      // ========================================
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
      // ========================================
      // HINT
      // ========================================
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

module.exports = {
  handleCreateTaskModal,
};
