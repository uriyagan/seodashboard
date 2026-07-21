import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MailCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";

export function ForgotPasswordPage() {
  const { requestReset } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestReset(email.trim());
      setSent(true);
    } catch {
      setError("שליחת המייל נכשלה. נסה שוב.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="נשלח מייל" subtitle="בדוק את תיבת הדואר שלך">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-950/50">
            <MailCheck className="size-6" />
          </div>
          <p className="text-sm text-[var(--muted)]">
            אם הכתובת קיימת במערכת, נשלח אליה קישור לאיפוס הסיסמה.
          </p>
          <Link to="/login" className="text-sm font-medium text-[var(--brand)] hover:underline">
            חזרה להתחברות
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="שכחתי סיסמה" subtitle="נשלח אליך קישור לאיפוס">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="email">אימייל</Label>
          <Input
            id="email"
            type="email"
            dir="ltr"
            placeholder="name@uriyaganor.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <Button type="submit" size="lg" loading={loading} className="w-full">
          שליחת קישור איפוס
        </Button>
        <Link
          to="/login"
          className="flex items-center justify-center gap-1 text-sm font-medium text-[var(--muted)] hover:text-[var(--text)]"
        >
          <ArrowRight className="size-4" />
          חזרה להתחברות
        </Link>
      </form>
    </AuthShell>
  );
}
