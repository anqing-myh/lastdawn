import {config,cardOf,stages} from './catalog';
import type {Unit,Stat,Stage,Battle,Loadout,Side} from './types';
export function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n));}
export function iceLayers(u:Pick<Unit,'statuses'>){return u.statuses.filter(st=>st.id==='ice_seal').reduce((n,st)=>n+st.value,0);}
export function stageValue(u:Pick<Unit,'stages'|'stageModifiers'>&Partial<Pick<Unit,'statuses'>>,s:Stage){const iceSlow=s==='spd'?(u.statuses??[]).filter(st=>st.id==='ice_seal'&&!st.data?.ruthless).reduce((n,st)=>n+st.value,0):0;return clamp(u.stages[s]+u.stageModifiers.filter(m=>m.stat===s).reduce((n,m)=>n+m.delta,0)-iceSlow,-6,6);}
export function pointValue(u:Pick<Unit,'base'|'modifiers'>,s:Stat){return Math.max(s==='hp'?1:0,u.base[s]+u.modifiers.filter(m=>m.stat===s).reduce((value,m)=>value+m.delta,0));}
type SpeedUnit=Pick<Unit,'cardId'|'base'|'modifiers'|'stages'|'stageModifiers'|'statuses'|'fragments'|'fragmentMax'|'counters'>;
export function effective(u:SpeedUnit,s:Stat){
 if(s==='hp'&&u.fragments&&u.fragmentMax)return u.fragments.filter(v=>v>0).length*u.fragmentMax||1;
 let value=u.base[s]+u.modifiers.filter(m=>m.stat===s).reduce((a,m)=>a+m.delta,0);
 if(u.cardId==='sword_dance'&&s!=='hp')value+=Math.max(0,u.counters.weapon_count??0)*30;
 if(s!=='hp')value*=Math.pow(1.2,stageValue(u,s));
 if(s==='spd'&&u.statuses.some(st=>st.id==='slow'))value*=1-(u.statuses.find(st=>st.id==='slow')!.value||.3);
 if(s==='spd'&&u.statuses.some(st=>st.id==='paralysis'))value/=1.2;
 return Math.max(s==='hp'?1:0,value);
}
export function has(u:Unit,id:string){return u.statuses.some(s=>s.id===id);}
export function status(u:Unit,id:string){return u.statuses.find(s=>s.id===id);}
export function alive(u:Unit){return u.hp>0&&!u.dead;}
export function getElements(u:Pick<Unit,'elementUntil'|'elements'|'cardId'|'hp'|'form'>){
 if(u.elementUntil!==null)return u.elements;
 const c=cardOf(u.cardId);
 if(c.number===23){return [['灵'],['水'],['火'],['土'],['风'],['草'],['雷']][Math.floor(u.hp)%7];}
 if(c.number===19)return [u.form===0?'灵':'战斗'];
 if(c.number===22)return [['风'],['战斗'],['灵']][u.form];
 return u.elements;
}
export function typeMultiplier(attack:string[],defense:string[]){
 const matrix=config.types.matrix as Record<string,Record<string,number>>;
 const factors=attack.flatMap(a=>defense.map(d=>a==='none'||d==='none'?1:matrix[a][d]));
 const raw=factors.reduce((a,b)=>a*b,1),value=clamp(raw,...config.types.multiplied_result_clamp as [number,number]);
 return {factors,raw,value,clamped:raw!==value};
}
export type MatchupUnit=SpeedUnit&Pick<Unit,'id'|'side'|'skills'|'hp'|'dead'>;
export function attackTypeMultiplier(a:Pick<Unit,'id'|'side'>,t:Pick<Unit,'id'|'side'|'cardId'|'hp'|'elements'|'elementUntil'|'form'>,elements:string[],units:MatchupUnit[]){
 const normal=typeMultiplier(elements,getElements(t)),attacker=units.find(u=>u.id===a.id),target=units.find(u=>u.id===t.id);
 if(a.side===t.side||!attacker||!target)return {...normal,wind:undefined as string|undefined};
 const winds=units.filter(u=>u.cardId==='leviathan'&&u.hp>0&&!u.dead&&u.skills.includes('leviathan_3')&&!u.statuses.some(st=>st.id==='rose_seal')).sort((x,y)=>effective(y,'spd')-effective(x,'spd'));
 for(const wind of winds){
  const incoming=wind.side===t.side,slower=incoming?attacker:target;
  if(effective(slower,'spd')>=effective(wind,'spd'))continue;
  const value=incoming?.6:1.6;
  return {factors:[value],raw:value,value,clamped:false,wind:wind.id};
 }
 return {...normal,wind:undefined as string|undefined};
}
export function critRate(a:Unit,t:Unit,b?:Pick<Battle,'round'|'global'>){const direction=b&&b.global.trick_room_until>=b.round?-1:1;return Math.min(config.crit.max_total_crit_rate,config.crit.base_crit_rate+Math.max(0,(effective(a,'spd')-effective(t,'spd'))*direction)*config.crit.speed_diff_coefficient);}
export function evasionRate(a:Unit,t:Unit){return clamp(config.evasion.base+(effective(a,'spd')-effective(t,'spd'))*config.evasion.speed_coefficient,0,config.evasion.cap);}
export function random(b:Battle){let x=b.seed|0;x^=x<<13;x^=x>>>17;x^=x<<5;b.seed=x>>>0;return b.seed/4294967296;}
export function createUnit(l:Loadout,side:Side,slot:number):Unit{
 const c=cardOf(l.cardId);
 return {id:side+':'+slot,cardId:c.id,side,slot,hp:c.stats.hp,base:{...c.stats},stages:Object.fromEntries(stages.map(s=>[s,0])) as Record<Stage,number>,stageModifiers:[],modifiers:[],elements:[...c.elements],elementUntil:null,form:0,skills:[...l.skills],pp:Object.fromEntries(l.skills.map(id=>[id,c.skills.find(s=>s.id===id)!.pp!])),talent:l.talent,talentRevealed:false,revealed:[],statuses:[],shields:[],counters:{},charged:false,chargeUntil:0,lastSkill:null,lastWasAttack:false,attackedThisRound:false,damagedThisRound:0,damageThisRound:0,aliveRounds:0,history:[],copied:[],disabled:[],dead:false,split:1,allocation:l.allocation??{}};
}
export function availableSkills(u:Unit){return [...u.skills.filter(id=>!u.disabled.includes(id)),...u.copied,'tackle','charge'];}

