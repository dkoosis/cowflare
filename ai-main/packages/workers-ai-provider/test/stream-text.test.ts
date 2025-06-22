import { TextEncoder } from "node:util";
import { streamText } from "ai";
import { type DefaultBodyType, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import z from "zod";
import { createWorkersAI } from "../src/index";

const TEST_ACCOUNT_ID = "test-account-id";
const TEST_API_KEY = "test-api-key";
const TEST_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const defaultStreamingHandler = http.post(
	`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
	async () => {
		return new Response(
			[
				`data: {"response":"Hello chunk1"}\n\n`,
				`data: {"response":"Hello chunk2"}\n\n`,
				"data: [DONE]\n\n",
			].join(""),
			{
				headers: {
					"Content-Type": "text/event-stream",
					"Transfer-Encoding": "chunked",
				},
				status: 200,
			},
		);
	},
);

const server = setupServer(defaultStreamingHandler);

describe("REST API - Streaming Text Tests", () => {
	beforeAll(() => server.listen());
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	it("should stream text using Workers AI provider (via streamText)", async () => {
		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = streamText({
			model: workersai(TEST_MODEL),
			prompt: "Please write a multi-part greeting",
		});

		let accumulatedText = "";
		for await (const chunk of result.textStream) {
			accumulatedText += chunk;
		}

		expect(accumulatedText).toBe("Hello chunk1Hello chunk2");
	});

	it("should handle chunk without 'response' field gracefully", async () => {
		server.use(
			http.post(
				`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
				async () => {
					// Notice that the second chunk has no 'response' property,
					// just tool_calls and p fields, plus an extra brace.
					return new Response(
						[
							`data: {"response":"Hello chunk1"}\n\n`,
							`data: {"tool_calls":[],"p":"abdefgh"}\n\n`,
							"data: [DONE]\n\n",
						].join(""),
						{
							headers: {
								"Content-Type": "text/event-stream",
								"Transfer-Encoding": "chunked",
							},
							status: 200,
						},
					);
				},
			),
		);

		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = streamText({
			model: workersai(TEST_MODEL),
			prompt: "test chunk without response",
		});

		let finalText = "";
		for await (const chunk of result.textStream) {
			finalText += chunk;
		}

		expect(finalText).toBe("Hello chunk1");
	});

	it("should pass through additional options to the AI run method", async () => {
		let capturedOptions: null | DefaultBodyType = null;

		server.use(
			http.post(
				`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
				async ({ request }) => {
					// get passthrough params from url query
					const url = new URL(request.url);
					capturedOptions = Object.fromEntries(url.searchParams.entries());

					return new Response(
						[`data: {"response":"Hello with options"}\n\n`, "data: [DONE]\n\n"].join(
							"",
						),
						{
							headers: {
								"Content-Type": "text/event-stream",
								"Transfer-Encoding": "chunked",
							},
							status: 200,
						},
					);
				},
			),
		);

		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const model = workersai(TEST_MODEL, {
			aBool: true,
			aNumber: 1,
			aString: "a",
		});

		const result = streamText({
			model: model,
			prompt: "Test with custom options",
		});

		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}

		expect(text).toBe("Hello with options");
		expect(capturedOptions).toHaveProperty("aString", "a");
		expect(capturedOptions).toHaveProperty("aBool", "true");
		expect(capturedOptions).toHaveProperty("aNumber", "1");
	});

	it("should handle old tool call inside response when last message is user message", async () => {
		server.use(
			http.post(
				`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
				// `doStream` calls `doGenerate` underneath when the last message is from the user
				async () => {
					return HttpResponse.json({
						result: {
							response: null,
							tool_calls: [
								{
									arguments: {
										location: "London",
									},
									name: "get_weather",
								},
							],
							usage: {
								completion_tokens: 23,
								prompt_tokens: 168,
								total_tokens: 191,
							},
						},
					});
				},
			),
		);

		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = await streamText({
			model: workersai(TEST_MODEL),
			prompt: "Get the weather information for London",
			tools: {
				get_weather: {
					description: "Get the weather in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "Raining" : "Sunny",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the weather for"),
					}),
				},
			},
		});

		const toolCalls: any = [];

		for await (const chunk of result.fullStream) {
			if (chunk.type === "tool-call") {
				toolCalls.push(chunk);
			}
		}

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls).toMatchObject([
			{
				args: { location: "London" },
				toolCallId: "get_weather",
				toolName: "get_weather",
				type: "tool-call",
			},
		]);
	});

	it("should handle new tool call inside response when last message is user message", async () => {
		server.use(
			http.post(
				`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
				// `doStream` calls `doGenerate` underneath when the last message is from the user
				async () => {
					return HttpResponse.json({
						result: {
							tool_calls: [
								{
									function: {
										arguments: '{"location": "London"}',
										name: "get_weather",
									},
									id: "chatcmpl-tool-b482f0e36b0c4190b9bee3fb61408a9e",
									type: "function",
								},
							],
							usage: {
								completion_tokens: 17,
								prompt_tokens: 179,
								total_tokens: 196,
							},
						},
					});
				},
			),
		);

		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = await streamText({
			model: workersai(TEST_MODEL),
			prompt: "Get the weather information for London",
			tools: {
				get_weather: {
					description: "Get the weather in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "Raining" : "Sunny",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the weather for"),
					}),
				},
			},
		});

		const toolCalls: any = [];

		for await (const chunk of result.fullStream) {
			if (chunk.type === "tool-call") {
				toolCalls.push(chunk);
			}
		}

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls).toMatchObject([
			{
				args: { location: "London" },
				toolCallId: "chatcmpl-tool-b482f0e36b0c4190b9bee3fb61408a9e",
				toolName: "get_weather",
				type: "tool-call",
			},
		]);
	});

	it("should handle openai tool call inside response when last message is user message", async () => {
		server.use(
			http.post(
				`https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${TEST_MODEL}`,
				// `doStream` calls `doGenerate` underneath when the last message is from the user
				async () => {
					return HttpResponse.json({
						result: {
							id: "chatcmpl-2d657a54f93d4ecbb966cc50efd42819",
							object: "chat.completion",
							created: 1750346826,
							model: "@cf/qwen/qwen3-30b-a3b-fp8",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										reasoning_content:
											"\nOkay, the user is asking for the weather in London. Let me check the tools available. There's a function called get_weather that takes a location parameter. Since London is the location mentioned, I need to call that function with \"London\" as the argument. I'll make sure the JSON is correctly formatted and enclosed within the tool_call tags.\n",
										content: "\n\n",
										tool_calls: [
											{
												id: "chatcmpl-tool-c267de54771c4833a823f423f0def197",
												type: "function",
												function: {
													name: "get_weather",
													arguments: '{"location": "London"}',
												},
											},
										],
									},
									logprobs: null,
									finish_reason: "tool_calls",
									stop_reason: null,
								},
							],
							usage: {
								prompt_tokens: 169,
								completion_tokens: 94,
								total_tokens: 263,
							},
							prompt_logprobs: null,
						},
					});
				},
			),
		);

		const workersai = createWorkersAI({
			accountId: TEST_ACCOUNT_ID,
			apiKey: TEST_API_KEY,
		});

		const result = await streamText({
			model: workersai(TEST_MODEL),
			prompt: "Get the weather information for London",
			tools: {
				get_weather: {
					description: "Get the weather in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "Raining" : "Sunny",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the weather for"),
					}),
				},
			},
		});

		const toolCalls: any = [];

		for await (const chunk of result.fullStream) {
			if (chunk.type === "tool-call") {
				toolCalls.push(chunk);
			}
		}

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls).toMatchObject([
			{
				args: { location: "London" },
				toolCallId: "chatcmpl-tool-c267de54771c4833a823f423f0def197",
				toolName: "get_weather",
				type: "tool-call",
			},
		]);
	});
});

describe("Binding - Streaming Text Tests", () => {
	it("should handle chunk without 'response' field gracefully in mock", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, _inputs: any, _options?: any) => {
					return mockStream([
						{ response: "Hello " },
						{ p: "no response", tool_calls: [] },
						{ response: "world!" },
						"[DONE]",
					]);
				},
			},
		});

		const result = streamText({
			model: workersai(TEST_MODEL),
			prompt: "Test chunk without response",
		});

		let finalText = "";
		for await (const chunk of result.textStream) {
			finalText += chunk;
		}

		// The second chunk is missing 'response', so it is skipped
		// The first and third chunks are appended => "Hello world!"
		expect(finalText).toBe("Hello world!");
	});

	it("should pass through additional options to the AI run method in the mock", async () => {
		let capturedOptions: any = null;

		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, _inputs: any, options?: any) => {
					capturedOptions = options;
					return mockStream([{ response: "Hello with options" }, "[DONE]"]);
				},
			},
		});

		const model = workersai(TEST_MODEL, {
			aBool: true,
			aNumber: 1,
			aString: "a",
		});

		const result = streamText({
			model: model,
			prompt: "Test with custom options",
		});

		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}

		expect(text).toBe("Hello with options");
		expect(capturedOptions).toHaveProperty("aString", "a");
		expect(capturedOptions).toHaveProperty("aBool", true);
		expect(capturedOptions).toHaveProperty("aNumber", 1);
	});

	it("should handle old tool call inside response when last message is user message", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async (_modelName: string, _inputs: any, _options?: any) => {
					return {
						response: null,
						tool_calls: [
							{
								arguments: {
									location: "London",
								},
								name: "get_weather",
							},
						],
						usage: {
							completion_tokens: 23,
							prompt_tokens: 168,
							total_tokens: 191,
						},
					};
				},
			},
		});

		const result = await streamText({
			model: workersai(TEST_MODEL),
			prompt: "Get the weather information for London",
			tools: {
				get_weather: {
					description: "Get the weather in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "Raining" : "Sunny",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the weather for"),
					}),
				},
			},
		});

		const toolCalls: any = [];

		for await (const chunk of result.fullStream) {
			if (chunk.type === "tool-call") {
				toolCalls.push(chunk);
			}
		}

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls).toMatchObject([
			{
				args: { location: "London" },
				toolCallId: "get_weather",
				toolName: "get_weather",
				type: "tool-call",
			},
		]);
	});

	it("should handle new tool call inside response when last message is user message", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return {
						tool_calls: [
							{
								function: {
									arguments: '{"location": "London"}',
									name: "get_weather",
								},
								id: "chatcmpl-tool-b482f0e36b0c4190b9bee3fb61408a9e",
								type: "function",
							},

							{
								function: {
									arguments: '{"location": "London"}',
									name: "get_temperature",
								},
								id: "chatcmpl-tool-a482f0e36b0c4190b9bee3fb61408a9c",
								type: "function",
							},
						],
						usage: {
							completion_tokens: 17,
							prompt_tokens: 179,
							total_tokens: 196,
						},
					};
				},
			},
		});

		const result = await streamText({
			model: workersai(TEST_MODEL),
			prompt: "Get the weather information for London",
			tools: {
				get_temperature: {
					description: "Get the temperature in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "80" : "100",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the temperature for"),
					}),
				},
				get_weather: {
					description: "Get the weather in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "Raining" : "Sunny",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the weather for"),
					}),
				},
			},
		});

		const toolCalls: any = [];

		for await (const chunk of result.fullStream) {
			if (chunk.type === "tool-call") {
				toolCalls.push(chunk);
			}
		}

		expect(toolCalls).toHaveLength(2);
		expect(toolCalls[0]).toMatchObject({
			args: { location: "London" },
			toolCallId: "chatcmpl-tool-b482f0e36b0c4190b9bee3fb61408a9e",
			toolName: "get_weather",
			type: "tool-call",
		});
		expect(toolCalls[1]).toMatchObject({
			args: { location: "London" },
			toolCallId: "chatcmpl-tool-a482f0e36b0c4190b9bee3fb61408a9c",
			toolName: "get_temperature",
			type: "tool-call",
		});
	});

	it("should handle new tool call inside response when last message is user message", async () => {
		const workersai = createWorkersAI({
			binding: {
				run: async () => {
					return {
						id: "chatcmpl-2d657a54f93d4ecbb966cc50efd42819",
						object: "chat.completion",
						created: 1750346826,
						model: "@cf/qwen/qwen3-30b-a3b-fp8",
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									reasoning_content:
										"\nOkay, the user is asking for the weather in London. Let me check the tools available. There's a function called get_weather that takes a location parameter. Since London is the location mentioned, I need to call that function with \"London\" as the argument. I'll make sure the JSON is correctly formatted and enclosed within the tool_call tags.\n",
									content: "\n\n",
									tool_calls: [
										{
											id: "chatcmpl-tool-c267de54771c4833a823f423f0def197",
											type: "function",
											function: {
												name: "get_weather",
												arguments: '{"location": "London"}',
											},
										},
										{
											id: "chatcmpl-tool-a482f0e36b0c4190b9bee3fb61408a9c",
											type: "function",
											function: {
												name: "get_temperature",
												arguments: '{"location": "London"}',
											},
										},
									],
								},
								logprobs: null,
								finish_reason: "tool_calls",
								stop_reason: null,
							},
						],
						usage: {
							prompt_tokens: 169,
							completion_tokens: 94,
							total_tokens: 263,
						},
						prompt_logprobs: null,
					};
				},
			},
		});

		const result = await streamText({
			model: workersai(TEST_MODEL),
			prompt: "Get the weather information for London",
			tools: {
				get_temperature: {
					description: "Get the temperature in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "80" : "100",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the temperature for"),
					}),
				},
				get_weather: {
					description: "Get the weather in a location",
					execute: async ({ location }) => ({
						location,
						weather: location === "London" ? "Raining" : "Sunny",
					}),
					parameters: z.object({
						location: z.string().describe("The location to get the weather for"),
					}),
				},
			},
		});

		const toolCalls: any = [];
		let reasoning = "";

		for await (const chunk of result.fullStream) {
			if (chunk.type === "tool-call") {
				toolCalls.push(chunk);
			}

			if (chunk.type === "reasoning") {
				reasoning += chunk.textDelta;
			}
		}

		expect(reasoning).toEqual(
			"\nOkay, the user is asking for the weather in London. Let me check the tools available. There's a function called get_weather that takes a location parameter. Since London is the location mentioned, I need to call that function with \"London\" as the argument. I'll make sure the JSON is correctly formatted and enclosed within the tool_call tags.\n",
		);
		expect(toolCalls).toHaveLength(2);
		expect(toolCalls[0]).toMatchObject({
			args: { location: "London" },
			toolCallId: "chatcmpl-tool-c267de54771c4833a823f423f0def197",
			toolName: "get_weather",
			type: "tool-call",
		});
		expect(toolCalls[1]).toMatchObject({
			args: { location: "London" },
			toolCallId: "chatcmpl-tool-a482f0e36b0c4190b9bee3fb61408a9c",
			toolName: "get_temperature",
			type: "tool-call",
		});
	});
});

/**
 * Helper to produce SSE lines in a Node ReadableStream.
 * This is the crucial part: each line is preceded by "data: ",
 * followed by JSON or [DONE], then a newline+newline.
 */
function mockStream(sseLines: any[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of sseLines) {
				// Typically "line" is either an object or "[DONE]"
				if (typeof line === "string") {
					// e.g. the [DONE] marker
					controller.enqueue(encoder.encode(`data: ${line}\n\n`));
				} else {
					// Convert JS object (e.g. { response: "Hello " }) to JSON
					const jsonText = JSON.stringify(line);
					controller.enqueue(encoder.encode(`data: ${jsonText}\n\n`));
				}
			}
			controller.close();
		},
	});
}
