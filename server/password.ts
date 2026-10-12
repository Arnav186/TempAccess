import crypto from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/** PHC-formatted Argon2id hashes; all work happens on the server. */
export function hashPassword(password: string) { return argon2id({ password, salt: crypto.randomBytes(16), parallelism: 1, iterations: 3, memorySize: 19_456, hashLength: 32, outputType: 'encoded' }); }
export function verifyPassword(hash: string, password: string) { return argon2Verify({ hash, password }); }
