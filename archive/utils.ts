// File: src/utils.ts
/**
 * @file UI utility functions and HTML templates
 * @description Provides layout components and page templates for the web interface
 */

import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Main layout wrapper for all pages
 * @param content - Page-specific content to render
 * @param title - Page title for the browser tab
 * @returns Complete HTML page with header, content, and footer
 */
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

/**
 * Renders the authentication instruction screen
 * @param authUrl - The RTM authorization URL
 * @param frob - The temporary frob token
 * @returns HTML content for the auth instruction page
 */
export const renderAuthScreen = async (authUrl: string, frob: string): Promise<HtmlEscapedString> => {
  return html`
    <div class="max-w-md mx-auto bg-white p-8 rounded-lg shadow-md">
      <h1 class="text-2xl font-bold mb-6">Authenticate with RTM</h1>
      
      <p class="mb-6">Click the button below to authenticate with Remember The Milk:</p>
      
      <a 
        href="${authUrl}" 
        target="_blank"
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