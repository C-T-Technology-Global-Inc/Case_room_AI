import { Input } from "@ccr/ui/components/input";
import { Label } from "@ccr/ui/components/label";

/** "Choose a password" and "Repeat it" fields; the server checks that both match. */
export function NewPasswordFields({ name = "password", label = "Choose a password" }: { name?: string; label?: string }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={name}>{label}</Label>
        <Input id={name} name={name} type="password" required minLength={8} maxLength={200} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Repeat the password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} maxLength={200} autoComplete="new-password" />
      </div>
    </>
  );
}
