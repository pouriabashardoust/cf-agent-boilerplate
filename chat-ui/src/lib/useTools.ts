import { useEffect, useState } from "react";

export type Tool = {
  name: string;
  description: string;
  permissions: string[];
};

export function useTools() {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tools")
      .then((r) => {
        if (!r.ok) throw new Error(`/api/tools ${r.status}`);
        return r.json() as Promise<Tool[]>;
      })
      .then((data) => {
        if (!cancelled) setTools(data);
      })
      .catch((e) => {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { tools, error, loading: tools === null && !error };
}
