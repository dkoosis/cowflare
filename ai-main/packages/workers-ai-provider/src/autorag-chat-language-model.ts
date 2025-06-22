import {
	type LanguageModelV1,
	type LanguageModelV1CallWarning,
	UnsupportedFunctionalityError,
} from "@ai-sdk/provider";

import type { AutoRAGChatSettings } from "./autorag-chat-settings";
import { convertToWorkersAIChatMessages } from "./convert-to-workersai-chat-messages";
import { mapWorkersAIUsage } from "./map-workersai-usage";
import { getMappedStream } from "./streaming";
import { prepareToolsAndToolChoice, processToolCalls } from "./utils";
import type { TextGenerationModels } from "./workersai-models";

type AutoRAGChatConfig = {
	provider: string;
	binding: AutoRAG;
	gateway?: GatewayOptions;
};

export class AutoRAGChatLanguageModel implements LanguageModelV1 {
	readonly specificationVersion = "v1";
	readonly defaultObjectGenerationMode = "json";

	readonly modelId: TextGenerationModels;
	readonly settings: AutoRAGChatSettings;

	private readonly config: AutoRAGChatConfig;

	constructor(
		modelId: TextGenerationModels,
		settings: AutoRAGChatSettings,
		config: AutoRAGChatConfig,
	) {
		this.modelId = modelId;
		this.settings = settings;
		this.config = config;
	}

	get provider(): string {
		return this.config.provider;
	}

	private getArgs({
		mode,
		prompt,
		frequencyPenalty,
		presencePenalty,
	}: Parameters<LanguageModelV1["doGenerate"]>[0]) {
		const type = mode.type;

		const warnings: LanguageModelV1CallWarning[] = [];

		if (frequencyPenalty != null) {
			warnings.push({
				setting: "frequencyPenalty",
				type: "unsupported-setting",
			});
		}

		if (presencePenalty != null) {
			warnings.push({
				setting: "presencePenalty",
				type: "unsupported-setting",
			});
		}

		const baseArgs = {
			// messages:
			messages: convertToWorkersAIChatMessages(prompt),
			// model id:
			model: this.modelId,
		};

		switch (type) {
			case "regular": {
				return {
					args: { ...baseArgs, ...prepareToolsAndToolChoice(mode) },
					warnings,
				};
			}

			case "object-json": {
				return {
					args: {
						...baseArgs,
						response_format: {
							json_schema: mode.schema,
							type: "json_schema",
						},
						tools: undefined,
					},
					warnings,
				};
			}

			case "object-tool": {
				return {
					args: {
						...baseArgs,
						tool_choice: "any",
						tools: [{ function: mode.tool, type: "function" }],
					},
					warnings,
				};
			}

			// @ts-expect-error - this is unreachable code
			// TODO: fixme
			case "object-grammar": {
				throw new UnsupportedFunctionalityError({
					functionality: "object-grammar mode",
				});
			}

			default: {
				const exhaustiveCheck = type satisfies never;
				throw new Error(`Unsupported type: ${exhaustiveCheck}`);
			}
		}
	}

	async doGenerate(
		options: Parameters<LanguageModelV1["doGenerate"]>[0],
	): Promise<Awaited<ReturnType<LanguageModelV1["doGenerate"]>>> {
		const { args, warnings } = this.getArgs(options);

		const { messages } = convertToWorkersAIChatMessages(options.prompt);

		const output = await this.config.binding.aiSearch({
			query: messages.map(({ content, role }) => `${role}: ${content}`).join("\n\n"),
		});

		return {
			finishReason: "stop",
			rawCall: { rawPrompt: args.messages, rawSettings: args },
			sources: output.data.map(({ file_id, filename, score }) => ({
				id: file_id,
				providerMetadata: {
					attributes: { score },
				},
				sourceType: "url",
				url: filename,
			})), // TODO: mapWorkersAIFinishReason(response.finish_reason),
			text: output.response,
			toolCalls: processToolCalls(output),
			usage: mapWorkersAIUsage(output),
			warnings,
		};
	}

	async doStream(
		options: Parameters<LanguageModelV1["doStream"]>[0],
	): Promise<Awaited<ReturnType<LanguageModelV1["doStream"]>>> {
		const { args, warnings } = this.getArgs(options);

		const { messages } = convertToWorkersAIChatMessages(options.prompt);

		const query = messages.map(({ content, role }) => `${role}: ${content}`).join("\n\n");

		const response = await this.config.binding.aiSearch({
			query,
			stream: true,
		});

		return {
			rawCall: { rawPrompt: args.messages, rawSettings: args },
			stream: getMappedStream(response),
			warnings,
		};
	}
}
