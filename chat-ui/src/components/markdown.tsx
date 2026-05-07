import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: (props) => (
    <h1 className="text-lg font-semibold tracking-tight mt-6 mb-3 first:mt-0" {...props} />
  ),
  h2: (props) => (
    <h2 className="text-base font-semibold tracking-tight mt-5 mb-2.5 first:mt-0" {...props} />
  ),
  h3: (props) => (
    <h3 className="text-sm font-semibold uppercase tracking-[0.06em] mt-4 mb-2 first:mt-0" {...props} />
  ),
  p: (props) => <p className="leading-[1.7] my-2 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="list-disc list-outside pl-5 my-2 space-y-1" {...props} />,
  ol: (props) => <ol className="list-decimal list-outside pl-5 my-2 space-y-1 tabular-nums" {...props} />,
  li: (props) => <li className="leading-[1.65]" {...props} />,
  a: (props) => (
    <a
      className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-l-2 border-primary/40 pl-3 my-3 text-muted-foreground italic"
      {...props}
    />
  ),
  hr: () => <hr className="my-4 border-border" />,
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code
          className={`block ${className ?? ""}`}
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="px-1 py-0.5 rounded-sm bg-muted text-[0.92em] tabular-nums"
        {...rest}
      >
        {children}
      </code>
    );
  },
  pre: (props) => (
    <pre
      className="my-3 p-3 rounded-md bg-muted/70 border border-border overflow-x-auto text-[12.5px] leading-[1.55]"
      {...props}
    />
  ),
  table: (props) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[13px]" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted/50" {...props} />,
  th: (props) => (
    <th
      className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.1em] font-medium border-b border-border"
      {...props}
    />
  ),
  td: (props) => (
    <td className="px-3 py-2 border-b border-border last:border-b-0" {...props} />
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
