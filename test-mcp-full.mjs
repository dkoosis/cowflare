#!/usr/bin/env node
import { EventSource } from "eventsource";

// Test the full MCP flow
async function testMCPFull() {
	const baseUrl = "http://localhost:8787";

	console.log("Testing MCP Server with OAuth...\n");

	// Step 1: Test OAuth authorization
	console.log("1. Testing OAuth flow:");
	console.log(`   Visit: ${baseUrl}/authorize`);
	console.log('   Click "Approve" to get authorization code');
	console.log("   Use code to exchange for token\n");

	// For automated testing, we'd need to simulate the OAuth flow
	// For now, use a hardcoded token or prompt for one
	const token = process.env.MCP_TOKEN || "test-token";

	// Step 2: Test MCP tools via SSE
	console.log("2. Testing MCP tools via SSE:");

	const eventSource = new EventSource(`${baseUrl}/sse`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	// Send test requests for each tool
	const testRequests = [
		{
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: "add",
				arguments: { a: 5, b: 3 },
			},
			id: 1,
		},
		{
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: "whoami",
				arguments: {},
			},
			id: 2,
		},
		{
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: "increment",
				arguments: {},
			},
			id: 3,
		},
	];

	eventSource.onopen = () => {
		console.log("   SSE connection opened");

		// Send each test request
		testRequests.forEach(async (request, _index) => {
			console.log(`\n   Testing tool: ${request.params.name}`);

			try {
				const response = await fetch(`${baseUrl}/sse`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(request),
				});

				const result = await response.json();
				console.log(`   Result:`, JSON.stringify(result, null, 2));
			} catch (error) {
				console.error(`   Error:`, error.message);
			}
		});
	};

	eventSource.onerror = (error) => {
		console.error("   SSE error:", error);
		eventSource.close();
	};

	// Give tests time to complete
	setTimeout(() => {
		eventSource.close();
		console.log("\nTests complete");
		process.exit(0);
	}, 5000);
}

// Check if server is running
fetch("http://localhost:8787/")
	.then(() => testMCPFull())
	.catch(() => {
		console.error("Error: Server not running. Start with: npm run dev");
		process.exit(1);
	});
