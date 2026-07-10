import { Suspense, lazy, useState } from 'react';

// Lazy-load Monaco so a slow/blocked CDN-free bundle doesn't stall first paint.
// If Monaco fails to load for any reason, we fall back to a styled textarea.
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react')
    .then((m) => ({ default: m.default }))
    .catch(() => ({ default: TextareaEditor as any }))
);

export default function CodeEditor({
  value,
  onChange,
  height = 380,
  readOnly = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  height?: number;
  readOnly?: boolean;
}) {
  const [monacoFailed, setMonacoFailed] = useState(false);

  if (monacoFailed) {
    return <TextareaEditor value={value} onChange={onChange} height={height} readOnly={readOnly} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-forge-border" style={{ height }}>
      <Suspense fallback={<EditorFallback height={height} />}>
        <MonacoEditor
          height={height}
          defaultLanguage="javascript"
          theme="vs-dark"
          value={value}
          onChange={(v: string | undefined) => onChange?.(v ?? '')}
          onValidate={() => {}}
          loading={<EditorFallback height={height} />}
          options={{
            readOnly,
            fontSize: 13,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
          }}
          onMount={(_editor: unknown, monaco: any) => {
            if (!monaco) setMonacoFailed(true);
          }}
        />
      </Suspense>
    </div>
  );
}

function TextareaEditor({
  value,
  onChange,
  height = 380,
  readOnly = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  height?: number;
  readOnly?: boolean;
}) {
  return (
    <textarea
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
      spellCheck={false}
      style={{ height }}
      className="mono w-full resize-none rounded-lg border border-forge-border bg-[#0d1119] p-3 text-[13px] leading-5 text-forge-text outline-none focus:border-forge-accent"
    />
  );
}

function EditorFallback({ height }: { height: number }) {
  return (
    <div
      className="mono flex items-center justify-center bg-[#0d1119] text-sm text-forge-muted"
      style={{ height }}
    >
      Loading editor…
    </div>
  );
}
