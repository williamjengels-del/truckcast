// Static figures anchoring marketing copy on the public homepage and ROI
// calculator. Single source of truth for both the dollar value and the
// "last reviewed" footnote — keep them updated together.
//
// Refresh schedule: review every ~6 months. Recompute from current operator
// data, round to nearest $50, update LAST_REVIEWED date. Do not make this
// dynamic — static figure with a dated footnote is intentional (anchoring
// stability + defensibility on sales calls; live numbers drift as the data
// set shifts and copy can fall out of sync).
//
// To recompute:
//   SELECT AVG(net_sales) * (1 - 0.30) AS weather_loss_estimate
//   FROM events
//   WHERE user_id = '<julian-uuid>' AND net_sales IS NOT NULL;
//   -- 0.30 = WEATHER_COEFFICIENTS.Storms (verify in src/lib/constants.ts;
//   -- if the coefficient has been retuned, use the current value).
// Round result to the nearest $50 and update WEATHER_LOSS_PER_EVENT.

export const WEATHER_LOSS_PER_EVENT = 750;

export const WEATHER_LOSS_LAST_REVIEWED = "2026-05-03";
