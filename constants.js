export const CHARS_PER_TOKEN = 4;
export const WH_PER_1K_OUTPUT_TOKENS = 0.3;
export const GRID_G_CO2_PER_KWH = 400;
export const WH_PER_1K_INPUT_TOKENS = 0.1;
export function estimate(userChars, assistantChars) {
  const inTok = userChars / CHARS_PER_TOKEN;
  const outTok = assistantChars / CHARS_PER_TOKEN;
  const wh =
    (inTok / 1000) * WH_PER_1K_INPUT_TOKENS +
    (outTok / 1000) * WH_PER_1K_OUTPUT_TOKENS;
  return {
    tokens: Math.round(inTok + outTok),
    gCO2: (wh / 1000) * GRID_G_CO2_PER_KWH,
  };
}