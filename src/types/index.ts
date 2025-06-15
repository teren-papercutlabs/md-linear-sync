// Core sync data structures
export interface TicketMetadata {
  linear_id: string;
  title: string;
  status: "Todo" | "In Progress" | "In Review" | "Backlog" | "Done" | "Cancelled";
  assignee?: string;
  labels: string[];
  priority: 1 | 2 | 3 | 4;
  due_date?: string; // ISO format in SGT
  url: string;
  created_at: string; // ISO format in SGT
  updated_at: string; // ISO format in SGT
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  created_at: string; // ISO format in SGT
  replies?: Comment[];
}

export interface TicketFile {
  frontmatter: TicketMetadata;
  content: string;
  comments: Comment[];
}

// CLI command interfaces
export interface SyncOptions {
  direction: "push" | "pull";
  ticketId?: string;
}

export interface WebhookPayload {
  type: "Issue" | "Comment";
  action: "create" | "update" | "delete";
  data: {
    id: string;
    title?: string;
    description?: string;
    state?: { name: string };
    assignee?: { email: string };
    labels?: { name: string }[];
    priority?: number;
    dueDate?: string;
    updatedAt: string;
    url: string;
  };
  comment?: {
    id: string;
    body: string;
    user: { email: string };
    createdAt: string;
  };
}

// Error handling types
export interface RetryConfig {
  maxAttempts: 3;
  delays: [0, 30000, 120000]; // immediate, 30s, 2min
}

export interface SlackNotification {
  type: "success" | "error" | "info";
  title: string;
  message: string;
  ticketId?: string;
  ticketUrl?: string;
  changes?: Record<string, { from: any; to: any }>;
  timestamp: string;
}

// Configuration types
export interface StatusMapping {
  id: string;
  folder: string;
  type?: string; // Linear workflow type: "unstarted", "started", "completed", "canceled" (optional for backward compatibility)
}

export interface LinearSyncConfig {
  teamId: string;
  teamName: string;
  projectId: string; // Now required, no longer optional
  projectName: string;
  statusMapping: Record<string, StatusMapping>;
  labelMapping: Record<string, { id: string; color: string; description?: string }>;
  timezone: string;
  lastUpdated: string;
}

export interface LinearApiConfig {
  apiKey: string;
  teamId: string;
  webhookSecret?: string;
}

export interface SlackConfig {
  webhookUrl?: string;
}

export type StatusFolder = "todo" | "in-progress" | "in-review" | "backlog" | "completed" | "cancelled";

// Linear API discovery types
export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
}