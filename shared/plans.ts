export type PlanKind = "markdown" | "html" | "image" | "file";
export type Visibility = "private" | "shared";
export type ActorKind = "agent" | "key" | "browser";

export const MAX_PLAN_CHARACTERS = 48_000;

export const CAPABILITIES = [
  { id: "list_plans", label: "See your drops", detail: "Titles, links, and who dropped them.", sensitive: false },
  { id: "upload_plan", label: "Drop docs and apps", detail: "Everything starts private.", sensitive: false },
  { id: "share_plan", label: "Share and unshare", detail: "Makes a drop readable by anyone with the link.", sensitive: true },
  { id: "delete_plan", label: "Delete drops", detail: "Removes a drop and its link for good.", sensitive: true }
] as const;

export function kindFromFilename(filename: string): PlanKind {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (["md", "markdown", "txt"].includes(extension)) return "markdown";
  if (["html", "htm"].includes(extension)) return "html";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)) return "image";
  return "file";
}

export function titleFromSource(source: string, kind: PlanKind, filename: string): string {
  if (kind === "markdown") {
    const frontmatterTitle = source.match(/^---\n[\s\S]*?^title:\s*(.+)$[\s\S]*?^---/m)?.[1];
    const heading = source.match(/^#\s+(.+)$/m)?.[1];
    const title = (frontmatterTitle ?? heading)?.trim().replace(/^["']|["']$/g, "");
    if (title) return title.slice(0, 120);
  }
  if (kind === "html") {
    const title = source.match(/<title>([^<]+)<\/title>/i)?.[1] ?? source.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1];
    if (title?.trim()) return title.trim().slice(0, 120);
  }
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120) || "Untitled plan";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function deviceCode(seed: number): string {
  const alphabet = "BCDFGHJKLMNPQRSTVWXZ";
  let letters = "";
  let value = Math.floor(seed);
  for (let index = 0; index < 4; index += 1) {
    letters += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) + 7 * (index + 3);
  }
  return `${letters}-${String(Math.floor(seed) % 10_000).padStart(4, "0")}`;
}
