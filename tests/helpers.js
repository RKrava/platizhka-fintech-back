/**
 * Test helpers — minimal axios mock + shared fixtures.
 *
 * Why a custom mock instead of jest/sinon/etc.:
 *   We use Node's built-in `node:test`, no test deps. The providers all
 *   `require('axios')`, so we replace the same module in `require.cache`
 *   with a stub before requiring the provider module.
 */

const Module = require('module');

/**
 * Replace `axios` in the require cache with a programmable mock.
 * Call `setRoute(method, urlMatcher, handler)` to register canned responses.
 * Returns the mock so you can also inspect `.calls`.
 */
function installAxiosMock() {
  const calls = [];
  const routes = [];

  const handler = async (config) => {
    calls.push(config);
    const r = routes.find((rt) => rt.matches(config));
    if (!r) {
      const url = config.url || (typeof config === 'string' ? config : '?');
      throw new Error(`Unmocked axios call: ${config.method || 'GET'} ${url}`);
    }
    const out = await r.respond(config);
    return {
      data: out.data ?? null,
      status: out.status ?? 200,
      headers: out.headers ?? {},
      config,
    };
  };

  const axiosFn = (config) => handler(typeof config === 'string' ? { url: config, method: 'get' } : config);
  axiosFn.get = (url, opts = {}) => handler({ ...opts, url, method: 'get' });
  axiosFn.post = (url, data, opts = {}) => handler({ ...opts, url, method: 'post', data });
  axiosFn.put = (url, data, opts = {}) => handler({ ...opts, url, method: 'put', data });
  axiosFn.delete = (url, opts = {}) => handler({ ...opts, url, method: 'delete' });

  axiosFn.calls = calls;
  axiosFn.setRoute = (method, urlMatcher, respond) => {
    routes.push({
      matches: (cfg) =>
        (cfg.method || 'get').toLowerCase() === method.toLowerCase() &&
        (typeof urlMatcher === 'string'
          ? cfg.url === urlMatcher
          : urlMatcher.test(cfg.url || '')),
      respond,
    });
  };
  axiosFn.reset = () => {
    routes.length = 0;
    calls.length = 0;
  };

  // Install in require.cache so providers `require('axios')` get our mock.
  const axiosPath = require.resolve('axios');
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: axiosFn,
  };
  return axiosFn;
}

/**
 * Force-reload provider files so they pick up the freshly installed axios mock.
 * Important: drop both registry and providers from cache.
 */
function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

module.exports = { installAxiosMock, freshRequire, Module };
