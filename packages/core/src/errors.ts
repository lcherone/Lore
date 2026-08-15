export class LoreError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LoreError";
  }
}

export class NotFoundError extends LoreError {
  public constructor(resource: string, id: string) {
    super(`${resource} '${id}' was not found`, "NOT_FOUND", 404, { resource, id });
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends LoreError {
  public constructor(message = "This organisation cannot access the requested resource") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends LoreError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, details);
    this.name = "ConflictError";
  }
}
