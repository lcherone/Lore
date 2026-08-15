import type { AIProvider, StructuredAIRequest } from "@lore/core/index.js";

export class MockAIProvider implements AIProvider {
  public constructor(private readonly resolver: (request: StructuredAIRequest<unknown>) => unknown = () => ({ candidates: [] })) {}

  async generateStructured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const raw = this.resolver(request as StructuredAIRequest<unknown>);
    return request.parse(structuredClone(raw));
  }
}

