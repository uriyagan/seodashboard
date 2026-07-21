import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";

const ERROR_HE: Record<string, string> = {
  "Invalid login credentials": "אימייל או סיסמה שגויים.",
  "Email not confirmed": "החשבון עדיין לא אושר. בדוק את מייל ההזמנה.",
};

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password, remember);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "אירעה שגיאה";
      setError(ERROR_HE[msg] ?? "ההתחברות נכשלה. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="SEO Dashboard" subtitle="התחברות למערכת">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <div>
          <Label htmlFor="email">אימייל</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            dir="ltr"
            placeholder="name@uriyaganor.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="password">סיסמה</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
            <input
              type="checkbox"
              className="size-4 rounded border-[var(--border)] accent-[var(--brand)]"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            זכור אותי
          </label>
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-[var(--brand)] hover:underline"
          >
            שכחתי סיסמה
          </Link>
        </div>

        <Button type="submit" size="lg" loading={loading} className="w-full">
          התחברות
        </Button>
      </form>
    </AuthShell>
  );
}
