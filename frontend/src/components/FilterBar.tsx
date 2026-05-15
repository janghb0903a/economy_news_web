import { Search } from "lucide-react";
import { ClearableInput, GhostButton } from "./ui";

type Props = {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSubmit?: () => void;
};

export default function FilterBar({ values, onChange, onSubmit }: Props) {
  return (
    <div className="sticky top-[65px] z-30 mb-5 rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <ClearableInput
          placeholder="검색어"
          value={values.q || ""}
          onChange={(event) => onChange("q", event.target.value)}
          onClear={() => onChange("q", "")}
          onKeyDown={(event) => event.key === "Enter" && onSubmit?.()}
        />
        <GhostButton onClick={onSubmit}>
          <Search size={16} /> 검색
        </GhostButton>
      </div>
    </div>
  );
}
