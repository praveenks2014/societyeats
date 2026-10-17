/** npm run cron — runs the scheduled jobs once against DATABASE_URL (useful for a Replit Scheduled Deployment). */
import { loadDotEnv } from '../src/lib/dotenv';

async function main() {
  loadDotEnv();
  const { runScheduledJobs } = await import('../src/lib/jobs');
  console.log(JSON.stringify(await runScheduledJobs()));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
