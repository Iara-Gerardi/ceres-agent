/** Persist only allowlisted categories, never provider messages, request bodies, or credentials. */
export function errorCategory(error: unknown, provider: 'workflow' | 'linkup' = 'workflow'): string {
  const e=error as {name?:string;statusCode?:number};
  if(e?.statusCode===401 || e?.statusCode===403) return `${provider}_authentication_failed`;
  if(e?.statusCode===429) return `${provider}_rate_limited`;
  if(e?.name==='TimeoutError' || e?.name==='AbortError') return `${provider}_timeout`;
  if(provider==='linkup') return e?.name==='ZodError' || e instanceof SyntaxError ? 'linkup_invalid_response' : 'linkup_unavailable';
  if(e?.name==='ZodError' || e?.name==='AI_NoObjectGeneratedError') return 'invalid_structured_output';
  if(e?.name==='AI_APICallError') return 'model_provider_failed';
  return 'workflow_failed';
}
