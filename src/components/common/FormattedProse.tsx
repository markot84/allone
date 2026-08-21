import { Fragment, type ReactNode } from 'react';

function isHorizontalRule(line: string): boolean {
  return /^[—\-=_]{3,}\s*$/.test(line.trim());
}

export type FormattedProseVariant = 'default' | 'compact' | 'article';

interface FormattedProseProps {
  content: string;
  variant?: FormattedProseVariant;
  className?: string;
}

/** Plain text without `**` (e.g. for clipboard) */
export function toPlainProseText(raw: string): string {
  return raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

type InlineSeg = { bold?: boolean; text: string };

export function parseInlineSegments(line: string): InlineSeg[] {
  if (!line) return [{ text: '' }];
  const out: InlineSeg[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    out.push({ bold: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out.length ? out : [{ text: line }];
}

function Inline({ segments, className }: { segments: InlineSeg[]; className?: string }) {
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold text-[var(--text-primary)]">
            {s.text}
          </strong>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        )
      )}
    </span>
  );
}

type LineKind =
  | { type: 'blank' }
  | { type: 'section'; title: InlineSeg[] }
  | { type: 'field'; label: InlineSeg[]; value: InlineSeg[] }
  | { type: 'bullet'; segments: InlineSeg[] }
  | { type: 'paragraph'; segments: InlineSeg[] };

function classifyLine(trimmed: string): LineKind {
  if (!trimmed) return { type: 'blank' };
  if (isHorizontalRule(trimmed)) return { type: 'blank' };

  const bulletHyphen = trimmed.match(/^[-•*]\s+(.+)$/);
  if (bulletHyphen) {
    return { type: 'bullet', segments: parseInlineSegments(bulletHyphen[1]) };
  }

  const fieldHyphen = trimmed.match(/^[-•*]\s*\*\*(.+?)\*\*:\s*(.*)$/);
  if (fieldHyphen) {
    return {
      type: 'field',
      label: parseInlineSegments(fieldHyphen[1]),
      value: parseInlineSegments(fieldHyphen[2]),
    };
  }

  const field = trimmed.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
  if (field) {
    const labelSegs = parseInlineSegments(field[1]);
    const valueSegs = parseInlineSegments(field[2]);
    const valueEmpty = field[2].trim() === '';
    if (valueEmpty) {
      return { type: 'section', title: parseInlineSegments(`**${field[1]}**`) };
    }
    return { type: 'field', label: labelSegs, value: valueSegs };
  }

  const onlyBold = trimmed.match(/^\*\*(.+?)\*\*$/);
  if (onlyBold) {
    return { type: 'section', title: parseInlineSegments(trimmed) };
  }

  return { type: 'paragraph', segments: parseInlineSegments(trimmed) };
}

const spacing: Record<FormattedProseVariant, { block: string; section: string }> = {
  default: { block: 'space-y-3', section: 'mt-6 first:mt-0' },
  compact: { block: 'space-y-2', section: 'mt-4 first:mt-0' },
  article: { block: 'space-y-4', section: 'mt-8 first:mt-0' },
};

/** Renders AI/help text without visible `**`: labels, sections, bullets, emphasis. */
export function FormattedProse({ content, variant = 'default', className = '' }: FormattedProseProps) {
  const lines = content.split('\n');
  const sp = spacing[variant];

  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const kind = classifyLine(trimmed);

    if (kind.type === 'blank') {
      blocks.push(<div key={`b-${i}`} className="h-2" />);
      i += 1;
      continue;
    }

    if (kind.type === 'section') {
      if (variant === 'article') {
        blocks.push(
          <h3
            key={`b-${i}`}
            className="font-semibold text-lg mt-8 mb-3 text-[var(--text-primary)] first:mt-0 leading-snug"
          >
            <Inline segments={kind.title} />
          </h3>
        );
      } else {
        blocks.push(
          <div
            key={`b-${i}`}
            className={`rounded-xl border border-[var(--border)] bg-gradient-to-r from-[var(--surface-2)] to-white px-4 py-3 ${sp.section}`}
          >
            <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug border-l-[3px] border-[var(--nts-accent)] pl-3">
              <Inline segments={kind.title} />
            </h3>
          </div>
        );
      }
      i += 1;
      continue;
    }

    if (kind.type === 'field') {
      blocks.push(
        <div
          key={`b-${i}`}
          className="rounded-lg bg-white border border-[var(--border)] px-3 py-2.5 shadow-sm"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--nts-accent-text)] shrink-0 min-w-[7rem]">
              <Inline segments={kind.label} />:
            </span>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1 m-0">
              <Inline segments={kind.value} />
            </p>
          </div>
        </div>
      );
      i += 1;
      continue;
    }

    if (kind.type === 'bullet') {
      blocks.push(
        <div key={`b-${i}`} className="flex gap-3 pl-1">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nts-accent)]" />
          <p
            className={`leading-relaxed ${
              variant === 'article' ? 'text-[var(--text-secondary)]' : 'text-sm text-[var(--text-secondary)]'
            }`}
          >
            <Inline segments={kind.segments} />
          </p>
        </div>
      );
      i += 1;
      continue;
    }

    blocks.push(
      <p
        key={`b-${i}`}
        className={`leading-relaxed ${
          variant === 'article' ? 'text-[var(--text-secondary)] mb-0' : 'text-sm text-[var(--text-primary)]'
        }`}
      >
        <Inline segments={kind.segments} />
      </p>
    );
    i += 1;
  }

  return <div className={`${sp.block} ${className}`}>{blocks}</div>;
}
