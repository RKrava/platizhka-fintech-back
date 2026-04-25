const test = require('node:test');
const assert = require('node:assert/strict');
const { installAxiosMock, freshRequire } = require('./helpers');

installAxiosMock();
const registry = freshRequire('../src/payments/registry');

const REQUIRED_METHODS = [
  'resolveCredentials',
  'createInvoice',
  'verifyWebhook',
  'parseWebhook',
];

test('registry: lists all wired providers', () => {
  const codes = registry.listProviders();
  assert.deepEqual(
    codes.sort(),
    ['fondy', 'hutko', 'liqpay', 'mono', 'mono_parts', 'wayforpay'].sort(),
  );
});

test('registry: every provider implements the full interface', () => {
  for (const code of registry.listProviders()) {
    const p = registry.getProvider(code);
    assert.equal(p.code, code, `${code}: provider.code must equal registry key`);
    assert.equal(typeof p.name, 'string', `${code}: needs human-readable name`);
    for (const m of REQUIRED_METHODS) {
      assert.equal(typeof p[m], 'function', `${code}: missing ${m}`);
    }
  }
});

test('registry: getProvider throws on unknown code', () => {
  assert.throws(() => registry.getProvider('not_a_real_provider'), /Unknown payment provider/);
});

test('registry: each provider resolves test credentials without throwing', () => {
  // Test mode should "just work" out of the box for every provider that
  // declared test_mode capability — meaning resolveCredentials({}, {isTest:true})
  // must NOT throw (uses public sandbox / env defaults).
  const sandboxFriendly = ['mono', 'mono_parts', 'hutko', 'wayforpay', 'fondy'];
  for (const code of sandboxFriendly) {
    const p = registry.getProvider(code);
    const c = p.resolveCredentials({}, { isTest: true });
    assert.equal(c.isTest, true, `${code}: must mark resolved creds as test`);
  }
  // LiqPay is the exception: there's no shared sandbox merchant — merchant
  // must paste their own sandbox keys. So it should throw without creds.
  assert.throws(
    () => registry.getProvider('liqpay').resolveCredentials({}, { isTest: true }),
    /public_key|private_key/,
  );
});
