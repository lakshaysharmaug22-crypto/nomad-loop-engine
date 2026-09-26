'use client';
import { StartRunInput } from '@nomad/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { HttpError, source } from '@/lib/data';
import f from './newrun.module.css';

/** Start a run against a live API. Validated with the same schema the API uses. */
export function NewRun({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({ targetUrl: 'http://localhost:4100', maxSteps: '45', verifyRuns: '3' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = StartRunInput.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const run = await source.startRun!(parsed.data);
      router.push(`/runs/${encodeURIComponent(run.id)}`);
    } catch (err) {
      const e2 = err as HttpError;
      setErrors(e2.details ? Object.fromEntries(e2.details.map((d) => [d.field, d.message])) : { form: e2.message });
      setBusy(false);
    }
  };

  const field = (name: keyof typeof values, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className={f.field} htmlFor={`nr-${name}`}>
      <span>{label}</span>
      <input
        id={`nr-${name}`}
        value={values[name]}
        onChange={(e) => setValues({ ...values, [name]: e.target.value })}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `nr-${name}-err` : undefined}
        {...props}
      />
      {errors[name] && (
        <em id={`nr-${name}-err`} className={f.err}>
          {errors[name]}
        </em>
      )}
    </label>
  );

  return (
    <form className={f.form} onSubmit={submit} noValidate>
      <div className={f.head}>
        <h2>New exploration</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className={f.row}>
        {field('targetUrl', 'Start URL', { type: 'url', autoFocus: true, placeholder: 'https://staging.example.com' })}
        {field('maxSteps', 'Steps', { type: 'number', min: 1, max: 500, inputMode: 'numeric' })}
        {field('verifyRuns', 'Replays per bug', { type: 'number', min: 1, max: 5, inputMode: 'numeric' })}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Starting…' : 'Start run'}
        </button>
      </div>
      {errors.form && <p className={f.err}>{errors.form}</p>}
    </form>
  );
}
