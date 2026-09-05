const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const dns = require('node:dns/promises');
const ipaddr = require('ipaddr.js');
const sharp = require('sharp');
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const db = require('../services/db');
const context = require('./context');
const { DATA_ROOT } = require('../config/env');
const MAX_BYTES = 8 * 1024 * 1024;
function invalid() {
  throw Object.assign(new Error('Invalid or inaccessible image'), {
    statusCode: 400,
    expose: true
  });
}
function directory() {
  return path.join(
    DATA_ROOT,
    'workspaces',
    context.current().workspaceId,
    'media'
  );
}
function publicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
async function remoteImage(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    invalid();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const answers = ipaddr.isValid(hostname)
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4
        }
      ]
    : await dns.lookup(hostname, { all: true });
  if (!answers.length || answers.some((a) => !publicAddress(a.address)))
    invalid();
  // Pin the validated DNS answers to the connection; do not resolve again after validation.
  const lookup = (_host, options, callback) =>
    options?.all
      ? callback(null, answers)
      : callback(null, answers[0].address, answers[0].family);
  const agent = new https.Agent({ lookup });
  try {
    const response = await axios.get(url.toString(), {
      httpsAgent: agent,
      proxy: false,
      responseType: 'arraybuffer',
      timeout: 10000,
      maxRedirects: 0,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES
    });
    return Buffer.from(response.data);
  } finally {
    agent.destroy();
  }
}
async function checked(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES)
    invalid();
  try {
    const meta = await sharp(buffer, {
      limitInputPixels: 25_000_000
    }).metadata();
    if (
      !['jpeg', 'png', 'webp', 'gif'].includes(meta.format) ||
      !meta.width ||
      !meta.height
    )
      invalid();
    return await sharp(buffer, {
      limitInputPixels: 25_000_000,
      animated: false
    })
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    invalid();
  }
}
async function resolve(ref) {
  if (typeof ref !== 'string' || !/^\/uploads\/[a-f\d-]+\.jpg$/.test(ref))
    invalid();
  const filename = ref.slice('/uploads/'.length);
  const { rows } = await db.query(
    'SELECT filename FROM media_assets WHERE workspace_id=$1 AND filename=$2',
    [context.current().workspaceId, filename]
  );
  if (!rows.length) invalid();
  return path.join(directory(), rows[0].filename);
}
async function load(ref) {
  let buffer;
  if (Buffer.isBuffer(ref)) buffer = ref;
  else if (typeof ref === 'string' && ref.startsWith('/uploads/'))
    buffer = await fs.readFile(await resolve(ref));
  else if (typeof ref === 'string' && /^https:\/\//.test(ref))
    buffer = await remoteImage(ref);
  else if (
    typeof ref === 'string' &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z\d+/=]+$/.test(ref) &&
    ref.length < MAX_BYTES * 1.4
  )
    buffer = Buffer.from(ref.split(',')[1], 'base64');
  else invalid();
  return checked(buffer);
}
async function store(buffer) {
  const normalized = await checked(buffer),
    id = randomUUID(),
    filename = id + '.jpg';
  return db.transaction(async () => {
    const usage = await db.query(
      'SELECT coalesce(sum(size),0)::bigint AS bytes FROM media_assets WHERE workspace_id=$1',
      [context.current().workspaceId]
    );
    const cap = Number(process.env.MAX_WORKSPACE_MEDIA_BYTES || 268435456);
    if (Number(usage.rows[0].bytes) + normalized.length > cap)
      throw Object.assign(
        new Error('Workspace media limit reached. Remove unused images.'),
        { statusCode: 413, expose: true }
      );
    await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
    const localPath = path.join(directory(), filename);
    await fs.writeFile(localPath, normalized, { mode: 0o600, flag: 'wx' });
    try {
      await db.query(
        'INSERT INTO media_assets(workspace_id,id,filename,content_type,size) VALUES($1,$2,$3,$4,$5)',
        [
          context.current().workspaceId,
          id,
          filename,
          'image/jpeg',
          normalized.length
        ]
      );
    } catch (error) {
      await fs.unlink(localPath);
      throw error;
    }
    return {
      id,
      fileName: filename,
      filename,
      url: '/uploads/' + filename,
      localPath,
      path: localPath,
      size: normalized.length
    };
  }, context.current().workspaceId);
}

async function remove(filename) {
  const local = await resolve('/uploads/' + filename);
  await fs.unlink(local);
  await db.query(
    'DELETE FROM media_assets WHERE workspace_id=$1 AND filename=$2',
    [context.current().workspaceId, filename]
  );
}
module.exports = {
  MAX_BYTES,
  publicAddress,
  remoteImage,
  checked,
  resolve,
  load,
  store,
  remove
};
