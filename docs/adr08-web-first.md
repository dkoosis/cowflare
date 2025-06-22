ADR 008: Prioritizing Web as the Primary Client Target
Status: Accepted

Context:

Know this: Claude.ai (web) recently added direct support for accessing remote MCP servers. https://www.anthropic.com/news/claude-code-remote-mcp. 

The project currently has two potential client targets: the claude.ai web interface and the Claude Desktop application. This has created ambiguity about which user experience to prioritize. The authentication flow, which is web-based, requires a manual token transfer to configure the desktop client, creating friction for developers and a suboptimal experience for end-users who might attempt it. We need a clear strategy to streamline development and focus on the most effective user journey.

Decision:
We will officially designate claude.ai (the web client) as the primary development and user target for the RTM MCP Server.

The Claude Desktop application will be considered a secondary, developer-only tool, to be used specifically when its debugging capabilities (e.g., direct inspection of local MCP server traffic, easier log inspection) provide a clear advantage for troubleshooting.

Consequences:

Streamlined User Experience: This decision prioritizes a seamless end-to-end user journey. A user can discover the tool on the web, complete the web-based RTM authentication, and immediately begin using the tools all within the same browser environment. The manual copy-and-paste of tokens is eliminated for the primary user flow.

Focused Development: All new feature development, UI/UX considerations, and testing efforts will be focused on the claude.ai web experience. This eliminates the overhead of supporting two different client environments.

Acceptance of Desktop Limitations: The known friction of configuring Claude Desktop is now accepted as a minor inconvenience for a developer-only tool, rather than a critical flaw in the end-user experience. We will not invest effort in trying to automate the token transfer to the desktop application.

Documentation Clarity: All user-facing documentation ("Getting Started" guides, READMEs) will be updated to guide users through the claude.ai web flow exclusively. References to Claude Desktop configuration will be moved to a "Developer/Debugging" section.