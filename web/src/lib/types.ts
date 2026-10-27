// Shapes shared by the UI, the API client and the mock API. See API.md.

export interface Scope {
  company: string;
  body: string;
}

export interface Me {
  name: string;
  email: string;
  scopes: Scope[];
}

export interface ChatFilters {
  company?: string;
  body?: string;
  date_from?: string; // YYYY-MM-DD
  date_to?: string; // YYYY-MM-DD
}

export interface ChatRequest {
  conversation_id: string | null;
  question: string;
  filters: ChatFilters;
}

export interface Source {
  id: string;
  source_type: "minutes" | "synopsis";
  company: string;
  body: string;
  meeting_date: string; // YYYY-MM-DD
  item: string;
  title: string;
  pages: number[];
  page_image_urls: string[];
  topic?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string; // ISO 8601
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  found?: boolean;
  created_at: string; // ISO 8601
}

export interface Conversation {
  id: string;
  title: string;
  messages: StoredMessage[];
}

/** Client-side message, with streaming state on top of the stored shape. */
export interface ChatMessage extends StoredMessage {
  status?: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

// ---- Check a draft (POST /check) -------------------------------------------

export type CheckStatus =
  | "conflict"
  | "changes_limit"
  | "needs_review"
  | "within_limit"
  | "no_conflict"
  | "no_limit_found";

/** Most severe first: the order results are shown in. */
export const CHECK_STATUS_ORDER: CheckStatus[] = [
  "conflict",
  "changes_limit",
  "needs_review",
  "within_limit",
  "no_conflict",
  "no_limit_found",
];

export interface CheckAmount {
  value: number;
  unit: string;
}

export interface CheckLimit {
  value: number;
  unit: string;
  basis: string | null;
}

export interface CheckMeta {
  check_id: string;
  document: string;
  /** "ocr" when the draft was a scanned / image-only PDF or an image. */
  read_with?: "text" | "ocr";
  items_found: number;
  proposals: string[];
}

export interface CheckItem {
  id: string;
  proposal: string;
  category: string | null;
  amount: CheckAmount | null;
  basis: string | null;
  status: CheckStatus;
  /** Finding text; [1], [2] refer to `governing` in order. */
  finding: string;
  /** Calculated in code, e.g. "Proposed Rs. 400 crore vs limit Rs. 300 crore per bank". */
  comparison: string | null;
  limit: CheckLimit | null;
  governing: Source[];
  superseded: Source[];
}

export type CheckSummary = Record<CheckStatus, number>;
