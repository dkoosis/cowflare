import { AutoRAGChatLanguageModel } from "./autorag-chat-language-model";
import type { AutoRAGChatSettings } from "./autorag-chat-settings";
import { createRun } from "./utils";
import {
	WorkersAIEmbeddingModel,
	type WorkersAIEmbeddingSettings,
} from "./workers-ai-embedding-model";
import { WorkersAIChatLanguageModel } from "./workersai-chat-language-model";
import type { WorkersAIChatSettings } from "./workersai-chat-settings";
import { WorkersAIImageModel } from "./workersai-image-model";
import type { WorkersAIImageSettings } from "./workersai-image-settings";
import type {
	EmbeddingModels,
	ImageGenerationModels,
	TextGenerationModels,
} from "./workersai-models";

export type WorkersAISettings = (
	| {
			/**
			 * Provide a Cloudflare AI binding.
			 */
			binding: Ai;

			/**
			 * Credentials must be absent when a binding is given.
			 */
			accountId?: never;
			apiKey?: never;
	  }
	| {
			/**
			 * Provide Cloudflare API credentials directly. Must be used if a binding is not specified.
			 */
			accountId: string;
			apiKey: string;
			/**
			 * Both binding must be absent if credentials are used directly.
			 */
			binding?: never;
	  }
) & {
	/**
	 * Optionally specify a gateway.
	 */
	gateway?: GatewayOptions;
};

export interface WorkersAI {
	(modelId: TextGenerationModels, settings?: WorkersAIChatSettings): WorkersAIChatLanguageModel;
	/**
	 * Creates a model for text generation.
	 **/
	chat(
		modelId: TextGenerationModels,
		settings?: WorkersAIChatSettings,
	): WorkersAIChatLanguageModel;

	embedding(
		modelId: EmbeddingModels,
		settings?: WorkersAIEmbeddingSettings,
	): WorkersAIEmbeddingModel;

	textEmbedding(
		modelId: EmbeddingModels,
		settings?: WorkersAIEmbeddingSettings,
	): WorkersAIEmbeddingModel;

	textEmbeddingModel(
		modelId: EmbeddingModels,
		settings?: WorkersAIEmbeddingSettings,
	): WorkersAIEmbeddingModel;

	/**
	 * Creates a model for image generation.
	 **/
	image(modelId: ImageGenerationModels, settings?: WorkersAIImageSettings): WorkersAIImageModel;
}

/**
 * Create a Workers AI provider instance.
 */
export function createWorkersAI(options: WorkersAISettings): WorkersAI {
	// Use a binding if one is directly provided. Otherwise use credentials to create
	// a `run` method that calls the Cloudflare REST API.
	let binding: Ai | undefined;

	if (options.binding) {
		binding = options.binding;
	} else {
		const { accountId, apiKey } = options;
		binding = {
			run: createRun({ accountId, apiKey }),
		} as Ai;
	}

	if (!binding) {
		throw new Error("Either a binding or credentials must be provided.");
	}

	const createChatModel = (modelId: TextGenerationModels, settings: WorkersAIChatSettings = {}) =>
		new WorkersAIChatLanguageModel(modelId, settings, {
			binding,
			gateway: options.gateway,
			provider: "workersai.chat",
		});

	const createImageModel = (
		modelId: ImageGenerationModels,
		settings: WorkersAIImageSettings = {},
	) =>
		new WorkersAIImageModel(modelId, settings, {
			binding,
			gateway: options.gateway,
			provider: "workersai.image",
		});
	const createEmbeddingModel = (
		modelId: EmbeddingModels,
		settings: WorkersAIEmbeddingSettings = {},
	) =>
		new WorkersAIEmbeddingModel(modelId, settings, {
			binding,
			gateway: options.gateway,
			provider: "workersai.embedding",
		});

	const provider = (modelId: TextGenerationModels, settings?: WorkersAIChatSettings) => {
		if (new.target) {
			throw new Error("The WorkersAI model function cannot be called with the new keyword.");
		}
		return createChatModel(modelId, settings);
	};

	provider.chat = createChatModel;
	provider.embedding = createEmbeddingModel;
	provider.textEmbedding = createEmbeddingModel;
	provider.textEmbeddingModel = createEmbeddingModel;
	provider.image = createImageModel;
	provider.imageModel = createImageModel;

	return provider;
}

export type AutoRAGSettings = {
	binding: AutoRAG;
};

export interface AutoRAGProvider {
	(options?: AutoRAGChatSettings): AutoRAGChatLanguageModel;
	/**
	 * Creates a model for text generation.
	 **/
	chat(settings?: AutoRAGChatSettings): AutoRAGChatLanguageModel;
}

/**
 * Create a Workers AI provider instance.
 */
export function createAutoRAG(options: AutoRAGSettings): AutoRAGProvider {
	const binding = options.binding;

	const createChatModel = (settings: AutoRAGChatSettings = {}) =>
		// @ts-ignore Needs fix from @cloudflare/workers-types for custom types
		new AutoRAGChatLanguageModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast", settings, {
			binding,
			provider: "autorag.chat",
		});

	const provider = (settings?: AutoRAGChatSettings) => {
		if (new.target) {
			throw new Error("The WorkersAI model function cannot be called with the new keyword.");
		}
		return createChatModel(settings);
	};

	provider.chat = createChatModel;

	return provider;
}
