import { useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function App() {
  const agent = useAgent({ agent: "ChatAgent", name: "playground" });
  const { messages, sendMessage, status, stop, clearHistory } = useAgentChat({
    agent,
  });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = inputRef.current?.value.trim();
    if (!text || busy) return;
    sendMessage({ text });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex h-svh flex-col mx-auto max-w-3xl">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="font-heading text-base font-semibold">ChatAgent</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearHistory}
          disabled={busy || messages.length === 0}
        >
          Clear
        </Button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-6 space-y-6"
      >
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Say something to get started.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap"
                  : "max-w-[80%] rounded-2xl bg-muted text-foreground px-4 py-2.5 text-sm whitespace-pre-wrap"
              }
            >
              {m.parts.map((p, i) =>
                p.type === "text" ? <span key={i}>{p.text}</span> : null,
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t p-4 flex gap-2">
        <Textarea
          ref={inputRef}
          rows={2}
          placeholder="Message…"
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <Button onClick={stop} variant="secondary">
            Stop
          </Button>
        ) : (
          <Button onClick={submit}>Send</Button>
        )}
      </div>
    </div>
  );
}

export default App;
