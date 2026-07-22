import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------- Button --------------------------------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading, children, disabled, ...props },
    ref
  ) => {
    const variants = {
      primary:
        "bg-[var(--brand)] text-[var(--brand-fg)] hover:bg-[var(--brand-hover)] shadow-sm",
      outline:
        "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]",
      ghost: "text-[var(--text)] hover:bg-[var(--surface-2)]",
      danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
    };
    const sizes = {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-11 px-5 text-base",
    };
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 disabled:opacity-50 disabled:cursor-not-allowed",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

/* ---------------------------------- Input ---------------------------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[var(--text)] placeholder:text-[var(--muted)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:border-[var(--brand)]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

/* ---------------------------------- Label ---------------------------------- */
export function Label({
  children,
  htmlFor,
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-1.5 block text-sm font-medium text-[var(--text)]", className)}
    >
      {children}
    </label>
  );
}

/* ---------------------------------- Card ----------------------------------- */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

/* --------------------------------- Spinner --------------------------------- */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-[var(--muted)]", className)} />;
}

/* ------------------------------- Alert banner ------------------------------ */
export function Alert({
  children,
  variant = "danger",
}: {
  children: ReactNode;
  variant?: "danger" | "success" | "info";
}) {
  const styles = {
    danger: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
    success:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900",
    info: "bg-[var(--brand-soft)] text-[var(--brand)] border-[var(--brand)]/20",
  };
  return (
    <div className={cn("rounded-lg border px-3.5 py-2.5 text-sm", styles[variant])}>
      {children}
    </div>
  );
}
