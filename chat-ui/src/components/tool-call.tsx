import { useState } from "react";

export type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
};

export function ToolCall({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  const state = part.state ?? "";
  const isError = state === "output-error";
  const isDone = state === "output-available";
  const isRunning =
    state === "input-streaming" || state === "input-available";

  const stateLabel = isError
    ? "error"
    : isDone
      ? "done"
      : isRunning
        ? "running"
        : state || "idle";

  const stateClass = isError
    ? "text-destructive"
    : isDone
      ? "text-muted-foreground"
      : "text-primary";

  const hasDetail =
    part.input !== undefined ||
    part.output !== undefined ||
    part.errorText !== undefined;

  const [open, setOpen] = useState(isError);

  return (
    <div className="my-3 border-l-2 border-primary/30 pl-3 not-first:mt-3">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        className="flex items-center gap-2 text-[12.5px] tabular-nums disabled:cursor-default"
        aria-expanded={open}
      >
        <span className="text-primary/70 leading-none">▸</span>
        <span className="font-medium tracking-tight">{name}</span>
        <span
          className={`uppercase tracking-[0.18em] text-[10px] ${stateClass}`}
        >
          {isRunning ? (
            <>
              running<span className="inline-block animate-pulse">…</span>
            </>
          ) : (
            stateLabel
          )}
        </span>
        {hasDetail && (
          <span className="text-muted-foreground/60 text-[10px] ml-1 select-none">
            {open ? "−" : "+"}
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="mt-2 space-y-2 text-[11.5px]">
          {part.input !== undefined && (
            <Block label="input" value={part.input} />
          )}
          {part.output !== undefined && (
            <Block label="output" value={part.output} />
          )}
          {part.errorText && (
            <Block label="error" value={part.errorText} />
          )}
        </div>
      )}
    </div>
  );
}

function Block({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === "string" ? value : safeStringify(value);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1">
        {label}
      </div>
      <pre className="p-2 rounded-sm bg-muted/60 border border-border overflow-x-auto leading-[1.55] whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
