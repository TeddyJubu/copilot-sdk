import type { ToolModelOutput } from "./tool-output";
/**
 * Tool Helper
 *
 * Create type-safe tools with Zod schema validation.
 *
 * @example
 * ```ts
 * import { tool } from '@yourgpt/llm-sdk';
 * import { z } from 'zod';
 *
 * const weatherTool = tool({
 *   description: 'Get current weather for a city',
 *   parameters: z.object({
 *     city: z.string().describe('City name'),
 *     unit: z.enum(['celsius', 'fahrenheit']).optional(),
 *   }),
 *   execute: async ({ city, unit }) => {
 *     const data = await fetchWeather(city);
 *     return { temperature: data.temp, condition: data.condition };
 *   },
 * });
 * ```
 */

import type { z } from "zod";
import type { Tool, ToolContext } from "./types";

/**
 * Configuration for creating a tool
 */
export interface ToolConfig<TParams extends z.ZodType, TResult = unknown> {
  /** Description of what the tool does (shown to LLM) */
  description: string;

  /** Zod schema defining the tool's parameters */
  parameters: TParams;

  /** Function to execute when the tool is called */
  execute: (params: z.infer<TParams>, context: ToolContext) => Promise<TResult>;

  /** Map the raw result to explicit text/image content for the model. */
  toModelOutput?: (result: TResult) => ToolModelOutput | undefined;
  /**
   * Hide this tool's execution from the chat UI.
   * When true, tool calls and results won't be displayed to the user,
   * but the tool will still execute normally.
   * @default false
   */
  hidden?: boolean;
}

/**
 * Create a type-safe tool definition
 *
 * @param config - Tool configuration with description, parameters, and execute function
 * @returns A Tool object that can be passed to generateText/streamText
 *
 * @example
 * ```ts
 * const searchTool = tool({
 *   description: 'Search for products in the database',
 *   parameters: z.object({
 *     query: z.string(),
 *     maxResults: z.number().optional().default(10),
 *   }),
 *   execute: async ({ query, maxResults }) => {
 *     return await db.products.search(query, maxResults);
 *   },
 * });
 *
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find me some headphones',
 *   tools: { search: searchTool },
 * });
 * ```
 */
export function tool<TParams extends z.ZodType, TResult = unknown>(
  config: ToolConfig<TParams, TResult>,
): Tool<z.infer<TParams>, TResult> {
  return {
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
    hidden: config.hidden,
    toModelOutput: config.toModelOutput,
  };
}

/**
 * Convert a Tool's Zod schema to JSON Schema format
 * Used internally when sending tools to LLM providers
 */
export function toolToJsonSchema(toolDef: Tool<any, any>): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  const schema = zodToJsonSchema(toolDef.parameters);
  return {
    type: "object",
    properties: schema.properties ?? {},
    required: schema.required,
  };
}

/**
 * Convert Zod schema to JSON Schema
 * Handles common Zod types used in tool definitions
 */
