import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";

/**
 * Reached via the reset link in the email. Supabase parses the recovery token
 * from the URL (detectSessionInUrl) and creates a temporary session, allowing
 * updateUser({ password }). Also used by invited admins to set their first password.
 */
export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("הסיסמה חייבת להכיל לפחות 8 תווים.");
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      navigate("/", { replace: true });
    } catch {
      setError("עדכון הסיסמה נכשל. ייתכן שהקישור פג תוקף — בקש קישור חדש.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="קביעת סיסמה" subtitle="בחר סיסמה חדשה לחשבון שלך">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="password">סיסמה חדשה</Label>
          <Input
            id="password"
            type="password"
            dir="ltr"
            placeholder="לפחות 8 תווים"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="confirm">אישור סיסמה</Label>
          <Input
            id="confirm"
            type="password"
            dir="ltr"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <Button type="submit" size="lg" loading={loading} className="w-full">
          שמירת סיסמה
        </Button>
      </form>
    </AuthShell>
  );
}
