'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: 24, textAlign: 'center' }}>
        <h2>Something went wrong</h2>
        <button onClick={reset} style={{ minHeight: 44, padding: '0 20px' }}>Try again</button>
      </body>
    </html>
  );
}
