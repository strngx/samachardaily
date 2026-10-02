/**
 * Samachar Daily — Cloudflare Admin Credentials Generator
 * 
 * Generates PBKDF2-HMAC-SHA256 password hash and high-entropy session secret
 * for Cloudflare Workers Secrets using Web Crypto.
 *
 * Usage:
 *   node tools/generate-admin-hash.js "<password>"
 *
 * Example:
 *   node tools/generate-admin-hash.js "MySecureNewsroomPassword123!"
 */

const { webcrypto } = require('crypto');
const crypto = globalThis.crypto || webcrypto;

async function generateCredentials(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    console.error('Error: Please provide a password argument.');
    console.error('Usage: node tools/generate-admin-hash.js "<password>"');
    process.exit(1);
  }

  const iterations = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const passwordBuffer = new TextEncoder().encode(plainPassword);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    baseKey,
    256 // 32 bytes
  );

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const fullHashString = `pbkdf2:${iterations}:${saltHex}:${hashHex}`;

  // Generate 256-bit random session secret
  const sessionSecretBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionSecretHex = Array.from(sessionSecretBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  console.log('\n======================================================');
  console.log('SAMACHAR DAILY — CLOUDFLARE SECRETS GENERATOR');
  console.log('======================================================\n');
  console.log('1. Set ADMIN_PASSWORD_HASH in Cloudflare Worker Secrets:');
  console.log(`   npx wrangler secret put ADMIN_PASSWORD_HASH`);
  console.log(`   Value: ${fullHashString}\n`);
  console.log('2. Set ADMIN_SESSION_SECRET in Cloudflare Worker Secrets:');
  console.log(`   npx wrangler secret put ADMIN_SESSION_SECRET`);
  console.log(`   Value: ${sessionSecretHex}\n`);
  console.log('Security properties:');
  console.log(`- Algorithm: PBKDF2-HMAC-SHA256`);
  console.log(`- Iterations: ${iterations.toLocaleString()}`);
  console.log(`- Salt: 16-byte cryptographically secure random`);
  console.log(`- Session Secret: 256-bit high entropy random`);
  console.log('======================================================\n');
}

const readline = require('readline');

async function main() {
  const args = process.argv.slice(2);
  let password = args[0];

  if (!password) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    password = await new Promise((resolve) => {
      rl.question('Enter administrator password: ', (ans) => {
        rl.close();
        resolve(ans);
      });
    });
  }

  if (!password || typeof password !== 'string' || !password.trim()) {
    console.error('Error: Administrator password cannot be empty.');
    process.exit(1);
  }

  await generateCredentials(password.trim());
}

main();
