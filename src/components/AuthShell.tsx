import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/** Centered branded shell for auth screens (login / reset). */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--bg)] p-[60px]">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-5 h-6 w-auto text-[var(--text)]" />
          {title && (
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
          )}
          {subtitle && <p className="mt-1.5 text-sm text-[var(--muted)]">{subtitle}</p>}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-7">
          {children}
        </div>

        {footer && <div className="mt-5 text-center text-sm text-[var(--muted)]">{footer}</div>}
      </div>
    </div>
  );
}
