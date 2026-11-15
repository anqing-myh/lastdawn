import type {Event,Settlement} from './types';
import {skillMap,talentOf} from './catalog';

// Effect sources include talent IDs and system labels as well as skill IDs.
export function logSourceName(source?:string):string|undefined{
 if(!source)return;
 const skill=skillMap.get(source);if(skill)return skill.name;
 const talent=/^talent_?(\d+)$/.exec(source);
 if(talent)return talentOf(Number(talent[1]))?.name??'特性效果';
 return '战场效果';
}
export interface LogEffect {event:Event;index:number}
export interface LogRecipient {id:string;effects:LogEffect[];latest:number}
export interface LogGroup {id:string;action?:LogEffect;parentId?:string;complete:boolean;recipients:LogRecipient[];latest:number}
// Invocation IDs distinguish repeated and nested uses of the same skill.
export function groupBattleEvents(record:Settlement,settled=false):LogGroup[]{
 const groups=new Map<string,LogGroup>(),completed=new Set(record.completedActions),tagged=record.events.some(e=>e.actionId);
 let legacyId:string|undefined;
 for(const [index,event] of record.events.entries()){
  if(event.kind==='action')legacyId='legacy:'+index;
  const id=event.actionId??(!tagged?legacyId:undefined)??'effect:'+index;
  let group=groups.get(id);
  if(!group){group={id,parentId:event.parentActionId,complete:settled||completed.has(id),recipients:[],latest:index};groups.set(id,group);}
  group.latest=index;
  if(event.kind==='action'){group.action={event,index};continue;}
  if(event.skill&&!group.action)group.action={event,index};
  const recipientId=event.target??event.actor??'battlefield';
  let recipient=group.recipients.find(r=>r.id===recipientId);
  if(!recipient){recipient={id:recipientId,effects:[],latest:index};group.recipients.push(recipient);}
  recipient.effects.unshift({event,index});recipient.latest=index;
 }
 const result=[...groups.values()];
 for(const group of result){
  if(group.id.startsWith('legacy:')&&group!==result.at(-1))group.complete=true;
  group.recipients.sort((a,b)=>b.latest-a.latest);
 }
 return result.sort((a,b)=>b.latest-a.latest);
}
