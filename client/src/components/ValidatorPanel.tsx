import type { ValidationResult } from '../lib/validator';
import { classNames } from '../lib/ui';

const LEVEL_META = {
  pass: { label: 'PASS', color: 'text-forge-ok', border: 'border-forge-ok/40', bg: 'bg-forge-ok/10', icon: '✓' },
  warn: { label: 'WARN', color: 'text-forge-warn', border: 'border-forge-warn/40', bg: 'bg-forge-warn/10', icon: '!' },
  fail: { label: 'FAIL', color: 'text-forge-fail', border: 'border-forge-fail/40', bg: 'bg-forge-fail/10', icon: '✕' },
} as const;

export default function ValidatorPanel({ result }: { result: ValidationResult }) {
  const meta = LEVEL_META[result.level];
  const fails = result.issues.filter((i) => i.severity === 'fail');
  const warns = result.issues.filter((i) => i.severity === 'warn');

  return (
    <div className={classNames('rounded-xl border', meta.border, meta.bg)}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={classNames(
            'flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold',
            meta.color,
            'bg-black/30'
          )}
        >
          {meta.icon}
        </span>
        <div>
          <span className={classNames('text-sm font-bold', meta.color)}>Validator: {meta.label}</span>
          <span className="ml-2 text-xs text-forge-muted">
            {fails.length} blocking · {warns.length} warning{warns.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {result.issues.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-forge-muted">
          No issues found. Uses only sandbox globals; deploy is enabled.
        </p>
      ) : (
        <ul className="space-y-1.5 px-4 pb-4">
          {[...fails, ...warns].map((issue, i) => {
            const im = LEVEL_META[issue.severity];
            return (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={classNames('mono mt-0.5 shrink-0 text-xs font-bold', im.color)}>
                  {issue.severity === 'fail' ? 'FAIL' : 'WARN'}
                  {issue.line ? ` L${issue.line}` : ''}
                </span>
                <span className="text-forge-text">{issue.message}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-white/5 px-4 py-2">
        <p className="text-[11px] text-forge-muted">
          SAYFORGE catches the exact undefined-global bug (<span className="mono">caller</span> /{' '}
          <span className="mono">state</span>) that shipped in SAYMAN's own reference contracts.
        </p>
      </div>
    </div>
  );
}
