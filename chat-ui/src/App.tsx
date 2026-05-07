import { useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sidebar, type ConnectionStatus } from "@/components/sidebar";
import { Markdown } from "@/components/markdown";
import { ToolCall, type ToolPart } from "@/components/tool-call";
import { useTools } from "@/lib/useTools";

const AGENT_NAME = "ChatAgent";

function App() {
  const agent = useAgent({ agent: AGENT_NAME, name: "playground" });
  const { messages, sendMessage, status, stop, clearHistory } = useAgentChat({
    agent,
  });
  const { tools, loading: toolsLoading, error: toolsError } = useTools();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  const wsState = (agent as unknown as { readyState?: number }).readyState;
  const sidebarStatus: ConnectionStatus = busy
    ? "streaming"
    : wsState === 0
      ? "connecting"
      : wsState === 1 || wsState === undefined
        ? "open"
        : "closed";

  function submit() {
    const text = inputRef.current?.value.trim();
    if (!text || busy) return;
    sendMessage({ text });
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickTool(name: string) {
    const el = inputRef.current;
    if (!el) return;
    const cur = el.value;
    el.value = cur ? `${cur} ${name}` : `${name} `;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    setSidebarOpen(false);
  }

  return (
    <div className="h-svh w-full flex bg-background text-foreground overflow-hidden">
      <div className="hidden md:flex w-[280px] shrink-0">
        <Sidebar
          agentName={AGENT_NAME}
          status={sidebarStatus}
          tools={tools}
          loading={toolsLoading}
          error={toolsError}
          onPickTool={pickTool}
        />
      </div>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="relative w-[280px] h-full">
            <Sidebar
              agentName={AGENT_NAME}
              status={sidebarStatus}
              tools={tools}
              loading={toolsLoading}
              error={toolsError}
              onPickTool={pickTool}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center justify-between px-5 md:px-8 border-b border-border">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="md:hidden text-lg leading-none px-2 py-1 -ml-2 rounded hover:bg-muted"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open panel"
            >
              ≡
            </button>
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              session · playground
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearHistory}
            disabled={busy || messages.length === 0}
            className="text-[10px] uppercase tracking-[0.22em]"
          >
            clear
          </Button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 md:px-8 py-10 md:py-14 space-y-10">
            {messages.length === 0 && (
              <div className="text-muted-foreground">
                <div className="text-[10px] uppercase tracking-[0.22em] mb-3 text-muted-foreground/80">
                  ready
                </div>
                <p className="text-[14.5px] leading-relaxed text-foreground/80">
                  Start a turn. The agent has access to{" "}
                  <span className="text-foreground tabular-nums">
                    {tools?.length ?? 0}
                  </span>{" "}
                  tool{tools?.length === 1 ? "" : "s"}
                  {tools && tools.length > 0 ? " — see panel" : ""}.
                </p>
              </div>
            )}

            {messages.map((m) => {
              const isUser = m.role === "user";
              const renderable = m.parts.filter(
                (p) =>
                  (p.type === "text" && (p as { text: string }).text) ||
                  p.type.startsWith("tool-"),
              );
              if (renderable.length === 0) return null;
              return (
                <div key={m.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className={`text-[10px] uppercase tracking-[0.22em] tabular-nums ${
                        isUser ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {isUser ? "user" : "agent"}
                    </span>
                    <div
                      className={`flex-1 h-px ${
                        isUser ? "bg-primary/25" : "bg-border"
                      }`}
                    />
                  </div>
                  <div
                    className={`text-[14.5px] ${
                      isUser ? "text-foreground" : "text-foreground/90"
                    }`}
                  >
                    {renderable.map((p, i) => {
                      if (p.type === "text") {
                        const text = (p as { text: string }).text;
                        return isUser ? (
                          <div
                            key={i}
                            className="leading-[1.7] whitespace-pre-wrap"
                          >
                            {text}
                          </div>
                        ) : (
                          <Markdown key={i}>{text}</Markdown>
                        );
                      }
                      if (p.type.startsWith("tool-")) {
                        return <ToolCall key={i} part={p as ToolPart} />;
                      }
                      return null;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border bg-background">
          <div className="max-w-3xl mx-auto px-5 md:px-8 py-4">
            <div className="flex items-end gap-3">
              <Textarea
                ref={inputRef}
                rows={1}
                placeholder="message…"
                className="resize-none min-h-[44px] max-h-40 py-2.5 leading-relaxed border-0 bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-1 focus-visible:ring-primary/40"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {busy ? (
                <Button
                  onClick={stop}
                  variant="secondary"
                  className="h-11 px-4 uppercase text-[10px] tracking-[0.22em]"
                >
                  stop
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  className="h-11 w-11 p-0 text-base"
                  aria-label="Send"
                >
                  →
                </Button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <span>⏎ send · ⇧⏎ newline</span>
              {busy && <span className="text-primary">streaming…</span>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
