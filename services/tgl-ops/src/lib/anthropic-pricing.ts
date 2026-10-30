/**
 * Reads Anthropic model from ANTHROPIC_MODEL environment variable.
 * Fallback: fails loudly with a descriptive error — no hard-coded default allowed.
 */
export function getAnthropicModel(): string {
  const modelName = process.env.ANTHROPIC_MODEL?.trim();
  if (!modelName) {
    throw new Error(
      "Missing required environment variable ANTHROPIC_MODEL. Model must not be hard-coded (fallback: fail loudly, no default allowed)."
    );
  }
  return modelName;
}

/**
 * Reads token pricing (USD per MTok) from ANTHROPIC_PRICE_IN and ANTHROPIC_PRICE_OUT environment variables.
 * Fallback: fails loudly with a descriptive error if missing or invalid.
 */
export function getAnthropicPricing(): { priceInPerMTok: number; priceOutPerMTok: number } {
  const priceInRaw = process.env.ANTHROPIC_PRICE_IN?.trim();
  const priceOutRaw = process.env.ANTHROPIC_PRICE_OUT?.trim();

  if (!priceInRaw || isNaN(Number(priceInRaw))) {
    throw new Error(
      "Missing or invalid required environment variable ANTHROPIC_PRICE_IN. Must be USD price per MTok (e.g. '3.00')."
    );
  }
  if (!priceOutRaw || isNaN(Number(priceOutRaw))) {
    throw new Error(
      "Missing or invalid required environment variable ANTHROPIC_PRICE_OUT. Must be USD price per MTok (e.g. '15.00')."
    );
  }

  return {
    priceInPerMTok: Number(priceInRaw),
    priceOutPerMTok: Number(priceOutRaw),
  };
}
