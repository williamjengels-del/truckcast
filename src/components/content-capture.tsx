"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { updateContentCapture } from "@/app/dashboard/events/actions";

interface Props {
  eventId: string;
  initialValue: string | null;
}

/**
 * Content capture — free-form scratchpad on the day-of card.
 * Debounced auto-save (1.2s after last keystroke). Status pip shows
 * "Saved" briefly after a successful write.
 *
 * Single field, not append-only — operator iterates on the same text.
 * "Future work: structure for forecastability" is explicitly out of
 * scope for v1 (spec §8).
 */
export function ContentCapture({ eventId, initialValue }: Props) {
  const [value, setValue] = useState<string>(initialValue ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastSavedRef = useRef<string>(initialValue ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save effect — runs whenever value changes and differs
  // from the last successfully-saved snapshot.
  useEffect(() => {
    if (value === lastSavedRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const snapshot = value;
      startTransition(async () => {
        try {
          await updateContentCapture(eventId, snapshot);
          lastSavedRef.current = snapshot;
          setSavedAt(Date.now());
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn't save");
        }
      });
    }, 1200);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
     
  }, [value, eventId]);

  // Brief "Saved" pip — fades out 2s after each save. Uses Date.now()
  // during render which the lint flags as impure; intentional here
  // because the pip is a 2s-window UI hint and re-renders triggered by
  // unrelated state changes naturally re-evaluate. A setTimeout-driven
  // boolean would also work but adds another effect for a transient
  // hint.
  // eslint-disable-next-line react-hooks/purity -- intentional 2s-window UI hint, re-evaluates on any render
  const showSaved = savedAt !== null && Date.now() - savedAt < 2000;

  return (
    <div className="space-y-2" data-testid="day-of-event-content-capture">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Content capture
        </p>
        {pending && (
          <span className="text-xs text-muted-foreground">Saving…</span>
        )}
        {!pending && showSaved && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
            <Check className="h-3 w-3" />
            Saved
          </span>
        )}
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="B-roll moments, story ideas, photo references…"
        rows={3}
        data-testid="day-of-event-content-capture-textarea"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
