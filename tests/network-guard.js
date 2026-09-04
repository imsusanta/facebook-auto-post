/**
 * Network Deny Guard for Test Environments
 * Wraps http, https, global.fetch, and net.Socket to strictly block all non-loopback network egress.
 * Permitted destinations: 127.0.0.1, localhost, ::1, 0.0.0.0.
 */

const http = require('http');
const https = require('https');
const net = require('net');

let originalHttpRequest = null;
let originalHttpGet = null;
let originalHttpsRequest = null;
let originalHttpsGet = null;
let originalFetch = null;
let originalNetConnect = null;
let originalSocketConnect = null;

let isInstalled = false;
let blockedAttempts = [];

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

function isLoopback(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const clean = hostname.replace(/^\[|\]$/g, '').toLowerCase().split(':')[0];
  return LOOPBACK_HOSTNAMES.has(clean);
}

function parseHostFromArgs(arg0, arg1) {
  let hostname = '';
  let port = '';

  if (typeof arg0 === 'string') {
    try {
      const u = new URL(arg0);
      hostname = u.hostname;
      port = u.port;
    } catch {
      hostname = arg0;
    }
  } else if (arg0 instanceof URL) {
    hostname = arg0.hostname;
    port = arg0.port;
  } else if (arg0 && typeof arg0 === 'object') {
    hostname = arg0.hostname || arg0.host || '';
    port = arg0.port || '';
  }

  if ((!hostname || !isLoopback(hostname)) && arg1 && typeof arg1 === 'object') {
    hostname = arg1.hostname || arg1.host || hostname;
    port = arg1.port || port;
  }

  return { hostname: (hostname || '').split(':')[0].toLowerCase(), port };
}

function installNetworkGuard() {
  if (isInstalled) return;

  blockedAttempts = [];
  originalHttpRequest = http.request;
  originalHttpGet = http.get;
  originalHttpsRequest = https.request;
  originalHttpsGet = https.get;
  originalFetch = global.fetch;
  originalNetConnect = net.connect;
  originalSocketConnect = net.Socket.prototype.connect;

  // Intercept http.request
  http.request = function (...args) {
    const { hostname } = parseHostFromArgs(args[0], args[1]);
    if (!isLoopback(hostname)) {
      const err = new Error(`[NetworkGuard] External HTTP egress BLOCKED to host: "${hostname}"`);
      err.code = 'NETWORK_EGRESS_BLOCKED';
      blockedAttempts.push({ protocol: 'http:', host: hostname, timestamp: Date.now() });
      throw err;
    }
    return originalHttpRequest.apply(this, args);
  };

  // Intercept http.get
  http.get = function (...args) {
    const { hostname } = parseHostFromArgs(args[0], args[1]);
    if (!isLoopback(hostname)) {
      const err = new Error(`[NetworkGuard] External HTTP egress BLOCKED to host: "${hostname}"`);
      err.code = 'NETWORK_EGRESS_BLOCKED';
      blockedAttempts.push({ protocol: 'http:', host: hostname, timestamp: Date.now() });
      throw err;
    }
    return originalHttpGet.apply(this, args);
  };

  // Intercept https.request
  https.request = function (...args) {
    const { hostname } = parseHostFromArgs(args[0], args[1]);
    if (!isLoopback(hostname)) {
      const err = new Error(`[NetworkGuard] External HTTPS egress BLOCKED to host: "${hostname}"`);
      err.code = 'NETWORK_EGRESS_BLOCKED';
      blockedAttempts.push({ protocol: 'https:', host: hostname, timestamp: Date.now() });
      throw err;
    }
    return originalHttpsRequest.apply(this, args);
  };

  // Intercept https.get
  https.get = function (...args) {
    const { hostname } = parseHostFromArgs(args[0], args[1]);
    if (!isLoopback(hostname)) {
      const err = new Error(`[NetworkGuard] External HTTPS egress BLOCKED to host: "${hostname}"`);
      err.code = 'NETWORK_EGRESS_BLOCKED';
      blockedAttempts.push({ protocol: 'https:', host: hostname, timestamp: Date.now() });
      throw err;
    }
    return originalHttpsGet.apply(this, args);
  };

  // Intercept global.fetch
  if (typeof global.fetch === 'function') {
    global.fetch = async function (...args) {
      const { hostname } = parseHostFromArgs(args[0], args[1]);
      if (!isLoopback(hostname)) {
        const err = new Error(`[NetworkGuard] External Fetch egress BLOCKED to host: "${hostname}"`);
        err.code = 'NETWORK_EGRESS_BLOCKED';
        blockedAttempts.push({ protocol: 'fetch:', host: hostname, timestamp: Date.now() });
        throw err;
      }
      return originalFetch.apply(this, args);
    };
  }

  // Intercept net.connect
  net.connect = function (...args) {
    let host = 'localhost';
    if (typeof args[0] === 'object' && args[0] !== null) {
      host = args[0].host || args[0].hostname || 'localhost';
    } else if (typeof args[1] === 'string') {
      host = args[1];
    }
    if (!isLoopback(host)) {
      const err = new Error(`[NetworkGuard] External TCP egress BLOCKED to host: "${host}"`);
      err.code = 'NETWORK_EGRESS_BLOCKED';
      blockedAttempts.push({ protocol: 'net:', host, timestamp: Date.now() });
      throw err;
    }
    return originalNetConnect.apply(this, args);
  };

  // Intercept net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) {
    let host = 'localhost';
    if (typeof args[0] === 'object' && args[0] !== null) {
      host = args[0].host || args[0].hostname || 'localhost';
    } else if (typeof args[1] === 'string') {
      host = args[1];
    }
    if (!isLoopback(host)) {
      const err = new Error(`[NetworkGuard] External TCP socket connect BLOCKED to host: "${host}"`);
      err.code = 'NETWORK_EGRESS_BLOCKED';
      blockedAttempts.push({ protocol: 'net.Socket:', host, timestamp: Date.now() });
      throw err;
    }
    return originalSocketConnect.apply(this, args);
  };

  isInstalled = true;
}

function uninstallNetworkGuard() {
  if (!isInstalled) return;

  http.request = originalHttpRequest;
  http.get = originalHttpGet;
  https.request = originalHttpsRequest;
  https.get = originalHttpsGet;
  if (originalFetch) {
    global.fetch = originalFetch;
  }
  if (originalNetConnect) {
    net.connect = originalNetConnect;
  }
  if (originalSocketConnect) {
    net.Socket.prototype.connect = originalSocketConnect;
  }

  isInstalled = false;
}

function getBlockedCount() {
  return blockedAttempts.length;
}

function getBlockedAttempts() {
  return [...blockedAttempts];
}

function clearBlockedAttempts() {
  blockedAttempts = [];
}

module.exports = {
  installNetworkGuard,
  uninstallNetworkGuard,
  getBlockedCount,
  getBlockedAttempts,
  clearBlockedAttempts,
  isLoopback
};
