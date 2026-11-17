import rawRules from '../data/skill-rules.json';
import {attackTypeMultiplier,getElements,typeMultiplier} from './primitives';
import type {MatchupUnit} from './primitives';
import type {Action,Channel,DamageRecord,Event,Skill,Unit} from './types';

type Combatant=Pick<Unit,'statuses'|'hp'|'form'|'charged'|'chargeUntil'>&Partial<Pick<Unit,'counters'>>;
type Defender=Pick<Unit,'statuses'|'cardId'|'hp'|'elements'|'elementUntil'|'form'>;
const ruleFor=(s:Skill):Record<string,any>=>(rawRules.rules as Record<string,any>)[s.id]??{};

export type SkillTone=Channel|'support'|'passive';
// Display names depend on the viewer's current combat snapshot; descriptions stay complete.
export function skillDisplayName(s:Skill,a?:Pick<Unit,'cardId'|'form'>&Partial<Pick<Unit,'counters'>>){
 let name=s.name;
 if(a?.cardId==='wuchang'&&s.id.startsWith('wuchang_'))name=name.split('／')[a.form]??name;
 if(a?.cardId==='death_reaper'&&((a.counters?.ghost_next??0)>0||a.counters?.ghost_active))name='幽冥·'+name;
 return name;
}
export function skillPowerLabel(s:Skill){return s.id==='ice_core_4'?'目标冰封层数×40':s.power??'公式';}
export function skillPresentation(s:Skill,a?:Combatant,action?:Pick<Action,'option'>):{tone:SkillTone;label:string}{
 if(s.timing==='passive')return {tone:'passive',label:'被动技能'};
 if(s.kind==='support')return {tone:'support',label:'法术技能'};
 const r=ruleFor(s);
 let channel:Channel=r.channel??s.channel;
 if(a&&(s.id==='wuchang_4'||s.id==='wuchang_5'))channel=a.form===0?'spell':'physical';
 if(a&&r.mechanic==='butterfly_six')channel=a.form===2?'mixed':'physical';
 if(r.chooseChannel&&(a||action))channel=action?.option==='physical'?'physical':'spell';
 if(a?.statuses.some(st=>st.id==='mixed_conversion'))channel='mixed';
 return {tone:channel,label:{physical:'物理攻击',spell:'魔法攻击',mixed:'混伤攻击',fixed:'固定伤害'}[channel]};
}

// Shared by the engine and the selection preview; no random rolls or hidden talents.
export function attackElements(a:Combatant,s:Skill,round:number,override?:string[]){
 let elements=override??s.elements;
 if(s.id==='death_reaper_6'&&((a.counters?.ghost_next??0)>0||a.counters?.ghost_active))elements=['灵'];
 const fire=a.statuses.find(st=>st.id==='fire_next');
 if(fire&&Number(fire.data?.starts)<=round)elements=['火'];
 if(a.statuses.some(st=>st.id==='dragon_dance')&&s.id==='fire_wyvern_4')elements=['火','战斗'];
 if(ruleFor(s).mechanic==='rainbow')elements=[['none'],['水'],['火'],['土'],['风'],['草'],['雷']][Math.floor(a.hp)%7];
 return elements;
}
export function attackTargetMode(a:Combatant,s:Skill,round:number,fallback:string){
 let mode=ruleFor(s).target??fallback;
 if(mode==='form')mode=a.form===2?'all_enemies':'single';
 if(s.id==='wuchang_4'&&a.form===0&&(a.charged||a.chargeUntil>=round))mode='all_enemies';
 if(s.kind==='attack'&&a.statuses.some(st=>st.id==='next_aoe'))mode='all_enemies';
 return mode as string;
}
export function attackPreview(a:Combatant&Partial<Pick<Unit,'id'|'side'>>,t:Defender&Partial<Pick<Unit,'id'|'side'>>,s:Skill,action:Action,round:number,units:MatchupUnit[]=[]){
 const r=ruleFor(s);
 const hitSkill=s.id==='wuchang_4'||s.id==='wuchang_5'?{...s,channel:(a.form===0?'spell':'physical') as Channel,elements:[a.form===0?'灵':'战斗']}:s;
 let channel:Channel=r.chooseChannel?(action.option==='physical'?'physical':'spell'):r.channel??hitSkill.channel;
 if(r.mechanic==='butterfly_six')channel=a.form===2?'mixed':'physical';
 if([...a.statuses,...t.statuses].some(st=>st.id==='mixed_conversion'))channel='mixed';
 const elements=attackElements(a,hitSkill,round,r.chooseElement?[action.element??'水']:undefined);
 const types=a.id!==undefined&&a.side!==undefined&&t.id!==undefined&&t.side!==undefined?attackTypeMultiplier({id:a.id,side:a.side},{...t,id:t.id,side:t.side},elements,units):{...typeMultiplier(elements,getElements(t)),wind:undefined};
 return {elements,channel,applies:channel!=='fixed',...types};
}
export const multiplierLabel=(n:number)=>Number(n.toFixed(3)).toString();
export function damageHighlights(d?:DamageRecord):{tone:string;label:string}[]{
 if(!d)return [];
 if(d.missed)return [{tone:'miss',label:'未命中 / 未生效'}];
 const result:{tone:string;label:string}[]=[];
 if(d.crit)result.push({tone:'critical',label:'✦ 暴击'+((d.critCount??0)>1?' ×'+d.critCount+'次':'')});
 if(d.channel==='fixed')result.push({tone:'neutral',label:'固定伤害 · 无系别倍率'});
 else if(d.typeMultiplier!==1)result.push({tone:d.typeMultiplier>1?'advantage':'resisted',label:(d.typeMultiplier>1?'克制':'弱化')+' ×'+multiplierLabel(d.typeMultiplier)});
 if(d.channel!=='fixed'&&d.clamped)result.push({tone:'neutral',label:'倍率已截断'});
 if(d.shieldAbsorbed>0)result.push({tone:'shield',label:'护盾吸收 '+d.shieldAbsorbed});
 return result;
}
// Keep chronological indices as React keys when prepending newly revealed events.
export function newestEvents(events:Event[]){return events.map((event,index)=>({event,index})).reverse();}
