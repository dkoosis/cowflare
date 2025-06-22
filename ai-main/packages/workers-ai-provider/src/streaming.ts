import type { LanguageModelV1StreamPart } from "@ai-sdk/provider";
import { events } from "fetch-event-stream";
import { mapWorkersAIUsage } from "./map-workersai-usage";
import { processPartialToolCalls } from "./utils";

export function getMappedStream(response: Response) {
	const chunkEvent = events(response);
	let usage = { completionTokens: 0, promptTokens: 0 };
	const partialToolCalls: any[] = [];

	return new ReadableStream<LanguageModelV1StreamPart>({
		async start(controller) {
			for await (const event of chunkEvent) {
				if (!event.data) {
					continue;
				}
				if (event.data === "[DONE]") {
					break;
				}
				const chunk = JSON.parse(event.data);
				if (chunk.usage) {
					usage = mapWorkersAIUsage(chunk);
				}
				if (chunk.tool_calls) {
					partialToolCalls.push(...chunk.tool_calls);
				}
				chunk.response?.length &&
					controller.enqueue({
						textDelta: chunk.response,
						type: "text-delta",
					});
				chunk?.choices?.[0]?.delta?.reasoning_content?.length &&
					controller.enqueue({
						type: "reasoning",
						textDelta: chunk.choices[0].delta.reasoning_content,
					});
			}

			if (partialToolCalls.length > 0) {
				const toolCalls = processPartialToolCalls(partialToolCalls);
				toolCalls.map((toolCall) => {
					controller.enqueue({
						type: "tool-call",
						...toolCall,
					});
				});
			}

			controller.enqueue({
				finishReason: "stop",
				type: "finish",
				usage: usage,
			});
			controller.close();
		},
	});
}
