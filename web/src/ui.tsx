import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * The mark: one block seen from the editor's own angle, lit from above. The top face is the
 * only accent on the page.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 21.5 7.5 12 13 2.5 7.5z" fill="var(--accent)" />
      <path d="M2.5 9.6 11 14.5v8L2.5 17.6z" fill="var(--ink)" />
      <path d="M21.5 9.6 13 14.5v8l8.5-4.9z" fill="var(--ink)" fillOpacity="0.55" />
    </svg>
  );
}

/** Mark and name. With `href` it is the way home. */
export function Brand({ href, compact = false }: { href?: string; compact?: boolean }) {
  const content = (
    <>
      <Mark />
      {!compact && <span className="wordmark">isodia</span>}
    </>
  );
  return href ? (
    <a className="brand" href={href} title="All projects" aria-label="isodia, all projects">
      {content}
    </a>
  ) : (
    <span className="brand">{content}</span>
  );
}

const DAY_MS = 86_400_000;

/** "5 min ago" for the last week, a date after that. */
export function ago(iso: string, now = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / 3_600_000)} h ago`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A relative time that gives the exact one on hover. */
export function When({ iso }: { iso: string }) {
  return <time dateTime={iso} title={new Date(iso).toLocaleString()}>{ago(iso)}</time>;
}

/** Text to copy, shown as it will be pasted. */
export function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="snippet">
      {text}
      <button
        type="button"
        className="btn small"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </pre>
  );
}

/** A button that opens a short list of actions; picking one, pressing Escape or clicking away closes it. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        type="button"
        className="btn quiet icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((was) => !was)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

interface Question {
  title: string;
  body?: string;
  /** Present when the dialog asks for text: the field's label and starting value. */
  input?: { label: string; value: string; secret: boolean };
  confirm: string;
  danger: boolean;
  settle(answer: string | null): void;
}

let present: (question: Question) => void = () => undefined;

/** Ask for a line of text. Resolves to the trimmed answer, or `null` when dismissed or left empty. */
export function askText(options: {
  title: string;
  body?: string;
  label: string;
  value?: string;
  /** Mask what is typed. */
  secret?: boolean;
  confirm: string;
}): Promise<string | null> {
  return new Promise((settle) =>
    present({
      title: options.title,
      body: options.body,
      input: { label: options.label, value: options.value ?? '', secret: options.secret ?? false },
      confirm: options.confirm,
      danger: false,
      settle
    })
  );
}

/** Ask before doing something. Resolves to whether the user went ahead. */
export function askConfirm(options: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    present({
      title: options.title,
      body: options.body,
      confirm: options.confirm,
      danger: options.danger ?? false,
      settle: (answer) => resolve(answer !== null)
    })
  );
}

/** Where `askText` and `askConfirm` appear. Mounted once, at the root. */
export function DialogHost() {
  const [question, setQuestion] = useState<Question | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    present = setQuestion;
    return () => {
      present = () => undefined;
    };
  }, []);

  useEffect(() => {
    if (!question) return;
    dialog.current?.showModal();
    field.current?.select();
  }, [question]);

  if (!question) return null;
  const settle = (answer: string | null) => {
    question.settle(answer);
    setQuestion(null);
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      // Escape and a click on the backdrop both dismiss.
      onCancel={() => settle(null)}
      onClick={(event) => {
        if (event.target === dialog.current) settle(null);
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          settle(question.input ? field.current?.value.trim() || null : '');
        }}
      >
        <h2>{question.title}</h2>
        {question.body && <p>{question.body}</p>}
        {question.input && (
          <input
            ref={field}
            className="field"
            type={question.input.secret ? 'password' : 'text'}
            aria-label={question.input.label}
            placeholder={question.input.label}
            defaultValue={question.input.value}
            maxLength={120}
          />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => settle(null)}>
            Cancel
          </button>
          <button type="submit" className={question.danger ? 'btn danger' : 'btn primary'}>
            {question.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
