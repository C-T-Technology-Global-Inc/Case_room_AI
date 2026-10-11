"use client";

import { Button } from "@ccr/ui/components/button";
import { Spinner } from "@ccr/ui/components/misc";
import { LogOutIcon } from "lucide-react";
import { useTransition } from "react";
import { logoutAction } from "@/server/actions/auth";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" size="lg" className="w-full" disabled={pending} onClick={() => startTransition(() => logoutAction("/login"))}>
      {pending ? <Spinner /> : <LogOutIcon />}
      Sign out
    </Button>
  );
}
