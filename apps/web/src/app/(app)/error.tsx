"use client";

import { Button } from "@ccr/ui/components/button";
import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangleIcon className="size-5" />
      </div>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-[13px] text-muted-foreground">The page could not be loaded. No clinical data was changed. Try again, or return to the dashboard.</p>
      {error.digest && <p className="font-mono text-[11px] text-muted-foreground">Reference: {error.digest}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
        <Button size="sm" asChild>
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
