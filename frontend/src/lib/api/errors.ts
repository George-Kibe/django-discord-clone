import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/** The backend's uniform error envelope (docs/API.md §1 "Errors"). */
export type ApiErrorBody = {
  type: string;
  code: string;
  detail: string;
  fields?: Record<string, string[]>;
  request_id?: string;
};

/** Most useful human message: first non-field error, else first field error, else summary. */
function friendlyMessage(body: ApiErrorBody): string {
  const fields = body.fields ?? {};
  const general = fields.non_field_errors?.[0] ?? fields.token?.[0];
  if (general) return general;
  return Object.values(fields)[0]?.[0] ?? body.detail ?? "Something went wrong.";
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    // Error's constructor sets an own `message`, so compute it here (a getter would be shadowed).
    super(friendlyMessage(body));
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.code;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "type" in value && "detail" in value;
}

export function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) return new ApiError(status, body);
  return new ApiError(status, {
    type: "server_error",
    code: "unknown",
    detail: status >= 500 ? "The server had a problem. Please try again." : "Request failed.",
  });
}

/** Maps API field errors onto react-hook-form fields; returns errors it couldn't place. */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldNames: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return "Network error. Check your connection and try again.";
  const fields = error.body.fields ?? {};
  let placed = false;
  for (const name of fieldNames) {
    const messages = fields[name as string];
    if (messages?.length) {
      setError(name, { type: "server", message: messages[0] });
      placed = true;
    }
  }
  const leftovers = Object.entries(fields).filter(([key]) => !fieldNames.includes(key as Path<T>));
  if (leftovers.length) return leftovers[0][1][0];
  return placed ? null : error.message;
}