function zodToJsonSchema(schema: z.ZodType): {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: unknown[];
  description?: string;
  anyOf?: unknown[];
} {
  const def = (schema as unknown as { _def: unknown })._def as Record<
    string,
    unknown
  >;
  const typeName = def.typeName as string;

  // Handle descriptions
  const description = def.description as string | undefined;

  switch (typeName) {
    case "ZodString":
      return { type: "string", description };

    case "ZodNumber":
      return {
        type: (def.checks as Array<{ kind: string }> | undefined)?.some(
          (check) => check.kind === "int",
        )
          ? "integer"
          : "number",
        description,
      };

    case "ZodNull":
      return { type: "null", description };

    case "ZodAny":
    case "ZodUnknown":
      return { description };

    case "ZodEffects":
      // The provider sees the input schema; local parsing still applies refinements/transforms.
      return {
        ...zodToJsonSchema(def.schema as z.ZodType),
        ...(description ? { description } : {}),
      };

    case "ZodBoolean":
      return { type: "boolean", description };

    case "ZodEnum": {
      const values = def.values as unknown[];
      return { type: "string", enum: values, description };
    }

    case "ZodArray": {
      const innerType = def.type as z.ZodType;
      return {
        type: "array",
        items: zodToJsonSchema(innerType),
        description,
      };
    }

    case "ZodObject": {
      const shape = def.shape as () => Record<string, z.ZodType>;
      const shapeObj = shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shapeObj)) {
        Object.defineProperty(properties, key, {
          value: zodToJsonSchema(value),
          enumerable: true,
          configurable: true,
          writable: true,
        });

        // Nullable accepts null, not a missing property.
        if (!acceptsMissingInput(value)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        description,
      };
    }

    case "ZodNullable": {
      return {
        anyOf: [zodToJsonSchema(def.innerType as z.ZodType), { type: "null" }],
        description,
      };
    }

    case "ZodOptional": {
      const innerType = def.innerType as z.ZodType;
      return zodToJsonSchema(innerType);
    }

    case "ZodDefault": {
      const innerType = def.innerType as z.ZodType;
      return zodToJsonSchema(innerType);
    }

    case "ZodLiteral": {
      const value = def.value;
      if (value === null) return { type: "null", description };
      if (typeof value === "string") {
        return { type: "string", enum: [value], description };
      }
      if (typeof value === "number") {
        return { type: "number", enum: [value], description };
      }
      if (typeof value === "boolean") {
        return { type: "boolean", enum: [value], description };
      }
      return { description };
    }

    case "ZodUnion": {
      // For simple string unions, convert to enum
      const options = def.options as z.ZodType[];
      const stringLiterals: string[] = [];

      for (const option of options) {
        const optDef = (option as unknown as { _def: Record<string, unknown> })
          ._def;
        if (
          optDef.typeName === "ZodLiteral" &&
          typeof optDef.value === "string"
        ) {
          stringLiterals.push(optDef.value as string);
        }
      }

      if (stringLiterals.length === options.length) {
        return { type: "string", enum: stringLiterals, description };
      }

      return { anyOf: options.map(zodToJsonSchema), description };
    }

    default:
      // Fallback for unknown types
      return { type: "string", description };
  }
}

function acceptsMissingInput(schema: z.ZodType): boolean {
  const def = (schema as unknown as { _def: Record<string, any> })._def;
  if (
    ["ZodOptional", "ZodDefault", "ZodAny", "ZodUnknown"].includes(def.typeName)
  )
    return true;
  if (def.typeName === "ZodNullable") return acceptsMissingInput(def.innerType);
  if (def.typeName === "ZodEffects") return acceptsMissingInput(def.schema);
  if (def.typeName === "ZodUnion") return def.options.some(acceptsMissingInput);
  return false;
}

/**
 * Format tools for OpenAI API format
 */
export function formatToolsForOpenAI(
  tools: Record<string, Tool<any, any>>,
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> {
  return Object.entries(tools).map(([name, toolDef]) => ({
    type: "function" as const,
    function: {
      name,
      description: toolDef.description,
      parameters: toolToJsonSchema(toolDef),
    },
  }));
}

/**
 * Format tools for Anthropic API format
 */
export function formatToolsForAnthropic(
  tools: Record<string, Tool<any, any>>,
): Array<{
  name: string;
  description: string;
  input_schema: object;
}> {
  return Object.entries(tools).map(([name, toolDef]) => ({
    name,
    description: toolDef.description,
    input_schema: toolToJsonSchema(toolDef),
  }));
}

/**
 * Format tools for Google Gemini API format
 */
export function formatToolsForGoogle(
  tools: Record<string, Tool<any, any>>,
): Array<{
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters?: object;
  }>;
}> {
  return [
    {
      functionDeclarations: Object.entries(tools).map(([name, toolDef]) => ({
        name,
        description: toolDef.description,
        parameters: toolToJsonSchema(toolDef),
      })),
    },
  ];
}
