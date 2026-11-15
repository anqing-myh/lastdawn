import {randomUUID} from 'node:crypto';
import {config} from '../src/shared/catalog';
import {ReactionRequired,settleRound,validateExtraAction} from '../src/shared/engine';
import type {Action,Battle,Event,ReactionRequest,ReactionDecision,Room,Side} from '../src/shared/types';

export interface PlaybackSettings { eventMs?:number; actionMs?:number; roundEndMs?:number }
interface Resolution { room:Room; original:Battle; submitted:[Action[],Action[]]; decisions:Record<string,ReactionDecision>; displayed:number; result:Battle|null; request:ReactionRequest|null }

// Resolve each segment immediately. Each client owns its presentation clock.
// Both viewers reach a decision before the real-time response clock starts.
export class ResolutionService {
 private active=new Map<string,Resolution>();
 constructor(private clock:()=>number,private settings:PlaybackSettings={}){}
 clear(id:string){const tx=this.active.get(id);if(tx)delete tx.room.playback;this.active.delete(id);}
 ready(r:Room,side:Side,id:string){
  if(r.battleStage!=='resolving'||r.playback?.id!==id)return;
  if(!r.playback.ready.includes(side))r.playback.ready.push(side);
 }
 private calculate(tx:Resolution){
  const r=tx.room,initial=structuredClone(r.battle!),frames:{battle:Battle;event?:Event}[]=[];
  tx.result=null;tx.request=null;
  try{tx.result=settleRound(tx.original,tx.submitted,{interactive:true,decisions:tx.decisions,onFrame:(battle,event)=>frames.push({battle,event})});}
  catch(e){if(!(e instanceof ReactionRequired))throw e;tx.request=e.request;}
  const segment=frames.slice(tx.displayed);tx.displayed=frames.length;
  r.playback={id:randomUUID(),initial,ready:[],frames:segment.map(({battle,event},index)=>({battle,durationMs:(event?(event.kind==='action'?(this.settings.actionMs??config.presentation.action_ms):(this.settings.eventMs??config.presentation.event_ms)):0)+(index===segment.length-1?(this.settings.roundEndMs??config.presentation.round_end_ms):0)}))};
  if(segment.length)r.battle=segment.at(-1)!.battle;
  r.battleStage='resolving';r.deadline=0;r.reaction=null;r.updatedAt=this.clock();
 }
 start(r:Room){
  const tx:Resolution={room:r,original:structuredClone(r.battle!),submitted:structuredClone(r.actions as [Action[],Action[]]),decisions:{},displayed:0,result:null,request:null};
  this.calculate(tx);this.active.set(r.id,tx);
 }
 advance(r:Room,now:number):'changed'|'complete'|false {
  const tx=this.active.get(r.id);if(!tx)return false;
  if(r.battleStage==='reaction'){
   if(!r.reaction||now<r.reaction.deadline)return false;
   tx.decisions[r.reaction.id]=r.reaction.kind==='extra-action'?r.reaction.defaultAction:false;this.calculate(tx);return 'changed';
  }
  if(r.playback?.ready.length!==r.players.length)return false;
  delete r.playback;
  if(tx.request){r.battleStage='reaction';r.reaction={...tx.request,deadline:now+config.reactions.response_seconds*1000};r.updatedAt=now;return 'changed';}
  if(!tx.result)throw Error('Resolution missing result');
  r.battle=tx.result;r.actions=[null,null];r.reaction=null;this.active.delete(r.id);r.updatedAt=now;return 'complete';
 }
 respond(r:Room,reactionId:string,decision:ReactionDecision){
  const tx=this.active.get(r.id);if(!tx||!r.reaction||r.reaction.id!==reactionId)throw Error('Response window expired');
  if(r.reaction.kind==='extra-action'){if(typeof decision!=='object'||!decision)throw Error('请选择额外行动');validateExtraAction(r.battle!,r.reaction,decision);}else if(typeof decision!=='boolean')throw Error('请选择是否触发献祭');
  tx.decisions[reactionId]=structuredClone(decision);this.calculate(tx);
 }
}
