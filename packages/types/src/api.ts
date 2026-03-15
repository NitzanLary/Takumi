export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface AiChatRequest {
  message: string;
  conversationId?: string;
}

export interface AiSseEvent {
  type: "text_delta" | "tool_call" | "tool_result" | "done" | "error";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  conversationId?: string;
  error?: string;
}
