/**
 * Modal View Definitions for QA Task Creation
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
      text: 'Create',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      // ========================================
      // TASK NAME (Required)
      // ========================================
      {
        type: 'input',
        block_id: 'task_name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'task_name_input',
          placeholder: {
            type: 'plain_text',
            text: 'Enter task name...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Task Name *',
          emoji: true,
        },
      },

      // ========================================
      // DESCRIPTION
      // ========================================
      {
        type: 'input',
        block_id: 'description_block',
        element: {
          type: 'plain_text_input',
          action_id: 'description_input',
          placeholder: {
            type: 'plain_text',
            text: 'Enter task description...',
          },
          multiline: true,
        },
        label: {
          type: 'plain_text',
          text: 'Description',
          emoji: true,
        },
        optional: true,
      },

      // ========================================
      // PRIORITY (Required)
      // ========================================
      {
        type: 'input',
        block_id: 'priority_block',
        element: {
          type: 'static_select',
          action_id: 'priority_input',
          placeholder: {
            type: 'plain_text',
            text: 'Select priority',
          },
          options: [
            {
              text: {
                type: 'plain_text',
                text: '🔴 High',
                emoji: true,
              },
              value: 'High',
            },
            {
              text: {
                type: 'plain_text',
                text: '🟡 Medium',
                emoji: true,
              },
              value: 'Medium',
            },
            {
              text: {
                type: 'plain_text',
                text: '🟢 Low',
                emoji: true,
              },
              value: 'Low',
            },
          ],
        },
        label: {
          type: 'plain_text',
          text: 'Priority *',
          emoji: true,
        },
      },

      // ========================================
      // DUE DATE (Optional)
      // ========================================
      {
        type: 'input',
        block_id: 'due_date_block',
        element: {
          type: 'date_picker',
          action_id: 'due_date_input',
          placeholder: {
            type: 'plain_text',
            text: 'Select due date',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Due Date',
          emoji: true,
        },
        optional: true,
      },

      // ========================================
      // ASSIGNEE (Optional)
      // ========================================
      {
        type: 'input',
        block_id: 'assignee_block',
        element: {
          type: 'multi_users_select',
          action_id: 'assignee_input',
          placeholder: {
            type: 'plain_text',
            text: 'Select assignee(s)',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Assignee',
          emoji: true,
        },
        optional: true,
      },

      // ========================================
      // LABELS / CHANNELS (Optional)
      // ========================================
      {
        type: 'input',
        block_id: 'labels_block',
        element: {
          type: 'multi_conversations_select',
          action_id: 'labels_input',
          placeholder: {
            type: 'plain_text',
            text: 'Select channels for labels',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Labels / Channels',
          emoji: true,
        },
        optional: true,
      },

      // ========================================
      // DIVIDER
      // ========================================
      {
        type: 'divider',
      },

      // ========================================
      // HINT
      // ========================================
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Fields marked with * are required.',
          },
        ],
      },
    ],
  };
}

module.exports = {
  handleCreateTaskModal,
};
