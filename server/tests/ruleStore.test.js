const { RuleStore } = require('../src/services/ruleStore');

test('caches rules so the loader is not hit on every request', async () => {
  const loader = jest.fn(async () => [{ name: 'a', limit: 1 }]);
  const store = new RuleStore({ loader, ttlMs: 60000 });
  await Promise.all(Array.from({ length: 100 }, () => store.get('a')));
  await store.get('a');
  expect(loader).toHaveBeenCalledTimes(1);
});

test('invalidate() forces a reload', async () => {
  const loader = jest.fn(async () => [{ name: 'a', limit: 1 }]);
  const store = new RuleStore({ loader, ttlMs: 60000 });
  await store.get('a');
  store.invalidate();
  await store.get('a');
  expect(loader).toHaveBeenCalledTimes(2);
});

test('falls back to built-in rules when the database is down on a cold start', async () => {
  const store = new RuleStore({ loader: async () => { throw new Error('down'); }, ttlMs: 60000 });
  expect(await store.get('default')).toMatchObject({ algorithm: 'token_bucket' });
});

test('keeps serving last known rules when a later reload fails', async () => {
  let fail = false;
  const store = new RuleStore({
    ttlMs: 0,
    loader: async () => {
      if (fail) throw new Error('down');
      return [{ name: 'x', limit: 9 }];
    },
  });
  expect(await store.get('x')).toMatchObject({ limit: 9 });
  fail = true;
  expect(await store.get('x')).toMatchObject({ limit: 9 });
});
