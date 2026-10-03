import { Button } from "@ccr/ui/components/button";
import { SearchXIcon } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchXIcon className="size-5" />
      </div>
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="max-w-md text-[13px] text-muted-foreground">
        This record does not exist, or you are not a member of the care team that can access it.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
