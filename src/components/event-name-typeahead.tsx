"use client";

import { useState, useEffect, useRef, useId } from "react";
import { Input } from "@/components/ui/input";

// EventName typeahead — replaces the bare <Input> for event_name on
// EventForm. As the operator types, suggests canonical names from
// platform_events.event_name_display (sourced via /api/event-names/
// search). On select, fills the field. On free-form typing the value
// stays as-typed — operators can still create a new bucket when they
// genuinely mean a new event.
//
// Why this exists: platform_events buckets by lowercase+trim only, so
// "Saturday Farmer's Market" and "Saturday Farmers Market" split into
// separate buckets and never hit the privacy floor for the cross-
// operator hints. The autocomplete is the cheap, non-destructive UX
// nudge — guides convergence on the canonical name without forcing
// any merge.

interface Suggestion {
  name: string;
  operator_count: number;
}

interface Props {
  /** Form-control id (also used for label htmlFor). */
  id?: string;
  /** Form field name — submitted as part of the FormData. */
  name?: string;
  /** Initial value (uncontrolled outer, controlled inner). */
  defaultValue?: string;
  /** Required-attribute pass-through. */
  required?: boolean;
  /** Placeholder pass-through. */
  placeholder?: string;
}

export function EventNameTypeahead({
  id,
  name = "event_name",
  defaultValue = "",
  required,
  placeholder,
}: Props) {
  const generatedId = useId();
  const inputId = id ?? `event-name-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Last query the input was at when results came back; lets us
  // discard stale responses if the operator kept typing.
  const lastQueryRef = useRef("");

  // Debounced fetch. 200ms is enough to feel snappy but spares the
  // DB while the operator is mid-word.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    lastQueryRef.current = trimmed;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/event-names/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!res.ok) return;
        const body = (await res.json()) as { suggestions?: Suggestion[] };
        // Discard if the input has moved on while this request was in
        // flight.
        if (lastQueryRef.current !== trimmed) return;
        setSuggestions(body.suggestions ?? []);
      } catch {
        // Silent — typeahead is a nudge, not a load-bearing feature.
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(s: Suggestion) {
    setValue(s.name);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={inputId}
        name={name}
        required={required}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md max-h-72 overflow-auto py-1"
        >
          {suggestions.map((s, i) => {
            const active = i === activeIdx;
            return (
              <li
                key={s.name}
                role="option"
                aria-selected={active}
                className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-3 ${
                  active ? "bg-muted" : "hover:bg-muted/60"
                }`}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input doesn't lose
                  // focus + the outside-click handler doesn't fire
                  // first.
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="truncate">{s.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {s.operator_count} op{s.operator_count === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
