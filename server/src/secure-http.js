import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

const MAX_URL_LENGTH = 2048;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
const DNS_TIMEOUT_MS = 4000;
const FORBIDDEN_CONFIG_HEADERS = new Set([
  "host", "content-length", "transfer-encoding", "connection", "proxy-authorization",
  "proxy-authenticate", "proxy-connection", "cookie", "set-cookie", "authorization",
  "x-api-key", "api-key", "x-auth-token", "x-access-token"
]);
const FORBIDDEN_CREDENTIAL_HEADERS = new Set([
  "host", "content-length", "transfer-encoding", "connection", "proxy-authorization",
  "proxy-authenticate", "proxy-connection", "cookie", "set-cookie"
]);

function inIpv4Prefix(value, network, bits) {
  const shift = BigInt(32 - bits);
  return (value >> shift) === (network >> shift);
}

function ipv4ToInteger(address) {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
}

function ipv6ToInteger(address) {
  const value = address.toLowerCase();
  if (!value.includes(":") || value.includes("%") || value.includes(".")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if ((halves.length === 1 && left.length !== 8) || (halves.length === 2 && missing < 1)) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some(group => !/^[a-f0-9]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function inIpv6Prefix(value, network, bits) {
  const shift = BigInt(128 - bits);
  return (value >> shift) === (network >> shift);
}

/** Conservative public-address check for server-side HTTP egress. */
export function isPublicInternetAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToInteger(address);
    if (value === null) return false;
    const denied = [
      [0x00000000n, 8], [0x0a000000n, 8], [0x64400000n, 10],
      [0x7f000000n, 8], [0xa9fe0000n, 16], [0xac100000n, 12],
      [0xc0000000n, 24], [0xc0000200n, 24], [0xc0586300n, 24],
      [0xc0a80000n, 16], [0xc6120000n, 15], [0xc6336400n, 24],
      [0xcb007100n, 24], [0xe0000000n, 4], [0xf0000000n, 4]
    ];
    return !denied.some(([network, bits]) => inIpv4Prefix(value, network, bits));
  }
  if (family === 6) {
    const value = ipv6ToInteger(address);
    if (value === null) return false;
    if (!inIpv6Prefix(value, 0x20000000000000000000000000000000n, 3)) return false;
    const denied = [
      [0x20010000000000000000000000000000n, 23],
      [0x20010db8000000000000000000000000n, 32],
      [0x20020000000000000000000000000000n, 16],
      [0x3fff0000000000000000000000000000n, 20]
    ];
    return !denied.some(([network, bits]) => inIpv6Prefix(value, network, bits));
  }
  return false;
}

function normalizeAllowedHosts(value) {
  const hosts = Array.isArray(value) ? value : [];
  return new Set(hosts.map(host => String(host).trim().toLowerCase().replace(/\.$/, ""))
    .filter(host => host && !host.includes("*") && !host.startsWith(".") && !host.endsWith(".")));
}

async function lookupWithTimeout(hostname, lookup) {
  let timer;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS resolution timed out.")), DNS_TIMEOUT_MS);
        if (typeof timer.unref === "function") timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Resolve, validate and pin the outbound target before opening a TLS connection. */
export async function resolveOutboundTarget(input, { allowedHosts = [], lookup = dnsLookup } = {}) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new Error("Outbound network policy requires a valid URL of at most 2048 characters.");
  }
  let url;
  try { url = new URL(input); } catch { throw new Error("Outbound network policy blocks an invalid URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Outbound network policy permits HTTPS URLs only, without user information or fragments.");
  }
  if (url.port && url.port !== "443") throw new Error("Outbound network policy permits HTTPS port 443 only.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || isIP(hostname)) throw new Error("Outbound network policy requires an allow-listed DNS hostname, not an IP literal.");
  if (!normalizeAllowedHosts(allowedHosts).has(hostname)) {
    throw new Error("Outbound network policy blocks '" + hostname + "': add the exact hostname to HTTP_ALLOWED_HOSTS.");
  }
  let addresses;
  try { addresses = await lookupWithTimeout(hostname, lookup); }
  catch { throw new Error("Outbound network policy could not safely resolve '" + hostname + "'."); }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("Outbound network policy could not resolve '" + hostname + "'.");
  }
  if (addresses.some(item => !item || !isPublicInternetAddress(item.address))) {
    throw new Error("Outbound network policy blocks '" + hostname + "' because DNS returned a non-public IP address.");
  }
  const target = addresses[0];
  return { url, hostname, address: target.address, family: target.family || isIP(target.address) };
}

