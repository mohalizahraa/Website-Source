"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// A "learning" toast. Segments may include a small RTL Arabic phrase, so the
// message is an array of typed parts rather than raw HTML (no dangerouslySet).
export type ToastPart =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "ar"; v: string };

export type ToastMessage = ToastPart[];

interface ToastCtx {
  learn: (msg: ToastMessage) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within <ToastProvider>");
  return c;
}

// Convenience builders.
export const T = {
  text: (v: string): ToastPart => ({ t: "text", v }),
  strong: (v: string): ToastPart => ({ t: "strong", v }),
  ar: (v: string): ToastPart => ({ t: "ar", v }),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<ToastMessage | null>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const learn = useCallback((m: ToastMessage) => {
    setMsg(m);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 4200);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <Ctx.Provider value={{ learn }}>
      {children}
      <div className={"toast" + (show ? " show" : "")} role="status" aria-live="polite">
        <svg className="spark" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
        </svg>
        <span>
          {msg?.map((p, i) => {
            if (p.t === "strong") return <b key={i}>{p.v} </b>;
            if (p.t === "ar")
              return (
                <span key={i} className="learned" dir="rtl">
                  {p.v}
                </span>
              );
            return <span key={i}>{p.v}</span>;
          })}
        </span>
      </div>
    </Ctx.Provider>
  );
}
