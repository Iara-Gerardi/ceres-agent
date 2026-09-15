import { mkdir, writeFile } from 'node:fs/promises';

// Run against `npm run dev`. This exercises the agent, discovery, and live MCP,
// rather than bypassing Ceres with a direct PostHog request.
const host=process.env.CERES_DEV_URL??'http://127.0.0.1:2000';
const signal=AbortSignal.timeout(300_000);
let sessionId=process.env.CERES_SESSION_ID;
if(!sessionId){
  const response=await fetch(`${host}/eve/v1/session`,{
    method:'POST',headers:{'Content-Type':'application/json'},signal,
    body:JSON.stringify({message:'Generate an insight based on the landing page data for 2wander.space from the last 180 days.'}),
  });
  if(!response.ok)throw new Error(`Session creation failed: ${response.status}`);
  sessionId=(await response.json() as {sessionId:string}).sessionId;
}
console.log(`Ceres session: ${sessionId}`);
const stream=await fetch(`${host}/eve/v1/session/${sessionId}/stream`,{signal});
if(!stream.ok||!stream.body)throw new Error(`Session stream failed: ${stream.status}`);
let buffer='',transcript='',answer='',completed=false;
const sqlCalls=new Set<string>();
let successfulQueries=0;
const decoder=new TextDecoder();
for await(const chunk of stream.body){
  const text=decoder.decode(chunk,{stream:true});buffer+=text;transcript+=text;
  let newline:number;
  while((newline=buffer.indexOf('\n'))!==-1){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    if(!line.trim())continue;
    const event=JSON.parse(line);
    if(event.type==='actions.requested')for(const action of event.data.actions){
      if(action.toolName==='posthog__exec'&&/^call (?:--json )?execute-sql /.test(action.input?.command??'')&&/\bevents\b/i.test(action.input.command)&&action.input.command.includes('180'))sqlCalls.add(action.callId);
    }
    if(event.type==='action.result'){
      const result=event.data.result;
      if(sqlCalls.has(result.callId)&&event.data.status==='completed'&&!result.output?.isError)successfulQueries++;
    }
    if(event.type==='message.completed')answer=event.data.message;
    if(event.type==='turn.completed')completed=true;
    if(event.type==='turn.failed')throw new Error('Ceres turn failed');
  }
  if(completed)break;
}
await mkdir('.eve/live-results',{recursive:true});
await writeFile('.eve/live-results/posthog-session.ndjson',transcript);
await writeFile('.eve/live-results/posthog-answer.md',answer);
if(!completed||!successfulQueries||!answer)throw new Error('Live verification failed: expected a completed answer backed by successful SQL calls');
console.log(JSON.stringify({status:'pass',sessionId,successfulQueries,answer},null,2));
