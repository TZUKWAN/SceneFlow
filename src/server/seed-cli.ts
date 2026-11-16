/** e2e/CI 用：执行种子后退出。 */
import { seedForTests } from './seed.js';
import { closeDb } from './db.js';
await seedForTests();
await closeDb();
console.log('seed done');
