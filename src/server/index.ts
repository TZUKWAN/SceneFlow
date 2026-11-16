import { buildApp } from './app.js';

const port = Number(process.env.PORT || 8787);
const app = await buildApp();
await app.listen({ port, host: '127.0.0.1' });
console.log(`Poros Enterprise API: http://127.0.0.1:${port}`);
