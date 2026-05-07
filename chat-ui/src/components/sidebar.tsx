import { type Tool } from "@/lib/useTools";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "streaming"
  | "closed";

type Props = {
  agentName: string;
  status: ConnectionStatus;
  tools: Tool[] | null;
  loading: boolean;
  error: string | null;
  onPickTool?: (toolName: string) => void;
  onClose?: () => void;
};

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "linking",
  open: "online",
  streaming: "streaming",
  closed: "offline",
};

export function Sidebar({
  agentName,
  status,
  tools,
  loading,
  error,
  onPickTool,
  onClose,
}: Props) {
  const dotClass =
    status === "streaming"
      ? "bg-primary animate-pulse"
      : status === "open"
        ? "bg-primary"
        : status === "connecting"
          ? "bg-muted-foreground/60"
          : "bg-destructive";

  return (
    <aside className="flex h-full w-full flex-col bg-card border-r border-border">
      <div className="h-14 flex items-center justify-between gap-3 px-5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`size-2 rounded-full shrink-0 ${dotClass}`}
            aria-hidden
          />
          <span className="text-sm font-medium tracking-tight truncate">
            {agentName}
          </span>
          <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground shrink-0">
            · {STATUS_LABEL[status]}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden text-muted-foreground hover:text-foreground text-xl leading-none px-2 py-1 -mr-2"
            aria-label="Close panel"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-2 flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            tools
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {tools?.length ?? "—"}
          </span>
        </div>

        {loading && (
          <div className="px-5 pb-5 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 animate-pulse">
                <div className="h-3 w-3/4 bg-muted rounded-sm" />
                <div className="h-2 w-full bg-muted/60 rounded-sm" />
                <div className="h-2 w-2/3 bg-muted/60 rounded-sm" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="px-5 pb-5 text-xs text-destructive break-all">
            {error}
          </div>
        )}

        {!loading && !error && tools?.length === 0 && (
          <div className="px-5 pb-5 text-xs text-muted-foreground">
            No tools registered.
          </div>
        )}

        {tools && tools.length > 0 && (
          <ul className="px-2 pb-6">
            {tools.map((t, i) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => onPickTool?.(t.name)}
                  className="w-full text-left px-3 py-3 rounded-md hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] tabular-nums text-muted-foreground/70">
                      [{String(i + 1).padStart(2, "0")}]
                    </span>
                    <span className="text-[13px] font-medium tracking-tight text-foreground break-all">
                      {t.name}
                    </span>
                  </div>
                  <p className="mt-1.5 ml-7 text-[11.5px] leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                  {t.permissions.length > 0 && (
                    <div className="mt-2 ml-7 flex flex-wrap gap-1">
                      {t.permissions.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-muted text-[10px] tabular-nums text-muted-foreground"
                        >
                          <span className="text-primary/70 leading-none">
                            ●
                          </span>
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border">
        <span className="text-[10px] tabular-nums text-muted-foreground/80">
          /agents/chat-agent/playground
        </span>
      </div>
    </aside>
  );
}
