import { GeminiProvider } from './server/providers/gemini.js';
import dotenv from 'dotenv';
dotenv.config();

const provider = new GeminiProvider(process.env.GEMINI_API_KEY!);
provider.complete({
  model: 'gemini-3.8-flash',
  messages: [{ role: 'user', content: 'who are you' }],
  maxOutputTokens: 1024,
  system: 'You are a helpful assistant.'
}).then(console.log).catch(console.error);
