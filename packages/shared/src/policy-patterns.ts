export function policyPatternError(pattern: string): string | undefined {
  if (pattern.length === 0) return "Pattern cannot be empty";
  if (pattern.length > 256) return "Pattern exceeds the 256-character safety limit";
  if (/\\[1-9]/.test(pattern)) return "Backreferences are not supported in policy patterns";
  if (/\((?:[^()]|\\.)*[+*](?:[^()]|\\.)*\)\s*(?:[+*]|\{)/.test(pattern)) {
    return "Nested repetition is not supported in policy patterns";
  }
  if (/(?:\.\*|\.\+)\s*(?:\.\*|\.\+)/.test(pattern)) return "Adjacent wildcard repetition is not supported in policy patterns";
  try {
    new RegExp(pattern, "gi");
    return undefined;
  } catch {
    return "Pattern is not a valid regular expression";
  }
}

