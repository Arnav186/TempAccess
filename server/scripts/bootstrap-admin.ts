import { prisma } from '../db.js'; import { hashPassword } from '../password.js';
const email = process.env.ADMIN_EMAIL?.toLowerCase(), password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 16) throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 16 characters in .env.');
const passwordHash = await hashPassword(password);
await prisma.administrator.upsert({ where: { email }, create: { email, passwordHash }, update: { passwordHash } });
console.log(`Administrator ready: ${email}`); await prisma.$disconnect();
