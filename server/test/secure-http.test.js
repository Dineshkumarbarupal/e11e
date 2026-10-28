import test from "node:test";
import assert from "node:assert/strict";
import { assertCredentialHeader, isPublicInternetAddress, prepareRequestHeaders, resolveOutboundTarget, validateHeaders } from "../src/secure-http.js";

test("public IP filter accepts representative public IPv4 and IPv6 addresses", () => {
  assert.equal(isPublicInternetAddress("8.8.8.8"), true);
  assert.equal(isPublicInternetAddress("93.184.216.34"), true);
  assert.equal(isPublicInternetAddress("2001:4860:4860::8888"), true);
});

test("public IP filter rejects loopback, private, link-local, documentation and reserved ranges", () => {
  for (const address of [
    "0.0.0.0", "10.2.3.4", "100.64.0.1", "127.0.0.1",
    "169.254.169.254", "172.16.1.2", "192.168.1.5",
    "198.18.0.1", "203.0.113.8", "224.0.0.1",
    "::", "::1", "fc00::1", "fd00::1", "fe80::1",
    "2001:db8::1", "2002::1", "not-an-ip"
  ]) assert.equal(isPublicInternetAddress(address), false, address);
});

test("outbound policy requires exact allow-list membership before DNS lookup", async () => {
  let lookedUp = false;
  await assert.rejects(
    () => resolveOutboundTarget("https://api.example.test/data", {
      allowedHosts: ["example.test"],
      lookup: async () => { lookedUp = true; return [{ address: "93.184.216.34", family: 4 }]; }
    }),
    /exact hostname/
  );
  assert.equal(lookedUp, false);
});

test("outbound policy rejects HTTP, URL credentials, IP literals and non-standard ports", async () => {
  const options = { allowedHosts: ["api.example.test"], lookup: async () => [{ address: "93.184.216.34", family: 4 }] };
  await assert.rejects(() => resolveOutboundTarget("http://api.example.test/", options), /HTTPS URLs only/);
  await assert.rejects(() => resolveOutboundTarget("https://user:pass@api.example.test/", options), /HTTPS URLs only/);
  await assert.rejects(() => resolveOutboundTarget("https://127.0.0.1/", options), /DNS hostname, not an IP literal/);
  await assert.rejects(() => resolveOutboundTarget("https://api.example.test:8443/", options), /port 443 only/);
});

test("outbound policy blocks private or mixed public/private DNS answers", async () => {
  const options = { allowedHosts: ["api.example.test"] };
  await assert.rejects(
    () => resolveOutboundTarget("https://api.example.test/", {
      ...options, lookup: async () => [{ address: "127.0.0.1", family: 4 }]
    }),
    /non-public IP address/
  );
  await assert.rejects(
    () => resolveOutboundTarget("https://api.example.test/", {
      ...options, lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 }
      ]
    }),
    /non-public IP address/
  );
});

test("outbound policy normalizes host case and returns a pinned public address", async () => {
  let lookupArgs;
  const target = await resolveOutboundTarget("https://API.EXAMPLE.TEST/items?q=1", {
    allowedHosts: ["api.example.test"],
    lookup: async (hostname, options) => {
      lookupArgs = { hostname, options };
      return [{ address: "93.184.216.34", family: 4 }, { address: "8.8.8.8", family: 4 }];
    }
  });
  assert.equal(target.hostname, "api.example.test");
  assert.equal(target.address, "93.184.216.34");
  assert.equal(lookupArgs.hostname, "api.example.test");
  assert.equal(lookupArgs.options.all, true);
  assert.equal(target.url.pathname, "/items");
});

test("user-configured request headers cannot override transport/security headers", () => {
  assert.deepEqual(validateHeaders({ accept: "application/json", "x-trace-id": "demo" }), {
    accept: "application/json", "x-trace-id": "demo"
  });
  for (const headers of [
    { Host: "127.0.0.1" }, { Authorization: "Bearer inline-secret" }, { "X-API-Key": "inline-secret" }, { "X-Auth-Token": "inline-secret" },
    { Cookie: "session=abc" }, { "X-Forwarded-For": "127.0.0.1" },
    { "x-test": "safe\r\nInjected: bad" }, { "content-length": "5" }
  ]) assert.throws(() => validateHeaders(headers));
});

test("vault credential headers reject forbidden names and CRLF injection", () => {
  assertCredentialHeader("Authorization", "Bearer example");
  assertCredentialHeader("X-API-Key", "example");
  assert.throws(() => assertCredentialHeader("Host", "127.0.0.1"), /not allowed/);
  assert.throws(() => assertCredentialHeader("Cookie", "session=x"), /not allowed/);
  assert.throws(() => assertCredentialHeader("X-API-Key", "abc\r\nInjected: value"), /invalid/);
});


test("vault credential headers are injected separately from untrusted headers", () => {
  const headers = prepareRequestHeaders({ Accept: "application/json" }, { name: "Authorization", value: "Bearer vault-value" });
  assert.equal(headers.authorization, "Bearer vault-value");
  assert.equal(headers.accept, "application/json");
  assert.equal(headers["user-agent"], "e11e-flow/0.1");
  assert.throws(() => prepareRequestHeaders({ Authorization: "inline-secret" }));
});
