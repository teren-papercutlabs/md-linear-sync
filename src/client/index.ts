const { LinearClient } = require('@linear/sdk');
import { LinearTeam, LinearProject, LinearWorkflowState, TicketMetadata, Comment } from '../types';
import { RetryManager } from '../utils/RetryManager';

export class LinearDiscoveryClient {
  private client: any;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async getTeams(): Promise<LinearTeam[]> {
    try {
      const response = await this.client.teams();
      return response.nodes.map((team: any) => ({
        id: team.id,
        name: team.name,
        key: team.key
      }));
    } catch (error) {
      throw new Error(`Failed to fetch teams: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getProjects(teamId: string): Promise<LinearProject[]> {
    try {
      // Get the team first, then get its projects directly
      const team = await this.client.team(teamId);
      const projectsConnection = await team.projects();
      
      return projectsConnection.nodes.map((project: any) => ({
        id: project.id,
        name: project.name,
        description: project.description || undefined
      }));
    } catch (error) {
      throw new Error(`Failed to fetch projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
    try {
      const response = await this.client.workflowStates({
        filter: { team: { id: { eq: teamId } } }
      });
      return response.nodes.map((state: any) => ({
        id: state.id,
        name: state.name,
        type: state.type,
        position: state.position
      })).sort((a: any, b: any) => a.position - b.position);
    } catch (error) {
      throw new Error(`Failed to fetch workflow states: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getTeamLabels(teamId: string): Promise<any[]> {
    try {
      // Use direct GraphQL query through team object as the issueLabels filter doesn't work correctly
      const query = `
        query GetTeamLabels($teamId: String!) {
          team(id: $teamId) {
            labels {
              nodes {
                id
                name
                color
                description
              }
            }
          }
        }
      `;
      
      const rawResponse = await this.client.client.rawRequest(query, { teamId });
      const labels = (rawResponse as any).data?.team?.labels?.nodes || [];
      
      return labels.map((label: any) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        description: label.description
      }));
    } catch (error) {
      throw new Error(`Failed to fetch team labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async validateApiKey(): Promise<{ valid: boolean; user?: { name: string; email: string } }> {
    try {
      const viewer = await this.client.viewer;
      return {
        valid: true,
        user: {
          name: viewer.name,
          email: viewer.email
        }
      };
    } catch (error) {
      return { valid: false };
    }
  }
}

export class LinearSyncClient {
  private client: any;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async getIssue(issueId: string): Promise<any> {
    return RetryManager.withRetry(async () => {
      const query = `
        query GetIssue($issueId: String!) {
          issue(id: $issueId) {
            id
            identifier
            title
            description
            url
            priority
            createdAt
            updatedAt
            dueDate
            branchName
            number
            labels {
              nodes {
                id
                name
              }
            }
            assignee {
              id
              name
              email
            }
            creator {
              id
              name
              email
            }
            parent {
              id
              identifier
            }
            state {
              id
              name
              type
            }
            comments(first: 50) {
              nodes {
                id
                body
                createdAt
                user {
                  id
                  name
                  email
                }
              }
            }
          }
        }
      `;

      const variables = { issueId };
      const rawResponse = await this.client.client.rawRequest(query, variables);
      const issue = (rawResponse as any).data?.issue;
      
      if (!issue) {
        throw new Error(`Issue ${issueId} not found`);
      }
      
      return issue;
    }, {}, `fetch issue ${issueId}`);
  }

  async getIssues(teamId: string, projectId?: string, limit: number = 100): Promise<{ issues: any[], apiUsage?: any }> {
    try {
      const filter: any = { team: { id: { eq: teamId } } };
      if (projectId) {
        filter.project = { id: { eq: projectId } };
      }

      // Use rawRequest to get headers and fetch issues with comments in one call
      const query = `
        query IssuesWithCommentsQuery($filter: IssueFilter, $first: Int, $includeArchived: Boolean) {
          issues(filter: $filter, first: $first, includeArchived: $includeArchived) {
            nodes {
              id
              identifier
              title
              description
              url
              priority
              createdAt
              updatedAt
              dueDate
              branchName
              number
              labels {
                nodes {
                  id
                  name
                }
              }
              assignee {
                id
                name
                email
              }
              creator {
                id
                name
                email
              }
              parent {
                id
                identifier
              }
              state {
                id
                name
                type
              }
              comments(first: 50) {
                nodes {
                  id
                  body
                  createdAt
                  user {
                    id
                    name
                    email
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        filter,
        first: limit,
        includeArchived: false
      };

      const rawResponse = await this.client.client.rawRequest(query, variables);
      
      // Extract rate limit info from headers
      let apiUsage = undefined;
      if (rawResponse.headers) {
        const headers = rawResponse.headers;
        apiUsage = {
          requestsLimit: this.parseNumber(headers.get?.('x-ratelimit-requests-limit')),
          requestsRemaining: this.parseNumber(headers.get?.('x-ratelimit-requests-remaining')),
          requestsResetAt: this.parseNumber(headers.get?.('x-ratelimit-requests-reset')),
          note: "Rate limit info extracted from response headers"
        };
      }
      
      return {
        issues: (rawResponse as any).data?.issues?.nodes || [],
        apiUsage
      };
    } catch (error) {
      // If it's a rate limit error, extract the rate limit info
      if (error instanceof Error && 'requestsRemaining' in error) {
        const rateLimitError = error as any;
        throw new Error(`Rate limit exceeded: ${rateLimitError.requestsRemaining}/${rateLimitError.requestsLimit} requests remaining`);
      }
      throw new Error(`Failed to fetch issues: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseNumber(value: string | undefined | null): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    return Number(value) ?? undefined;
  }

  async createIssue(
    teamId: string, 
    title: string, 
    description?: string, 
    stateId?: string, 
    projectId?: string,
    labelIds?: string[],
    parentId?: string,
    priority?: number
  ): Promise<any> {
    try {
      const issueInput: any = {
        teamId,
        title,
        description: description || ''
      };

      if (stateId) issueInput.stateId = stateId;
      if (projectId) issueInput.projectId = projectId;
      if (labelIds && labelIds.length > 0) issueInput.labelIds = labelIds;
      if (parentId) issueInput.parentId = parentId;
      if (priority !== undefined) issueInput.priority = priority;

      const response = await this.client.createIssue(issueInput);
      return response.issue;
    } catch (error) {
      throw new Error(`Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findIssueByIdentifier(identifier: string): Promise<any | null> {
    try {
      const query = `
        query FindIssueByIdentifier($identifier: String!) {
          issue(id: $identifier) {
            id
            identifier
            title
          }
        }
      `;

      const rawResponse = await this.client.client.rawRequest(query, { identifier });
      return (rawResponse as any).data?.issue || null;
    } catch (error) {
      // Issue not found is not an error - return null
      return null;
    }
  }

  async updateIssue(issueId: string, updates: { title?: string; description?: string; stateId?: string }): Promise<any> {
    return RetryManager.withRetry(async () => {
      const response = await this.client.updateIssue(issueId, updates);
      return response.issue;
    }, {}, `update issue ${issueId}`);
  }

  async getComments(issueId: string): Promise<any[]> {
    try {
      const response = await this.client.comments({
        filter: { issue: { id: { eq: issueId } } }
      });
      return response.nodes;
    } catch (error) {
      throw new Error(`Failed to fetch comments for issue ${issueId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createComment(issueId: string, body: string): Promise<any> {
    try {
      const response = await this.client.createComment({
        issueId,
        body
      });
      return response.comment;
    } catch (error) {
      throw new Error(`Failed to create comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Webhook management methods
  async getWebhooks(): Promise<any[]> {
    try {
      const query = `
        query GetWebhooks {
          webhooks {
            nodes {
              id
              url
              enabled
              secret
              team {
                id
                name
              }
            }
          }
        }
      `;

      const rawResponse = await this.client.client.rawRequest(query);
      return (rawResponse as any).data?.webhooks?.nodes || [];
    } catch (error) {
      throw new Error(`Failed to fetch webhooks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createWebhook(input: { url: string; teamId: string; secret?: string }): Promise<string> {
    try {
      const mutation = `
        mutation WebhookCreate($input: WebhookCreateInput!) {
          webhookCreate(input: $input) {
            success
            webhook {
              id
              url
              enabled
            }
          }
        }
      `;

      const variables = {
        input: {
          url: input.url,
          teamId: input.teamId,
          secret: input.secret || this.generateWebhookSecret(),
          resourceTypes: ["Issue", "Comment"]
        }
      };

      const rawResponse = await this.client.client.rawRequest(mutation, variables);
      const result = (rawResponse as any).data?.webhookCreate;
      
      if (!result?.success) {
        throw new Error('Failed to create webhook');
      }

      return result.webhook.id;
    } catch (error) {
      throw new Error(`Failed to create webhook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateWebhook(id: string, input: { url?: string; enabled?: boolean }): Promise<void> {
    try {
      const mutation = `
        mutation WebhookUpdate($id: String!, $input: WebhookUpdateInput!) {
          webhookUpdate(id: $id, input: $input) {
            success
            webhook {
              id
              url
              enabled
            }
          }
        }
      `;

      const variables = { id, input };

      const rawResponse = await this.client.client.rawRequest(mutation, variables);
      const result = (rawResponse as any).data?.webhookUpdate;
      
      if (!result?.success) {
        throw new Error('Failed to update webhook');
      }
    } catch (error) {
      throw new Error(`Failed to update webhook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deleteWebhook(id: string): Promise<void> {
    try {
      const mutation = `
        mutation WebhookDelete($id: String!) {
          webhookDelete(id: $id) {
            success
          }
        }
      `;

      const variables = { id };

      const rawResponse = await this.client.client.rawRequest(mutation, variables);
      const result = (rawResponse as any).data?.webhookDelete;
      
      if (!result?.success) {
        throw new Error('Failed to delete webhook');
      }
    } catch (error) {
      throw new Error(`Failed to delete webhook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async upsertWebhook(input: { url: string; teamId: string }): Promise<string> {
    try {
      // Check if webhook exists for this team
      const existingWebhooks = await this.getWebhooks();
      const ourWebhook = existingWebhooks.find(w => 
        w.team?.id === input.teamId && w.url.includes('ngrok')
      );

      if (ourWebhook) {
        // Update existing
        await this.updateWebhook(ourWebhook.id, { url: input.url });
        return ourWebhook.id;
      } else {
        // Create new
        return await this.createWebhook(input);
      }
    } catch (error) {
      throw new Error(`Failed to upsert webhook: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private generateWebhookSecret(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

export { LinearClient };