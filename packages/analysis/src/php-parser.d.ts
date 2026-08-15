declare module "php-parser" {
  interface EngineOptions {
    parser?: { extractDoc?: boolean; php7?: boolean };
    ast?: { withPositions?: boolean; withSource?: boolean };
  }
  const PhpParser: {
    Engine: new (options?: EngineOptions) => { parseCode(code: string, filename?: string): unknown };
  };
  export default PhpParser;
}
