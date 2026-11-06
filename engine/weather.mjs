// The weather = NEAR's real weekly closes, Oct 2023 onward. Game day d uses week d.
import fs from "node:fs";
import { CFG } from "./config.mjs";

const ohlc = Object.values(JSON.parse(fs.readFileSync("spikes/out/near-weekly-kraken.json", "utf8")).result).find(Array.isArray);
const closes = ohlc.map((r) => ({ t: r[0], close: Number(r[4]) }));

export function weather(day) {
  const i = Math.min(Math.max(day, 1), CFG.weatherWeeks);
  const change = closes[i].close / closes[i - 1].close - 1;
  const hot = Math.max(-0.5, Math.min(1, change * CFG.weatherGain));
  return {
    week: new Date(closes[i].t * 1000).toISOString().slice(0, 10),
    price: closes[i].close,
    change,
    hot,
    pace: 1 + hot * CFG.paceSwing,
    mistake: CFG.baseMistake + Math.max(0, hot) * CFG.hotMistake,
    label: hot > 0.3 ? "hot" : hot < -0.15 ? "cold" : "mild",
  };
}
