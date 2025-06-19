export const tools = [
  {
    name: "rtm_authenticate",
    description: "Complete RTM authentication setup (use this first!)",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "Your unique identifier (e.g., your email or username)"
        }
      },
      required: ["user_id"]
    }
  },
  {
    name: "rtm_complete_auth",
    description: "Complete authentication after authorizing (step 2)",
    inputSchema: {
      type: "object",
      properties: {
        frob: {
          type: "string",
          description: "The frob from the previous step"
        },
        user_id: {
          type: "string",
          description: "Your unique identifier"
        }
      },
      required: ["frob", "user_id"]
    }
  },
  {
    name: "rtm_create_timeline",
    description: "Create a new timeline for undoable operations",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        }
      },
      required: ["auth_token"]
    }
  },
  {
    name: "rtm_get_lists",
    description: "Retrieve all lists",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        }
      },
      required: ["auth_token"]
    }
  },
  {
    name: "rtm_add_list",
    description: "Create a new list",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        name: {
          type: "string",
          description: "List name"
        },
        filter: {
          type: "string",
          description: "Smart list filter (optional)"
        }
      },
      required: ["auth_token", "timeline", "name"]
    }
  },
  {
    name: "rtm_get_tasks",
    description: "Retrieve tasks from a list",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        list_id: {
          type: "string",
          description: "List ID (optional)"
        },
        filter: {
          type: "string",
          description: "RTM search filter (optional)"
        }
      },
      required: ["auth_token"]
    }
  },
  {
    name: "rtm_add_task",
    description: "Add a new task with Smart Add support",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        name: {
          type: "string",
          description: "Task name (supports Smart Add syntax)"
        },
        list_id: {
          type: "string",
          description: "List ID (optional)"
        }
      },
      required: ["auth_token", "timeline", "name"]
    }
  },
  {
    name: "rtm_complete_task",
    description: "Mark a task as completed",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        list_id: {
          type: "string",
          description: "List ID"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Task ID"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_delete_task",
    description: "Delete a task",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        list_id: {
          type: "string",
          description: "List ID"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Task ID"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_set_due_date",
    description: "Set or clear task due date",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        list_id: {
          type: "string",
          description: "List ID"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Task ID"
        },
        due: {
          type: "string",
          description: "Due date/time (ISO format or RTM natural language)"
        },
        has_due_time: {
          type: "string",
          enum: ["0", "1"],
          description: "Whether time is specified (0=date only, 1=date+time)"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_add_tags",
    description: "Add tags to a task",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        list_id: {
          type: "string",
          description: "List ID"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Task ID"
        },
        tags: {
          type: "string",
          description: "Comma-separated list of tags to add"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id", "tags"]
    }
  },
  {
    name: "rtm_move_task",
    description: "Move task to another list",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        from_list_id: {
          type: "string",
          description: "Source list ID"
        },
        to_list_id: {
          type: "string",
          description: "Destination list ID"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Task ID"
        }
      },
      required: ["auth_token", "timeline", "from_list_id", "to_list_id", "taskseries_id", "task_id"]
    }
  },
  {
    name: "rtm_set_priority",
    description: "Set task priority",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        list_id: {
          type: "string",
          description: "List ID"
        },
        taskseries_id: {
          type: "string",
          description: "Task series ID"
        },
        task_id: {
          type: "string",
          description: "Task ID"
        },
        priority: {
          type: "string",
          enum: ["1", "2", "3", "N"],
          description: "Priority (1=High, 2=Medium, 3=Low, N=None)"
        }
      },
      required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id", "priority"]
    }
  },
  {
    name: "rtm_undo",
    description: "Undo a transaction",
    inputSchema: {
      type: "object",
      properties: {
        auth_token: {
          type: "string",
          description: "Authentication token"
        },
        timeline: {
          type: "string",
          description: "Timeline ID"
        },
        transaction_id: {
          type: "string",
          description: "Transaction ID to undo"
        }
      },
      required: ["auth_token", "timeline", "transaction_id"]
    }
  },
  {
    name: "rtm_parse_time",
    description: "Parse a time string using RTM's natural language processing",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Time string to parse (e.g., 'tomorrow at 3pm', 'next friday')"
        },
        timezone: {
          type: "string",
          description: "Timezone (optional, e.g., 'America/New_York')"
        }
      },
      required: ["text"]
    }
  }
];