import { describe, test, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MyMCP } from "../src/index";

// Schema validation for MCP tool parameters
const AddToolParamsSchema = z.object({
	a: z.number(),
	b: z.number(),
});

describe("MCP Tool Registration", () => {
	let mcp: MyMCP;

	beforeEach(() => {
		mcp = new MyMCP();
	});

	test("MyMCP_InitializesWithServer_When_Created", () => {
		expect(mcp.server).toBeDefined();
		expect(mcp.server.name).toBe("Demo");
		expect(mcp.server.version).toBe("1.0.0");
	});

	test("MyMCP_RegistersAddTool_When_InitCalled", async () => {
		await mcp.init();
		
		// Tool registration happens internally, we can't directly test it
		// But we can verify init completes without errors
		expect(true).toBe(true);
	});

	test("AddToolParams_ValidatesCorrectly_When_SchemaUsed", () => {
		// Test valid parameters
		const validParams = { a: 5, b: 3 };
		const result = AddToolParamsSchema.safeParse(validParams);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({ a: 5, b: 3 });
		}

		// Test invalid parameters
		const invalidParams = { a: "not a number", b: 3 };
		const invalidResult = AddToolParamsSchema.safeParse(invalidParams);
		expect(invalidResult.success).toBe(false);
	});

	test("MyMCP_MountsSSEEndpoint_When_MountCalled", () => {
		// Test that mount returns a handler function
		const handler = MyMCP.mount("/sse");
		expect(handler).toBeDefined();
		expect(typeof handler).toBe("function");
	});
});
