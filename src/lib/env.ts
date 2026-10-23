import { z } from 'zod';

/**
 * Startup environment validation. Called once from instrumentation.ts's
 * register() hook when the Next.js server boots (`next dev` and
 * `next start` both trigger it — `next build` does not, so this never
 * blocks a build), so a misconfigured deployment fails loudly at boot with
 * every missing/invalid var listed together, instead of surfacing one at a
 * time the first time each code path happens to run.
 *
 * DATABASE_URL is required when NODE_ENV=production (the embedded PGlite
 * fallback is for local development only — see src/lib/db/index.ts).
 */

const envSchema = z
  .object({
    JWT_SECRET: z
      .string({
        required_error:
          'JWT_SECRET is required — the app refuses to start without it (no dev fallback). Generate one with `openssl rand -hex 32` and set it as an env var (a Replit Secret in production).',
      })
      .min(
        20,
        'JWT_SECRET must be at least 20 characters — generate one with `openssl rand -hex 32`',
      ),
    MOCK_MODE: z
      .enum(['true', 'false'], {
        errorMap: () => ({ message: "MOCK_MODE must be exactly 'true' or 'false' when set" }),
      })
      .optional(),
    DATABASE_URL: z.string().optional(),
    ADMIN_EMAILS: z.string().optional(),
    STORAGE_ADAPTER: z.enum(['local', 'replit', 's3']).optional(),
    EMAIL_ADAPTER: z.enum(['mock', 'resend']).optional(),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production (add the PostgreSQL tool on Replit)',
      });
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_ADAPTER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_ADAPTER'],
        message: 'STORAGE_ADAPTER=local loses uploads on Autoscale — use replit or s3 in production',
      });
    }
    const liveMode = env.MOCK_MODE === 'false';
    if (!liveMode) return;
    const required = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const;
    if ((env.EMAIL_ADAPTER ?? 'resend') === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required when MOCK_MODE=false (or set EMAIL_ADAPTER=mock)' });
    }
    for (const key of required) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when MOCK_MODE=false (live payments are on)`,
        });
      }
    }
  });

/** Throws with a formatted, multi-line list of every problem found. */
export function validateEnv(): void {
  const result = envSchema.safeParse(process.env);
  if (result.success) return;

  const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  const report = `Invalid or missing environment variables:\n${lines.join('\n')}\n\nSee .env.example for the full list and SECURITY.md for rotation steps.`;
   
  console.error(`\n[env] ${report}\n`);
  throw new Error(`Environment validation failed:\n${lines.join('\n')}`);
}
