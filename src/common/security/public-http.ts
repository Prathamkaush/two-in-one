import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function publicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Only public HTTPS URLs on port 443 are allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || !hostname.includes('.') || (isIP(hostname) && !publicAddress(hostname))) throw new Error('Nonpublic URL');
  return url;
}
export async function getPublicPage(value: string, timeoutMs = 15000) {
  const url = publicUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let dnsTimer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([lookup(hostname, { all: true }), new Promise<never>((_resolve, reject) => {
    dnsTimer = setTimeout(() => reject(new Error('Public DNS timeout')), timeoutMs);
  })]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error('Nonpublic DNS destination');
  const pinned = addresses[0];
  const start = Date.now();
  return new Promise<{ status: number; content: string; responseTimeMs: number }>((resolve, reject) => {
    const req = request(url, { method: 'GET', agent: false, family: pinned.family, headers: { 'User-Agent': 'DualAutomation/0.1 (public business research)', Accept: 'text/html,application/rss+xml,application/atom+xml' },
      // Pin the already-validated address; do not resolve again or follow redirects.
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512000) { req.destroy(new Error('Response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', () => reject(new Error('Public HTTP response failed')));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, content: Buffer.concat(chunks).toString('utf8'), responseTimeMs: Date.now() - start }); });
    });
    const timer = setTimeout(() => req.destroy(new Error('Public HTTP timeout')), timeoutMs);
    req.on('error', () => { clearTimeout(timer); reject(new Error('Public HTTP request failed')); });
    req.end();
  });
}
