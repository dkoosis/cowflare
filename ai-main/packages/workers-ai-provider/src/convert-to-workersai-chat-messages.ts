import type { LanguageModelV1Prompt, LanguageModelV1ProviderMetadata } from "@ai-sdk/provider";
import type { WorkersAIChatPrompt } from "./workersai-chat-prompt";

export function convertToWorkersAIChatMessages(prompt: LanguageModelV1Prompt): {
	messages: WorkersAIChatPrompt;
	images: {
		mimeType: string | undefined;
		image: Uint8Array;
		providerMetadata: LanguageModelV1ProviderMetadata | undefined;
	}[];
} {
	const messages: WorkersAIChatPrompt = [];
	const images: {
		mimeType: string | undefined;
		image: Uint8Array;
		providerMetadata: LanguageModelV1ProviderMetadata | undefined;
	}[] = [];

	for (const { role, content } of prompt) {
		switch (role) {
			case "system": {
				messages.push({ content, role: "system" });
				break;
			}

			case "user": {
				messages.push({
					content: content
						.map((part) => {
							switch (part.type) {
								case "text": {
									return part.text;
								}
								case "image": {
									// Extract image from this part
									if (part.image instanceof Uint8Array) {
										// Store the image data directly as Uint8Array
										// For Llama 3.2 Vision model, which needs array of integers
										images.push({
											image: part.image,
											mimeType: part.mimeType,
											providerMetadata: part.providerMetadata,
										});
									}
									return ""; // No text for the image part
								}
							}
						})
						.join("\n"),
					role: "user",
				});
				break;
			}

			case "assistant": {
				let text = "";
				const toolCalls: Array<{
					id: string;
					type: "function";
					function: { name: string; arguments: string };
				}> = [];

				for (const part of content) {
					switch (part.type) {
						case "text": {
							text += part.text;
							break;
						}

						case "reasoning": {
							text += part.text;
							break;
						}

						case "tool-call": {
							text = JSON.stringify({
								name: part.toolName,
								parameters: part.args,
							});

							toolCalls.push({
								function: {
									arguments: JSON.stringify(part.args),
									name: part.toolName,
								},
								id: part.toolCallId,
								type: "function",
							});
							break;
						}
						default: {
							const exhaustiveCheck = part;
							throw new Error(`Unsupported part type: ${exhaustiveCheck.type}`);
						}
					}
				}

				messages.push({
					content: text,
					role: "assistant",
					tool_calls:
						toolCalls.length > 0
							? toolCalls.map(({ function: { name, arguments: args } }) => ({
									function: { arguments: args, name },
									id: "null",
									type: "function",
								}))
							: undefined,
				});

				break;
			}

			case "tool": {
				for (const toolResponse of content) {
					messages.push({
						content: JSON.stringify(toolResponse.result),
						name: toolResponse.toolName,
						role: "tool",
					});
				}
				break;
			}

			default: {
				const exhaustiveCheck = role satisfies never;
				throw new Error(`Unsupported role: ${exhaustiveCheck}`);
			}
		}
	}

	return { images, messages };
}
