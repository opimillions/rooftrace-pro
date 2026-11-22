/**
 * Price list catalog — the line items the roofing estimate prices.
 * Keys match estimateState in public/tool.html.
 * `defaults` are placeholder prices until the Xactimate DFW sheet is loaded.
 */
const ITEMS = [
  { key: 'tearOffSqPrice',      label: 'Tear-off + haul',        unit: 'SQ',  default: 75 },
  { key: 'shingleSqPrice',      label: 'Shingles, installed',    unit: 'SQ',  default: 425 },
  { key: 'underlaymentSqPrice', label: 'Underlayment',           unit: 'SQ',  default: 35 },
  { key: 'deckingSqPrice',      label: 'Roof decking (OSB)',     unit: 'SQ',  default: 250 },
  { key: 'starterLfPrice',      label: 'Starter strip',          unit: 'LF',  default: 2.25 },
  { key: 'ridgeCapLfPrice',     label: 'Hip/ridge cap',          unit: 'LF',  default: 7.5 },
  { key: 'dripEdgeLfPrice',     label: 'Drip edge',              unit: 'LF',  default: 2.85 },
  { key: 'valleyLfPrice',       label: 'Valley metal',           unit: 'LF',  default: 9 },
  { key: 'flashingLot',         label: 'Flashing',               unit: 'LOT', default: 350 },
  { key: 'ventLot',             label: 'Vents',                  unit: 'LOT', default: 225 },
  { key: 'permitLot',           label: 'Permit',                 unit: 'LOT', default: 175 },
  { key: 'overheadPct',         label: 'Overhead',               unit: '%',   default: 10 },
  { key: 'profitPct',           label: 'Profit',                 unit: '%',   default: 10 },
  { key: 'taxPct',              label: 'Tax',                    unit: '%',   default: 0 },
];
const KEYS = ITEMS.map(i => i.key);

function defaultPrices() {
  return Object.fromEntries(ITEMS.map(i => [i.key, i.default]));
}

// Keep only known keys with sane numeric values.
function cleanPrices(input) {
  const out = {};
  for (const k of KEYS) {
    const v = Number(input?.[k]);
    if (Number.isFinite(v) && v >= 0 && v < 1e6) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

function cleanCodes(input) {
  const out = {};
  for (const k of KEYS) {
    const v = String(input?.[k] ?? '').trim().slice(0, 30);
    if (v) out[k] = v;
  }
  return out;
}

// Line-by-line differences between two price sets.
function diffPrices(from = {}, to = {}) {
  return ITEMS
    .filter(i => to[i.key] !== undefined && Number(from[i.key]) !== Number(to[i.key]))
    .map(i => ({ key: i.key, label: i.label, unit: i.unit, from: from[i.key] ?? null, to: to[i.key] }));
}

module.exports = { ITEMS, KEYS, defaultPrices, cleanPrices, cleanCodes, diffPrices };
