export function mapWorkersAIUsage(output: AiTextGenerationOutput | AiTextToImageOutput) {
	const usage = (
		output as {
			usage: { prompt_tokens: number; completion_tokens: number };
		}
	).usage ?? {
		completion_tokens: 0,
		prompt_tokens: 0,
	};

	return {
		completionTokens: usage.completion_tokens,
		promptTokens: usage.prompt_tokens,
	};
}
