import type {PlaybackFrame,PlaybackSnapshot,RoomView} from '../shared/types';

// A deterministic client clock: speed changes only the remaining display delay.
export class BattlePlayback {
 private latest:RoomView|null=null;
 private snapshot:PlaybackSnapshot|null=null;
 private id='';
 private cursor=0;
 private nextAt=0;
 private finished=false;
 private acknowledged=false;
 private speed:1|2=2;
 constructor(private display:(room:RoomView|null)=>void,private ready:(id:string)=>boolean){}
 private apply(frame:PlaybackFrame){
  const current:PlaybackSnapshot=this.snapshot!,record=current.record;
  this.snapshot={...current,units:current.units.map(u=>frame.units.find(n=>n.id===u.id)??u),record:{...record,order:frame.order,events:[...record.events,...frame.events],completedActions:[...(record.completedActions??[]),...frame.completedActions]}};
 }
 setSpeed(speed:1|2,now:number){
  this.nextAt=now+Math.max(0,this.nextAt-now)*this.speed/speed;
  this.speed=speed;
 }
 receive(room:RoomView|null,now:number){
  this.latest=room;
  const playback=room?.phase==='battle'&&room.battleStage==='resolving'?room.playback:undefined;
  if(!playback){this.id='';this.snapshot=null;this.display(room);return;}
  if(playback.id!==this.id){
   this.id=playback.id;this.snapshot=structuredClone(playback.initial);this.cursor=0;this.nextAt=now;this.finished=false;this.acknowledged=false;
   // Refreshing an already acknowledged segment must not replay it while the
   // other player can release the next planning/response phase at any moment.
   if(playback.ready.includes(room!.side)){for(const frame of playback.frames)this.apply(frame);this.cursor=playback.frames.length;this.finished=true;this.acknowledged=true;}
  }else if(this.finished&&!playback.ready.includes(room!.side))this.acknowledged=false;
  this.tick(now,true);
 }
 tick(now:number,force=false){
  const room=this.latest,playback=room?.playback;
  if(!room||!playback||!this.snapshot||!this.id)return;
  let changed=force;
  // Zero-duration completion frames can be consumed with the next visible effect.
  while(!this.finished&&now>=this.nextAt){
   const frame=playback.frames[this.cursor++];
   if(!frame){this.finished=true;changed=true;break;}
   this.apply(frame);
   this.nextAt=now+frame.durationMs*2/this.speed;changed=true;
   if(frame.durationMs>0)break;
  }
  if(changed){const s=this.snapshot!;this.display({...room,...s,records:[...room.records.filter(r=>r.round<s.record.round),s.record],playback:{...playback,finished:this.finished}});}
  if(this.finished&&!this.acknowledged&&!playback.ready.includes(room.side))this.acknowledged=this.ready(this.id);
 }
}
