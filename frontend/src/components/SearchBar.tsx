import { FormEvent, useState } from "react";

interface Props {
  onSearch: (input: string) => void;
  loading: boolean;
}

export default function SearchBar({ onSearch, loading }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onSearch(value.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 w-full">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter a product name or paste a product URL..."
        className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-brand-600 text-white font-medium px-6 py-3 text-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {loading ? "Discovering..." : "Discover"}
      </button>
    </form>
  );
}
