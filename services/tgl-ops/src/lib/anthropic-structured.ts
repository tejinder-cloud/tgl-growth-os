// services/tgl-ops/src/lib/anthropic-structured.ts
// Shared helper for structured Anthropic calls without forced tool_choice.
// Uses tool_choice auto + required system line + tool_use block + outermost-braces text fallback.

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel, getAnthropicPricing } from "./anthropic-pricing.js";
import { appendLog } from "./log.js";

export interface StructuredToolCallOptions {
  client?: Pick<Anthropic, "messages"> | Anthropic;
  model?: string;
  maxTokens?: number;
  system: string;
  messages: Anthropic.MessageParam[];
  tool: Anthropic.Tool;
  agent?: string;
}

export interface StructuredToolResult<T> {
  data: T;
  rawReply: string;
  method: "tool_use" | "text_fallback";
  model: string;
  usd: number;
  tokens: {
    in: number;
    out: number;
  };
}

/**
 * Strips everything outside the outermost braces before parsing.
 * Supports XML <invoke><parameter> tags if the model returns tool invocation XML.
 */
export function extractOutermostJson<T = any>(text: string): T {
  if (!text || !text.trim()) {
    throw new Error("model returned no JSON object");
  }

  // If the model wrapped in <invoke name="..."> tags, extract parameters
  if (text.includes("<invoke") && text.includes("<parameter")) {
    const obj: Record<string, any> = {};
    const matches = text.matchAll(/<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi);
    for (const m of matches) {
      const key = m[1].trim();
      const valStr = m[2].trim();
      try {
        obj[key] = JSON.parse(valStr);
      } catch {
        obj[key] = valStr;
      }
    }
    if (Object.keys(obj).length > 0) return obj as T;
  }

  // Strip everything outside the outermost braces before parsing
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("model returned no JSON object");
  }
  const stripped = text.slice(start, end + 1).trim();
  return JSON.parse(stripped) as T;
}

/**
 * Calls Anthropic with tool_choice auto, a system line requiring the named tool,
 * reads the tool_use block, and on a text reply strips to the outermost braces and parses,
 * logging the raw reply on failure.
 */
export async function callStructuredTool<T = any>(
  options: StructuredToolCallOptions
): Promise<StructuredToolResult<T>> {
  const model = options.model || getAnthropicModel();
  const { priceInPerMTok, priceOutPerMTok } = getAnthropicPricing();
  const anthropic =
    options.client ??
    new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // System line requiring the named tool
  const requirementLine = `You MUST respond by calling the \`${options.tool.name}\` tool.`;
  const systemPrompt = options.system.includes(requirementLine)
    ? options.system
    : `${options.system}\n\n${requirementLine}`;

  const res: any = await anthropic.messages.create({
    model,
    max_tokens: options.maxTokens ?? 4096,
    system: systemPrompt,
    messages: options.messages,
    tools: [options.tool],
    tool_choice: { type: "auto" },
  });

  const tin = res.usage?.input_tokens ?? 0;
  const tout = res.usage?.output_tokens ?? 0;
  const usd = (tin * priceInPerMTok + tout * priceOutPerMTok) / 1_000_000;

  // 1. Reads the tool_use block
  const toolBlock = (res.content ?? []).find(
    (b: any) => b.type === "tool_use" && b.name === options.tool.name
  );

  if (toolBlock && toolBlock.input) {
    const raw =
      typeof toolBlock.input === "string"
        ? JSON.parse(toolBlock.input)
        : toolBlock.input;
    return {
      data: raw as T,
      rawReply:
        typeof toolBlock.input === "string"
          ? toolBlock.input
          : JSON.stringify(toolBlock.input),
      method: "tool_use",
      model,
      usd,
      tokens: { in: tin, out: tout },
    };
  }

  // 2. On a text reply, strips to the outermost braces and parses, logging raw reply on failure
  const textBlocks = (res.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  try {
    const parsed = extractOutermostJson<T>(textBlocks);
    return {
      data: parsed,
      rawReply: textBlocks,
      method: "text_fallback",
      model,
      usd,
      tokens: { in: tin, out: tout },
    };
  } catch (parseErr: any) {
    const agentName = options.agent || "structured-tool";
    await appendLog({
      agent: agentName,
      text: `proposal parse failure: ${textBlocks.slice(0, 1000) || String(parseErr?.message)}`,
    }).catch(() => {});

    throw parseErr;
  }
}
