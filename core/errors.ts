/** Persist only allowlisted categories, never provider messages, request bodies, or credentials. */
export function errorCategory(error: unknown): string {
  const e=error as {name?:string;statusCode?:number};
  if(e?.statusCode===401 || e?.statusCode===403) return 'provider_authentication_failed';
  if(e?.statusCode===429) return 'provider_rate_limited';
  if(e?.name==='TimeoutError' || e?.name==='AbortError') return 'provider_timeout';
  if(e?.name==='ZodError' || e?.name==='AI_NoObjectGeneratedError') return 'invalid_structured_output';
  if(e?.name==='AI_APICallError') return 'model_provider_failed';
  return 'workflow_failed';
}
