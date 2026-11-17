import {cardOf,config,skillOf,stages} from './catalog';
import {alive,effective,getElements} from './primitives';
import {pendingDeclarations,planningDeadline,waitingForDeclaration} from './declarations';
import {actionHints,preplannedUnable,skillRestriction} from './engine';
import type {PublicUnit,PublicPlayback,PlaybackSnapshot,Battle,Room,RoomView,Side,Stat,Unit,Settlement} from './types';
export function projectUnit(u:Unit,side:Side,b?:Pick<Battle,'round'|'global'|'units'>):PublicUnit{
 const own=u.side===side,visible=new Set([...u.revealed,'tackle','charge']);
 const hiddenSources=new Set(u.skills.filter(id=>!visible.has(id)));
 const safeSource=(source:string)=>hiddenSources.has(source)?'hidden':source;
 const {skills,talent,pp,allocation,copied,disabled,statuses,modifiers,stageModifiers,counters,...rest}=u;
 const safeHistory=own?rest.history:[];
 const publicCounters=['燃','雷痕','moon_hits','flame_growth','exclusive_revealed','alba_unlocked','dark_total','冰封','weapon_count','death_energy','omni_pp','ghost_next'];
 const state=b??{round:Math.max(1,u.aliveRounds),global:{}};
 const unable=alive(u)&&preplannedUnable(u,state.round);
 const restrictions:Pick<PublicUnit,'skillRestrictions'|'actionHints'|'targetRestrictions'|'preplannedUnable'>=own?{preplannedUnable:unable,skillRestrictions:Object.fromEntries([...new Set([...skills,...copied,...disabled,'charge','tackle'])].map(id=>[id,skillRestriction(state,u,id)]).filter(([,reason])=>Boolean(reason))),actionHints:actionHints(state,u),targetRestrictions:u.statuses.some(s=>s.id==='taunt')?{taunt:u.statuses.find(s=>s.id==='taunt')!.source}:{}}:{};
 const blockedAttackers=u.cardId==='shark_king'&&u.skills.includes('shark_king_1')&&!u.statuses.some(s=>s.id==='rose_seal')?b?.units.filter(enemy=>enemy.side!==u.side&&(counters['gate:'+enemy.id]??0)<=0).map(enemy=>enemy.id):undefined;
 return {...rest,...restrictions,...(blockedAttackers?{blockedAttackers}:{}),history:safeHistory,lastSkill:own||rest.lastSkill&&visible.has(rest.lastSkill)?rest.lastSkill:null,elements:[...getElements(u)],skills:own?[...skills]:skills.filter(id=>visible.has(id)),talent:own||u.talentRevealed?talent:null,pp:Object.fromEntries(Object.entries(pp).filter(([id])=>own||visible.has(id))),...(own?{allocation}:{}),copied:own?[...copied]:copied.filter(id=>visible.has(id)),disabled:own?[...disabled]:disabled.filter(id=>visible.has(id)),statuses:statuses.map(s=>({...s,source:own?s.source:safeSource(s.source),data:s.data?Object.fromEntries(Object.entries(s.data).filter(([key])=>!['skill','option'].includes(key)||own||s.id==='declaration')):undefined})),modifiers:modifiers.map(m=>({...m,source:own?m.source:safeSource(m.source)})),stageModifiers:stageModifiers.map(m=>({...m,source:own?m.source:safeSource(m.source)})),counters:Object.fromEntries(Object.entries(counters).filter(([k])=>own||publicCounters.includes(k)||k.startsWith('gate:'))),effective:Object.fromEntries((['hp','atk','dfs','sp_atk','sp_dfs','spd'] as Stat[]).map(k=>[k,effective(u,k)])) as PublicUnit['effective'],maxHp:effective(u,'hp')};
}
export function projectRecords(records:Settlement[],side:Side):Settlement[]{return records.map(r=>({...r,order:r.order.filter(a=>r.events.some(e=>e.kind==='action'&&e.actor===a.actor&&e.skill===a.skill)),events:r.events.filter(e=>e.privateSide===undefined||e.privateSide===side).map(e=>({...e}))}));}
function snapshot(b:Battle,side:Side):PlaybackSnapshot{
 const record=b.records.at(-1);
 return {units:b.units.map(u=>projectUnit(u,side,b)),record:record?projectRecords([record],side)[0]:{round:b.round,events:[],order:[]},round:b.round,winner:b.winner};
}
function projectPlayback(r:Room,side:Side):PublicPlayback|undefined{
 const playback=r.playback;if(!playback)return;
 const initial=snapshot(playback.initial,side);
 let previous=initial;
 const frames=playback.frames.map(frame=>{
  const next=snapshot(frame.battle,side),sameRound=next.record.round===previous.record.round;
  const result={units:next.units.filter(u=>JSON.stringify(u)!==JSON.stringify(previous.units.find(p=>p.id===u.id))),events:next.record.events.slice(sameRound?previous.record.events.length:0),completedActions:(next.record.completedActions??[]).filter(id=>!sameRound||!previous.record.completedActions?.includes(id)),order:next.record.order,durationMs:frame.durationMs};
  previous=next;return result;
 });
 // The initial record must belong to this segment, even when the prior round is complete.
 if(frames.length&&initial.record.round!==playback.frames[0].battle.records.at(-1)?.round)initial.record={round:playback.frames[0].battle.records.at(-1)!.round,events:[],order:[]};
 return {id:playback.id,initial,frames,ready:[...playback.ready]};
}
export function projectRoom(r:Room,side:Side,now:number):RoomView{
 return {botSide:r.botSide,declarations:r.phase==='battle'&&r.battleStage==='planning'&&r.declarations?{pending:[...pendingDeclarations(r,0),...pendingDeclarations(r,1)].map(u=>u.id),locked:r.declarations.actions.map(a=>({actor:a.actor,skill:a.skill,...(r.battle!.units.find(u=>u.id===a.actor)!.side===side?{action:structuredClone(a)}:{})})),waiting:waitingForDeclaration(r,side),deadline:planningDeadline(r,side)}:undefined,mode:r.mode,battleStage:r.battleStage,reaction:r.reaction?.side===side?{...r.reaction}:null,turnTimerEnabled:r.turnTimerEnabled,playback:projectPlayback(r,side),id:r.id,name:r.name,players:r.players.map(p=>({...p})),phase:r.phase,side,picks:[[...r.picks[0]],[...r.picks[1]]],draftSide:r.phase==='draft'?(r.draftIndex===0||r.draftIndex===3?r.first:1-r.first) as Side:null,draftRemaining:r.phase==='draft'?(r.draftIndex===1?2:1):0,setupSubmitted:r.loadouts.map(Boolean),submitted:r.actions.map(Boolean),units:r.battle?r.battle.units.map(u=>projectUnit(u,side,r.battle!)):[],round:r.battle?.round??0,winner:r.battle?.winner??null,records:r.battle?projectRecords(r.battle.records,side):[],deadline:r.phase==='finished'&&r.finishedAt!==undefined?r.finishedAt+config.globals.finished_room_seconds*1000:r.deadline,phaseStarted:r.phaseStarted,serverTime:now};
}