function validateHeaders(inputHeaders) {
  if (inputHeaders == null) return {};
  if (typeof inputHeaders !== "object" || Array.isArray(inputHeaders)) throw new Error("HTTP headers must be a JSON object.");
  const headers = {};
  for (const [name, rawValue] of Object.entries(inputHeaders)) {
    const key = String(name).toLowerCase();
    if (!/^[!#$%&'*+\-.^_\x60|~0-9a-z]+$/i.test(name)) throw new Error("Invalid HTTP header name.");
    if (FORBIDDEN_CONFIG_HEADERS.has(key)) {
      throw new Error("Header '" + name + "' is managed by e11e and cannot be configured directly.");
    }
    if (key.startsWith("x-forwarded-") || key.startsWith("proxy-")) throw new Error("Forwarding and proxy headers are not allowed.");
    if (!["string", "number", "boolean"].includes(typeof rawValue)) throw new Error("Header '" + name + "' must have a scalar value.");
    const value = String(rawValue);
    if (value.length > 8192 || /[\r\n]/.test(value)) throw new Error("Header '" + name + "' has an invalid value.");
    headers[key] = value;
  }
  return headers;
}

export function assertCredentialHeader(name, value) {
  if (typeof name !== "string" || !/^[!#$%&'*+\-.^_\x60|~0-9a-z]+$/i.test(name)) throw new Error("Invalid credential header name.");
  const key = name.toLowerCase();
  if (FORBIDDEN_CREDENTIAL_HEADERS.has(key) || key.startsWith("x-forwarded-") || key.startsWith("proxy-")) {
    throw new Error("Credential header '" + name + "' is not allowed.");
  }
  if (typeof value !== "string" || value.length > 8192 || /[\r\n]/.test(value)) throw new Error("Credential header value is invalid.");
}

function prepareRequestHeaders(inputHeaders, credentialHeader) {
  const headers = validateHeaders(inputHeaders);
  if (credentialHeader) {
    assertCredentialHeader(credentialHeader.name, credentialHeader.value);
    headers[String(credentialHeader.name).toLowerCase()] = credentialHeader.value;
  }
  headers["user-agent"] = headers["user-agent"] || "e11e-flow/0.1";
  return headers;
}

/** Execute exactly one HTTPS request; redirects are reported but never followed. */
export async function executeSecureHttpRequest({ url, method = "GET", headers = {}, body, timeoutMs = 10000, credentialHeader }, options = {}) {
  const target = await resolveOutboundTarget(url, options);
  const requestMethod = String(method || "GET").toUpperCase();
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(requestMethod)) {
    throw new Error("HTTP method is not supported by the secure outbound executor.");
  }
  const requestHeaders = prepareRequestHeaders(headers, credentialHeader);
  let payload;
  if (!["GET", "HEAD"].includes(requestMethod) && body !== undefined && body !== null && body !== "") {
    payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    if (payload.length > MAX_REQUEST_BODY_BYTES) throw new Error("Outbound HTTP request body exceeds the 64 KiB limit.");
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const pinnedLookup = (requestedHost, lookupOptions, callback) => {
      if (String(requestedHost).toLowerCase().replace(/\.$/, "") !== target.hostname) {
        callback(new Error("Outbound DNS host changed during connection."));
        return;
      }
      const answer = { address: target.address, family: target.family };
      if (lookupOptions?.all) callback(null, [answer]);
      else callback(null, answer.address, answer.family);
    };
    const timeout = Math.min(Math.max(Number(timeoutMs) || 10000, 1000), 30000);
    const request = httpsRequest(target.url, {
      method: requestMethod,
      headers: requestHeaders,
      lookup: pinnedLookup,
      servername: target.hostname,
      rejectUnauthorized: true,
      agent: false,
      timeout,
      maxHeaderSize: 16 * 1024
    }, response => {
      const chunks = [];
      let length = 0;
      response.on("data", chunk => {
        length += chunk.length;
        if (length > MAX_RESPONSE_BODY_BYTES) {
          request.destroy(new Error("Outbound HTTP response exceeds the 1 MiB limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", error => settle(reject, error));
      response.on("end", () => {
        if (settled) return;
        const text = Buffer.concat(chunks).toString("utf8");
        let responseBody = text;
        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        if (text && (contentType.includes("json") || /^[\[{]/.test(text.trim()))) {
          try { responseBody = JSON.parse(text); } catch { /* keep non-JSON response as text */ }
        }
        const responseHeaders = {};
        const allowedResponseHeaders = new Set(["content-type", "content-length", "cache-control", "date", "etag", "last-modified", "retry-after"]);
        for (const [name, value] of Object.entries(response.headers || {})) {
          if (allowedResponseHeaders.has(name.toLowerCase()) && typeof value === "string") responseHeaders[name.toLowerCase()] = value.slice(0, 2048);
        }
        const status = response.statusCode || 0;
        settle(resolve, { status, ok: status >= 200 && status < 300, headers: responseHeaders, body: responseBody, redirected: status >= 300 && status < 400 });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Outbound HTTP request timed out.")));
    request.on("error", error => settle(reject, error));
    if (payload) request.write(payload);
    request.end();
  });
}

export { validateHeaders, prepareRequestHeaders };
