import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export const layout = (content: HtmlEscapedString | string, title: string) => html`
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans leading-relaxed min-h-screen">
      <header class="bg-white shadow-sm mb-8">
        <div class="container mx-auto px-4 py-4">
          <a href="/" class="text-xl font-bold text-blue-600 hover:text-blue-700">
            RTM MCP Server
          </a>
        </div>
      </header>
      <main class="container mx-auto px-4 pb-12">
        ${content}
      </main>
      <footer class="bg-gray-100 py-6 mt-12">
        <div class="container mx-auto px-4 text-center text-gray-600">
          <p>&copy; ${new Date().getFullYear()} RTM MCP Server</p>
        </div>
      </footer>
    </body>
  </html>
`;

export const homeContent = async (): Promise<HtmlEscapedString> => {
  return html`
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-6">Remember The Milk MCP Server</h1>
      
      <div class="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 class="text-xl font-semibold mb-4">Getting Started</h2>
        <ol class="list-decimal list-inside space-y-2">
          <li>
            <a href="/auth" class="text-blue-600 hover:text-blue-700">
              Authenticate with Remember The Milk
            </a>
          </li>
          <li>Copy your authentication token from the URL</li>
          <li>Configure your MCP client with the Bearer token</li>
          <li>Connect to: <code class="bg-gray-100 px-2 py-1 rounded">${new URL(import.meta.url).origin}/sse</code></li>
        </ol>
      </div>

      <div class="bg-white p-6 rounded-lg shadow-md">
        <h2 class="text-xl font-semibold mb-4">Available Tools</h2>
        <ul class="space-y-2">
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_get_lists</code> - Get all your lists</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_add_task</code> - Add a new task</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_complete_task</code> - Complete a task</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_get_tasks</code> - Get tasks from lists</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_search_tasks</code> - Search tasks with RTM queries</li>
        </ul>
      </div>
    </div>
  `;
};

export const renderAuthScreen = async (authUrl: string, frob: string): Promise<HtmlEscapedString> => {
  return html`
    <div class="max-w-md mx-auto bg-white p-8 rounded-lg shadow-md">
      <h1 class="text-2xl font-bold mb-6">Authenticate with RTM</h1>
      
      <p class="mb-6">Click the button below to authenticate with Remember The Milk:</p>
      
      <a 
        href="${authUrl}" 
        class="block w-full py-3 px-4 bg-blue-600 text-white text-center rounded-md font-medium hover:bg-blue-700 transition-colors"
      >
        Authenticate with RTM
      </a>
      
      <p class="mt-6 text-sm text-gray-600">
        After authorizing, click this link to complete authentication:
      </p>
      
      <a 
        href="/auth/callback?frob=${frob}" 
        class="block mt-2 w-full py-3 px-4 bg-green-600 text-white text-center rounded-md font-medium hover:bg-green-700 transition-colors"
      >
        Complete Authentication
      </a>
    </div>
  `;
};