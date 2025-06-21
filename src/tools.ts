// src/tools.ts
// Enhanced tool definitions with titles, descriptions, and readOnlyHint

export const tools = [
  {
    name: "rtm_authenticate",
    title: "Start RTM Authentication",
    description: "Initiates Remember The Milk authentication flow. Returns an auth URL for user authorization.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "rtm_complete_auth",
    title: "Complete RTM Authentication",
    description: "Completes the authentication process after user authorizes the app on Remember The Milk.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID received from the initial authentication setup"
        }
      },
      required: ["session_id"]
    }
  },
  {
    name: "rtm_check_auth_status",
    title: "Check Authentication Status",
    description: "Verifies if the authentication process was completed successfully.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to check authentication status for"
        }
      },
      required: ["session_id"]
    }
  },
  {
    name: "rtm_create_timeline",
    title: "Create Timeline",
    description: "Creates a timeline for making undoable changes to tasks and lists.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        }
      },
      required: ["auth_token"]
    }
  },
  {
    name: "rtm_get_lists",
    title: "Get RTM Lists",
    description: "Retrieves all task lists from your Remember The Milk account.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        }
      },
      required: ["auth_token"]
    }
  },
  {
    name: "rtm_add_list",
    title: "Create New List",
    description: "Creates a new task list in Remember The Milk.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        name: {
          type: "string",
          description: "Name for the new list"
        },
        filter: {
          type: "string",
          description: "Smart list filter criteria (optional, creates a Smart List)"
        }
      },
      required: ["auth_token", "timeline", "name"]
    }
  },
  {
    name: "rtm_get_tasks",
    title: "Get Tasks",
    description: "Retrieves tasks from Remember The Milk, optionally filtered by list or search criteria.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        list_id: {
          type: "string",
          description: "ID of a specific list to retrieve tasks from (optional)"
        },
        filter: {
          type: "string",
          description: "RTM search filter (e.g., 'due:today', 'tag:important') (optional)"
        }
      },
      required: ["auth_token"]
    }
  },
  {
    name: "rtm_get_tasks_from_list",
    title: "Get Tasks from Specific List",
    description: "Retrieves all tasks from a specific RTM list by list ID.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        list_id: {
          type: "string",
          description: "ID of the list to retrieve tasks from"
        }
      },
      required: ["auth_token", "list_id"]
    }
  },
  {
    name: "rtm_add_task",
    title: "Add New Task",
    description: "Creates a new task with Smart Add support for natural language input.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        name: {
          type: "string",
          description: "Task description (supports Smart Add: 'Buy milk tomorrow at 3pm #shopping !2')"
        },
        list_id: {
          type: "string",
          description: "ID of the list to add the task to (optional, defaults to Inbox)"
        }
      },
      required: ["auth_token", "timeline", "name"]
    }
  },
  {
    name: "rtm_complete_task",
    title: "Complete Task",
    description: "Marks a task as completed in Remember The Milk.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        list_id: {
          type: "string",
          description: "ID of the list containing the task"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Specific task ID within the series"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_delete_task",
    title: "Delete Task",
    description: "Permanently deletes a task from Remember The Milk.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        list_id: {
          type: "string",
          description: "ID of the list containing the task"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Specific task ID within the series"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_set_due_date",
    title: "Set Task Due Date",
    description: "Sets or updates the due date for a task.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        list_id: {
          type: "string",
          description: "ID of the list containing the task"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Specific task ID within the series"
        },
        due: {
          type: "string",
          description: "Due date in ISO format (YYYY-MM-DD) or RTM natural language (e.g., 'tomorrow', 'next Friday')"
        },
        has_due_time: {
          type: "string",
          enum: ["0", "1"],
          description: "Whether the due date includes a specific time (0=date only, 1=date and time)"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_add_tags",
    title: "Add Tags to Task",
    description: "Adds one or more tags to an existing task.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        list_id: {
          type: "string",
          description: "ID of the list containing the task"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Specific task ID within the series"
        },
        tags: {
          type: "string",
          description: "Comma-separated list of tags to add (e.g., 'urgent,work,followup')"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id", "tags"]
    }
  },
  {
    name: "rtm_move_task",
    title: "Move Task to Another List",
    description: "Moves a task from one list to another.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        from_list_id: {
          type: "string",
          description: "ID of the current list containing the task"
        },
        to_list_id: {
          type: "string",
          description: "ID of the destination list"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Specific task ID within the series"
        }
      },
      required: ["auth_token", "timeline", "from_list_id", "to_list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_set_priority",
    title: "Set Task Priority",
    description: "Sets the priority level for a task.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID for undoable operations"
        },
        list_id: {
          type: "string",
          description: "ID of the list containing the task"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Specific task ID within the series"
        },
        priority: {
          type: "string",
          enum: ["N", "1", "2", "3"],
          description: "Priority level: N=None, 1=High, 2=Medium, 3=Low"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id", "priority"]
    }
  },
  {
    name: "rtm_undo",
    title: "Undo Last Action",
    description: "Undoes the last action performed within a timeline.",
    readOnlyHint: false,
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Your Remember The Milk authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID containing the action to undo"
        },
        transaction_id: {
          type: "string",
          description: "Transaction ID of the specific action to undo"
        }
      },
      required: ["auth_token", "timeline", "transaction_id"]
    }
  },
  {
    name: "rtm_parse_time",
    title: "Parse Natural Language Time",
    description: "Converts natural language time descriptions into RTM timestamps.",
    readOnlyHint: true,
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Natural language time description (e.g., 'tomorrow at 3pm', 'next Monday')"
        },
        timezone: {
          type: "string",
          description: "Timezone for parsing (optional, e.g., 'America/New_York')"
        }
      },
      required: ["text"]
    }
  }
];