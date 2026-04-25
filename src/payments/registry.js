/**
 * Provider registry.
 *
 * Add a new provider in 3 steps:
 *   1. Drop `src/payments/providers/<code>.js` implementing the interface
 *      documented in `./types.js`.
 *   2. Register it below.
 *   3. (Optional) add platform-test env var convention to its `resolveCredentials`.
 *
 * Lookups go via `getProvider(code)` — throws if unknown.
 */

const monobankAcquiring = require('./providers/monobankAcquiring');
const monobankParts = require('./providers/monobankParts');
const hutko = require('./providers/hutko');
const liqpay = require('./providers/liqpay');
const wayforpay = require('./providers/wayforpay');
const fondy = require('./providers/fondy');

const PROVIDERS = {
  mono: monobankAcquiring,
  mono_parts: monobankParts,
  hutko,
  liqpay,
  wayforpay,
  fondy,
};

function getProvider(code) {
  const p = PROVIDERS[code];
  if (!p) throw new Error(`Unknown payment provider: ${code}`);
  return p;
}

function listProviders() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, listProviders };
