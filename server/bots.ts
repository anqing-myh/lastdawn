import {randomBytes} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {cards} from '../src/shared/catalog';
import {chooseBotActions,chooseBotPick,chooseBotReaction,observeRoom} from '../src/bots/index';
import type {BotObservation} from '../src/bots/index';
import {seedOf} from '../src/bots/random';
import type {Action,ReactionDecision,ReactionRequest,Room} from '../src/shared/types';
import {pendingDeclarations} from '../src/shared/declarations';
import type {RoomService} from './rooms';

export interface BotJob {view:BotObservation;request?:ReactionRequest;seed:number}
type BotResult=Action[]|ReactionDecision;
export type BotDecider=(job:BotJob,signal:AbortSignal)=>Promise<BotResult>;

/** One persistent worker keeps greedy previews off the WebSocket/event loop. */
export class BotWorker {
 private worker?:Worker;
 private tail:Promise<unknown>=Promise.resolve();
 private stopped=false;
 private cancelActive?:()=>void;
 decide:BotDecider=(job,signal)=>{
  const task=this.tail.then(()=>new Promise<BotResult>((resolve,reject)=>{
   if(this.stopped||signal.aborted){reject(Error('Computer decision cancelled'));return;}
   const worker=this.worker??=new Worker(new URL('./bot-worker.mjs',import.meta.url));
   const finish=(error:Error|null,result?:BotResult)=>{
    clearTimeout(timer);signal.removeEventListener('abort',abort);
    worker.off('message',message);worker.off('error',failed);worker.off('exit',exited);
    this.cancelActive=undefined;
    if(error){if(this.worker===worker)this.worker=undefined;void worker.terminate();reject(error);}else resolve(result!);
   };
   const abort=()=>finish(Error('Computer decision cancelled'));
   const failed=(error:Error)=>finish(error);
   const exited=(code:number)=>finish(Error('Computer worker exited: '+code));
   const message=(reply:{error?:string;result:BotResult})=>finish(reply.error?Error(reply.error):null,reply.result);
   const timer=setTimeout(()=>finish(Error('Computer decision timed out')),20_000);
   this.cancelActive=abort;signal.addEventListener('abort',abort,{once:true});
   worker.once('message',message);worker.once('error',failed);worker.once('exit',exited);
   worker.postMessage(job);
  }));
  this.tail=task.catch(()=>{});return task;
 };
 close(){this.stopped=true;this.cancelActive?.();void this.worker?.terminate();this.worker=undefined;}
}

/** Computer players use the same projected information and validated room APIs as humans. */
export class ComputerService {
 private states=new Map<string,{room:Room;seed:number;pending?:{key:string;abort:AbortController}}>();
 private changed=new Set<string>();
 constructor(private rooms:RoomService,private decide:BotDecider){}
 private decision(room:Room,seed:number){
  const side=room.botSide!;
  if(room.phase!=='battle'||!room.players.some((p,i)=>i!==side&&p.connected))return;
  if(room.battleStage==='reaction'&&room.reaction?.side===side){
   const view=observeRoom(this.rooms.view(room.id,room.players[side].id));
   return {key:'reaction:'+room.reaction.id,job:{view,request:structuredClone(room.reaction),seed:seedOf(seed,room.reaction.id)}};
  }
  if(room.battleStage!=='planning'||room.actions[side])return;
  if(!pendingDeclarations(room,side).length&&pendingDeclarations(room,(1-side) as 0|1).length)return;
  const view=observeRoom(this.rooms.view(room.id,room.players[side].id));
  return {key:'plan:'+room.phaseStarted+':'+JSON.stringify(view),job:{view,seed:seedOf(seed,'round',view.round)}};
 }
 tick(){
  for(const [id,state] of this.states)if(this.rooms.rooms.get(id)!==state.room||state.room.phase==='finished'){
   state.pending?.abort.abort();this.states.delete(id);
  }
  for(const room of this.rooms.rooms.values()){
   if(room.botSide===undefined||room.phase==='finished')continue;
   const side=room.botSide,pid=room.players[side].id;
   let state=this.states.get(room.id);
   if(!state){state={room,seed:randomBytes(4).readUInt32LE(0)};this.states.set(room.id,state);}
   if(room.battleStage==='resolving'&&room.playback&&!room.playback.ready.includes(side)){
    this.rooms.playbackReady(room.id,pid,room.playback.id);this.changed.add(room.id);
   }
   if(room.phase==='draft'&&room.players.some((p,i)=>i!==side&&p.connected)){
    const current=room.draftIndex===0||room.draftIndex===3?room.first:1-room.first;
    if(current===side){
     const card=chooseBotPick(cards.map(c=>c.id),room.picks.flat(),{strategy:'random',seed:seedOf(state.seed,'pick',room.draftIndex)});
     this.rooms.pick(room.id,pid,card);this.changed.add(room.id);
    }
   }
   const next=this.decision(room,state.seed);
   if(state.pending?.key===next?.key)continue;
   state.pending?.abort.abort();state.pending=undefined;
   if(!next)continue;
   const pending={key:next.key,abort:new AbortController()};state.pending=pending;
   const currentState=state;
   void this.decide(next.job,pending.abort.signal).catch(error=>{
    if(pending.abort.signal.aborted)throw error;
    console.error('Computer greedy decision failed; using a legal fallback',error);
    const options={strategy:'random' as const,seed:next.job.seed};
    return next.job.request?chooseBotReaction(next.job.view,next.job.request,options):chooseBotActions(next.job.view,options);
   }).then(result=>{
    if(pending.abort.signal.aborted||this.rooms.rooms.get(room.id)!==room||this.decision(room,currentState.seed)?.key!==pending.key)return;
    if(next.job.request)this.rooms.respond(room.id,pid,next.job.request.id,result as ReactionDecision);
    else {
     const actions=(result as Action[]).map(a=>room.declarations?.actions.find(locked=>locked.actor===a.actor)??a);
     for(const unit of pendingDeclarations(room,side)){
      const action=actions.find(a=>a.actor===unit.id);if(!action)throw Error('Computer declaration missing');
      this.rooms.declare(room.id,pid,action);
     }
     if(!pendingDeclarations(room,(1-side) as 0|1).length)this.rooms.act(room.id,pid,actions);
    }
    this.changed.add(room.id);
   }).catch(error=>{if(!pending.abort.signal.aborted)console.error('Computer action failed',error);})
    .finally(()=>{if(currentState.pending===pending)currentState.pending=undefined;});
  }
  const changed=[...this.changed];this.changed.clear();return changed;
 }
 close(){for(const state of this.states.values())state.pending?.abort.abort();this.states.clear();}
}
