"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  async function handleSubmit() {
    if (!message.trim()) return;

    setStatus("submitting");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          page: window.location.pathname,
        }),
      });

      if (!res.ok) throw new Error("Failed to submit");

      setStatus("success");
      setMessage("");

      // Close dialog after showing success briefly
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
      }, 1500);
    } catch {
      setStatus("error");
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Reset state when closing
      setTimeout(() => {
        setStatus("idle");
        setMessage("");
      }, 150);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="fixed right-6 bottom-6 z-50 gap-1.5 shadow-lg"
          />
        }
      >
        <MessageSquarePlus className="size-4" />
        Feedback
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>
            Help us improve TruckCast. Bug reports, feature requests, and
            general feedback are all welcome.
          </DialogDescription>
        </DialogHeader>

        {status === "success" ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Thanks for your feedback!
          </div>
        ) : (
          <>
            <Textarea
              placeholder="What's on your mind?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-24"
              disabled={status === "submitting"}
            />
            {status === "error" && (
              <p className="text-sm text-destructive">
                Something went wrong. Please try again.
              </p>
            )}
          </>
        )}

        {status !== "success" && (
          <DialogFooter>
            <Button
              onClick={handleSubmit}
              disabled={!message.trim() || status === "submitting"}
            >
              {status === "submitting" ? "Sending..." : "Send Feedback"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
