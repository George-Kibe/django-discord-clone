"use client";

import { SmilePlus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  EMOJI_CATEGORIES,
  emojiName,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
  type EmojiEntry,
} from "../emoji";

function Grid({ items, onPick }: { items: EmojiEntry[]; onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {items.map((e) => (
        <button
          key={e.emoji}
          type="button"
          onClick={() => onPick(e.emoji)}
          className="flex size-8 items-center justify-center rounded text-xl hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={e.name}
          title={`:${e.name.replaceAll(" ", "_")}:`}
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );
}

/** Emoji popover: search by name, recently used first. */
export function EmojiPicker({
  onPick,
  label,
  trigger,
  align = "end",
}: {
  onPick: (emoji: string) => void;
  label: string;
  trigger?: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const results = useMemo(() => searchEmoji(query), [query]);

  function pick(emoji: string) {
    rememberEmoji(emoji);
    onPick(emoji);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setRecent(recentEmoji());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={label}
            className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <SmilePlus className="size-4" aria-hidden />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[19rem] p-2" aria-label={label}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="mb-2 h-8"
          autoFocus
        />
        <div className="max-h-64 overflow-y-auto pr-1" data-testid="emoji-picker">
          {query ? (
            results.length ? (
              <Grid items={results} onPick={pick} />
            ) : (
              <p className="p-2 text-sm text-muted-foreground">No emoji found.</p>
            )
          ) : (
            <>
              {recent.length ? (
                <section className="mb-2">
                  <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                    Recently used
                  </h3>
                  <Grid
                    items={recent.map((emoji) => ({ emoji, name: emojiName(emoji) }))}
                    onPick={pick}
                  />
                </section>
              ) : null}
              {EMOJI_CATEGORIES.map((category) => (
                <section key={category.name} className="mb-2">
                  <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                    {category.name}
                  </h3>
                  <Grid items={category.emojis} onPick={pick} />
                </section>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
