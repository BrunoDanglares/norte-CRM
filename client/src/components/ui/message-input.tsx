import { useState, useRef, useCallback, useEffect } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Smile } from "lucide-react";

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  variables?: string[];
  disabled?: boolean;
  "data-testid"?: string;
  minHeight?: string;
}

export function MessageInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  className = "",
  variables = ["nome"],
  disabled = false,
  minHeight,
  ...props
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    }
    if (showEmoji) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showEmoji]);

  const insertAtCursor = useCallback((text: string) => {
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const newVal = value.substring(0, start) + text + value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      onChange(value + text);
    }
  }, [value, onChange]);

  const insertVariable = useCallback((varName: string) => {
    insertAtCursor(`{{${varName}}}`);
  }, [insertAtCursor]);

  const handleEmojiSelect = useCallback((emoji: any) => {
    insertAtCursor(emoji.native);
    setShowEmoji(false);
  }, [insertAtCursor]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={`w-full text-sm bg-background border border-border rounded-lg px-3 py-2.5 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none transition-colors ${className}`}
          style={minHeight ? { minHeight } : undefined}
          data-testid={props["data-testid"]}
        />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative" ref={emojiRef}>
          <button
            type="button"
            onClick={() => setShowEmoji(!showEmoji)}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Emojis"
            data-testid="button-emoji-picker"
          >
            <Smile className="w-4 h-4" />
          </button>
          {showEmoji && (
            <div className="absolute bottom-8 left-0 z-50">
              <Picker
                data={data}
                onEmojiSelect={handleEmojiSelect}
                theme="dark"
                locale="pt"
                previewPosition="none"
                skinTonePosition="none"
                perLine={8}
                maxFrequentRows={1}
              />
            </div>
          )}
        </div>
        <div className="h-4 w-px bg-border mx-0.5" />
        {variables.map((v) => (
          <button
            key={v}
            type="button"
            className="px-2 py-0.5 rounded-md text-[9.5px] font-mono bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40 transition-colors cursor-pointer"
            onClick={() => insertVariable(v)}
            title={`Inserir {{${v}}}`}
            data-testid={`var-chip-${v}`}
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}
