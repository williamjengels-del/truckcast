"use client";

import { useState, useTransition } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { appendInServiceNote } from "@/app/dashboard/events/actions";

interface NoteEntry {
  timestamp: string;
  text: string;
}

interface Props {
  eventId: string;
  initialNotes: NoteEntry[];
  /** Operator's IANA timezone — used to render entry timestamps in
   *  their local time. */
  timezone: string;
}

function formatNoteTime(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

/**
 * In-service notes capture — append-only timestamped entries.
 * Renders inline on the day-of card during today's event.
 *
 * Optimistic update: append happens locally first, server action runs
 * in a transition. On error, the optimistic entry is rolled back and
 * the input restored. Operators in a rush won't lose their text.
 */
export function InServiceNotes({ eventId, initialNotes, timezone }: Props) {
  const [notes, setNotes] = useState<NoteEntry[]>(initialNotes);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    const optimistic: NoteEntry = { timestamp: new Date().toISOString(), text };
    const prev = notes;
    setNotes([...notes, optimistic]);
    setDraft("");
    startTransition(async () => {
      try {
        const next = await appendInServiceNote(eventId, text);
        setNotes(next);
      } catch (e) {
        setNotes(prev);
        setDraft(text);
        setError(e instanceof Error ? e.message : "Couldn't save note");
      }
    });
  }

  return (
    <div className="space-y-2" data-testid="day-of-event-in-service-notes">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          In-service notes
        </p>
      </div>

      {notes.length > 0 && (
        <ul className="space-y-1 text-sm">
          {notes.map((n, i) => (
            <li key={`${n.timestamp}-${i}`} className="flex gap-2">
              <span className="text-xs text-muted-foreground font-mono shrink-0 pt-0.5">
                {formatNoteTime(n.timestamp, timezone)}
              </span>
              <span className="text-sm whitespace-pre-line min-w-0">{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='e.g. "Bulgogi sold out at 12:40"'
          disabled={pending}
          data-testid="day-of-event-in-service-notes-input"
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending || !draft.trim()}
          className="gap-1.5 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </form>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
