import { emptyDraft, type McpServerDraft } from './api';

export type FeaturedMcpServer = {
  name: string;
  description: string;
} & (
  | { url: string; auth: 'bearer' | 'none' | 'oauth' }
  | { command: string; args: string[] }
);

export const FEATURED_MCP_SERVERS: FeaturedMcpServer[] = [
  {
    // GitHub's MCP endpoint does not allow automatic OAuth client
    // registration, so it needs a personal access token.
    name: 'GitHub',
    description:
      'Issues, pull requests, and code search. Needs a personal access token.',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'bearer',
  },
  {
    name: 'Notion',
    description: 'Search and update pages in your Notion workspace.',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
  },
  {
    name: 'Linear',
    description: 'Find, create, and update Linear issues.',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
  },
  {
    name: 'Sentry',
    description: 'Look up errors and issues in Sentry.',
    url: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
  },
  {
    name: 'Context7',
    description:
      'Up-to-date library docs. Add an API key header for higher limits.',
    url: 'https://mcp.context7.com/mcp',
    auth: 'none',
  },
  {
    name: 'Filesystem',
    description:
      'Read files in a folder you choose. Edit the path before adding.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Documents'],
  },
  {
    name: 'Fetch',
    description: 'Fetch web pages and turn them into text.',
    command: 'uvx',
    args: ['mcp-server-fetch'],
  },
];

export function draftFromFeatured(item: FeaturedMcpServer): McpServerDraft {
  const draft = {
    ...emptyDraft(),
    name: item.name,
    description: item.description,
  };
  if ('url' in item) {
    return { ...draft, url: item.url, authType: item.auth };
  }
  return {
    ...draft,
    mode: 'stdio',
    command: item.command,
    args: item.args.join('\n'),
  };
}
