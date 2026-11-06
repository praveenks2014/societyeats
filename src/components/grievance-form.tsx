'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

export function GrievanceForm({ signedIn }: { signedIn: boolean }) {
  const toast = useToast();
  const [kind, setKind] = useState('grievance');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<number | null>(null);

  if (!signedIn) {
    return (
      <p className="mt-6 text-sm" data-testid="grievance-login">
        <Link href="/login?next=/legal/grievance" className="font-semibold text-leaf underline">Sign in</Link> to raise a complaint or a data request.
      </p>
    );
  }
  if (doneId) {
    return (
      <p className="mt-6 rounded-xl bg-leaf-tint px-4 py-3 text-sm text-leaf" role="status" data-testid="grievance-done">
        Thanks. Your reference is <strong>#{doneId}</strong>. We have sent you a confirmation and will acknowledge it within the time stated above.
      </p>
    );
  }
  async function submit() {
    setBusy(true);
    const res = await fetch('/api/grievances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, subject, body }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not send', 'err');
    setDoneId(d.id);
  }
  return (
    <div className="not-prose mt-6 space-y-3 rounded-card border border-rice-line bg-white p-4" data-testid="grievance-form">
      <h2 className="!mt-0 text-base font-bold">Raise a complaint</h2>
      <Field label="What is this about?">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="grievance-kind">
          <option value="grievance">A complaint</option>
          <option value="data_request">My data (access, correction or erasure)</option>
        </Select>
      </Field>
      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="grievance-subject" />
      </Field>
      <Field label="Details">
        <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} data-testid="grievance-body" />
      </Field>
      <Button loading={busy} onClick={submit} disabled={subject.trim().length < 3 || body.trim().length < 10} data-testid="grievance-submit">Send</Button>
    </div>
  );
}
