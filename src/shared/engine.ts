import {cardOf,cards,config,skillOf,stages,talentOf,exclusiveTalentId} from './catalog';
import rawRules from '../data/skill-rules.json';
import {attackElements,attackTargetMode,multiplierLabel,skillDisplayName} from './combat-presentation';
import {alive,attackTypeMultiplier,availableSkills,clamp,createUnit,critRate,effective,evasionRate,getElements,has,iceLayers,pointValue,random,stageValue,status,typeMultiplier} from './primitives';
import type {Action,Battle,Channel,DamageRecord,Event,Loadout,Settlement,Side,Skill,Stage,Stat,Unit,ReactionRequest,ReactionDecision,ExtraActionRequest} from './types';
type Rule=Record<string,any>;
export const rules=rawRules.rules as Record<string,Rule>;
const runtime=rawRules.runtime;
const enemy=(b:Battle,u:Unit)=>b.units.filter(t=>t.side!==u.side&&alive(t));
const team=(b:Battle,u:Unit)=>b.units.filter(t=>t.side===u.side&&alive(t));
/** Statuses whose next action is already known to be impossible during planning. */
export function preplannedUnable(u:Unit,round:number){
 return u.statuses.some(s=>(s.id==='hell_stun'||s.id==='freeze')&&Number(s.data?.starts??0)<=round);
}
const cardNo=(u:Unit)=>cardOf(u.cardId).number;
const debuffCount=(u:Unit)=>stages.reduce((n,s)=>n+Math.max(0,-stageValue(u,s)),0);
const buffCount=(u:Unit)=>stages.reduce((n,s)=>n+Math.max(0,stageValue(u,s)),0);
const maximum=(u:Unit)=>effective(u,'hp');
const hasPassive=(u:Unit,i:number)=>!has(u,'rose_seal')&&(u.skills.includes(u.cardId+'_'+i)||u.cardId==='death_reaper'&&i===1);
export interface RoundOptions { interactive?:boolean; decisions?:Record<string,ReactionDecision>; onFrame?:(battle:Battle,event?:Event)=>void }
interface RoundRuntime { options:RoundOptions; reactionIndex:number }
const roundRuntimes=new WeakMap<Battle,RoundRuntime>();
const recordBattles=new WeakMap<Settlement,Battle>();
const actionContexts=new WeakMap<Settlement,{id:string;parentId?:string}>();
const actionSequences=new WeakMap<Settlement,number>();
const elementalistUses=new WeakMap<Settlement,Set<string>>();
const attackSequences=new WeakMap<Settlement,number>();
const attackTriggers=new WeakMap<Settlement,Set<string>>();
function newAttackId(rec:Settlement){const n=(attackSequences.get(rec)??0)+1;attackSequences.set(rec,n);return 'attack:'+n;}
function triggerOnce(rec:Settlement,attackId:string,effect:string,target:string){
 let used=attackTriggers.get(rec);if(!used){used=new Set();attackTriggers.set(rec,used);}
 const key=attackId+':'+effect+':'+target;if(used.has(key))return false;used.add(key);return true;
}
function checkpoint(b:Battle,rec:Settlement):Battle{const {plannedActions,...rest}=b;return {...rest,mentalMarks:b.mentalMarks?structuredClone(b.mentalMarks):undefined,units:structuredClone(b.units),global:{...b.global},records:[...b.records,structuredClone(rec)]};}
export class ReactionRequired extends Error { constructor(public request:ReactionRequest,public battle:Battle){super('等待玩家回合中响应');} }
function emit(rec:Settlement,e:Event){
 if(rec.events.length>=runtime.maxEvents)throw Error('连锁事件超过安全上限');
 const context=actionContexts.get(rec);if(context){e.actionId=context.id;if(context.parentId)e.parentActionId=context.parentId;}
 const b=recordBattles.get(rec),rt=b&&roundRuntimes.get(b);
 if(e.skill&&/^(wuchang|death_reaper)_/.test(e.skill)){const owner=b?.units.find(u=>u.id===(e.actor??(e.kind==='revive'?e.target:undefined)));if(owner)e.skillName=skillDisplayName(skillOf(e.skill),owner);}
 rec.events.push(e);
 if(b&&rt?.options.onFrame)rt.options.onFrame(checkpoint(b,rec),e);
}
function notice(rec:Settlement,u:Unit,text:string){emit(rec,{kind:'notice',actor:u.id,text});}
function revealSkill(u:Unit,id:string){if(!u.revealed.includes(id))u.revealed.push(id);}
function passive(rec:Settlement,u:Unit,i:number,text:string){const id=u.cardId+'_'+i;revealSkill(u,id);emit(rec,{kind:'passive',actor:u.id,skill:id,text});}
function talent(rec:Settlement,u:Unit,id:number,text:string){if(u.talent!==id||has(u,'rose_seal'))return false;u.talentRevealed=true;emit(rec,{kind:'talent',actor:u.id,text:talentOf(id)!.name+'：'+text});return true;}
function activeTalent(u:Unit,id:number){return u.talent===id&&!has(u,'rose_seal');}
function applyStatus(b:Battle,rec:Settlement,t:Unit,id:string,duration:number|null,value=0,source='',debuff=false,data?:Record<string,unknown>){
 if(has(t,'calamity_immunity')){notice(rec,t,'玄宇宙：免疫「'+statusLabel(id)+'」效果');return;}
 if(debuff&&(has(t,'control_immune')||has(t,'flower_self')||has(t,'death_fake_immune')||activeTalent(t,11))){if(activeTalent(t,11))talent(rec,t,11,'免疫异常效果');else notice(rec,t,'免疫异常效果');return;}
 if(debuff&&cardNo(t)===22&&t.form===0){exclusive(rec,t,'平静相免疫削弱');return;}
 const until=duration===null?null:b.round+duration-1;
 const old=status(t,id);
 if(old){old.until=old.until===null||until===null?null:Math.max(old.until,until);old.value=value;old.source=source;old.data=data;}
 else t.statuses.push({id,source,until,debuff,value,data});
 emit(rec,{kind:'status',target:t.id,text:(debuff?'受到':'获得')+'「'+statusLabel(id)+'」'+(duration?' · '+duration+'回合':''),value});
}
export const statusLabels:Record<string,string>={wet:'潮湿',slow:'迟缓',illusion:'迷幻',madness:'疯狂',fear:'恐惧',poison:'剧毒',stun:'眩晕',paralysis:'麻痹',heartache:'钻心',recoil:'反伤',encore:'再来一次',corrosion:'腐蚀',freeze:'冰冻',magnetized:'磁化',butterfly:'返魂蝶',spell_null:'法术失效',rose_seal:'迷魂',lost_soul:'失魂',lost_spirit:'落魄',stiff:'僵硬',soul_paralysis:'魂麻痹',mixed_conversion:'混伤转换',single_immunity:'黑暗天幕',space_rift:'空间撕裂',tiger_finale:'风起白虎潭',dormant:'蛰伏',forest_domain:'森罗万象域',evasion:'闪烁',reflect:'誓言之魂',slime_redirect:'明胶水晶之躯',hundred_rounding:'魔族本源',fire_next:'火系改写',taunt:'嘲讽',power_down:'威力削弱',next_power_down:'下次威力削弱',divine_descent:'神降术',lifesteal:'吸血',defer_next:'下合后发',dragon_dance:'龙翼舞',shark_blade:'驭鲨冲击',water_spirit:'水之灵',silent_water:'沉默之水',holy_blessing:'圣灵祝福',low_pressure:'低气压',rising_air:'上升气流',sacred:'神圣',flower_self:'花间序',evil_system:'恶念系统',high_frequency:'高周波武装',counter:'四象反击',declaration:'提前声明',sealed:'封印',control_immune:'免控',next_first:'下合先发',tornado_target:'龙卷阵',reduction:'免伤',next_aoe:'下次群攻',next_block:'伤害减免',delayed_attack:'延迟攻击'};
Object.assign(statusLabels,{critical_wind:'暴击率提升',target_swap:'攻击目标转移',butterfly_swap:'返魂蝶换位',flower_drain:'花间序吸取',silver_physical:'银龙物理伤害削弱',silver_spell:'银龙法术伤害削弱',replace_at_end:'回合末替换技能'});
export const statusLabel=(id:string)=>statusLabels[id]??id;
Object.assign(statusLabels,{ice_seal:'冰封',ice_ruthless:'算式·无情',frostbite:'冻伤',hell_guidance:'精确制导',hell_fire_hit:'火系连击',hell_fire_bonus:'火系伤害增益',hell_stun:'火流星反噬',death_energy:'死气',death_fake:'假死',death_fake_immune:'假死免疫',death_despair:'绝望',calamity_immunity:'灾劫庇护',calamity_cap:'灵魂震颤',weapon:'武器',weapon_black_shield:'黑盾'});
Object.assign(statusLabels,{calamity_prophecy:'末日预言',calamity_pact:'算式·契约',evil_system:'算式·恶念',high_frequency:'指令·雷心'});
function exclusive(rec:Settlement,u:Unit,text:string){u.counters.exclusive_revealed=1;emit(rec,{kind:'talent',actor:u.id,text:'三相之身：'+text});}
function addIce(b:Battle,rec:Settlement,u:Unit,count:number,source:string){
 const value=iceLayers(u)+count,ruthless=Boolean(b.global.ice_ruthless||b.units.some(x=>has(x,'ice_ruthless')));
 u.statuses=u.statuses.filter(st=>st.id!=='ice_seal');
 u.statuses.push({id:'ice_seal',source,until:b.round+(ruthless?2:1),debuff:false,value,data:{ruthless}});
 const total=iceLayers(u);u.counters['冰封']=total;emit(rec,{kind:'status',target:u.id,skill:source,text:'获得「冰封」×'+count+'（当前 '+total+' 层）',value:count});
 if(u.cardId==='ice_core'&&total>=5)removeIce(b,rec,u,total,'达到5层自动移除');
}
function removeIce(b:Battle,rec:Settlement,u:Unit,count:number,reason:string){
 const total=iceLayers(u),removed=Math.min(total,count);if(!removed)return 0;
 const layers=u.statuses.filter(st=>st.id==='ice_seal'),remaining=total-removed;
 u.statuses=u.statuses.filter(st=>st.id!=='ice_seal');
 if(remaining)u.statuses.push({...layers[0],value:remaining});u.counters['冰封']=remaining;
 emit(rec,{kind:'status',target:u.id,text:'「冰封」移除 '+removed+' 层（'+reason+'）',value:-removed});
 if(u.cardId==='ice_core')heal(b,rec,u,(maximum(u)-u.hp)*.08*removed,'指令·冰封');
 return removed;
}
function finishIceAge(b:Battle,rec:Settlement,a:Unit,source:string){
 for(const u of b.units){const n=iceLayers(u);if(!n)continue;removeIce(b,rec,u,n,'冰河时代');if(u.id===a.id||!alive(u))continue;
  const existing=status(u,'frostbite');applyStatus(b,rec,u,'frostbite',n+1,0,a.id,true,{starts:b.round+1});
  const frost=status(u,'frostbite');if(!frost)continue;
  const stageSource='frostbite:'+u.id;
  if(!existing)modifyStage(b,rec,u,{atk:-1,sp_atk:-1,spd:-2},stageSource,n+1);
  else for(const m of u.stageModifiers.filter(m=>m.source===stageSource))m.until=frost.until;
 }
}
const weaponLabels:Record<string,string>={moon_blade:'削月刀',flying_axe:'飞斧',absorb_shield:'吸收盾',black_shield:'黑盾',eternal_spear:'永恒之枪',victory_sword:'胜利之剑'};
function weaponCount(u:Unit){return Math.max(0,u.counters.weapon_count??0);}
function addWeapon(b:Battle,rec:Settlement,u:Unit,key:string){
 if(weaponCount(u)>=runtime.weaponLimit){notice(rec,u,'武器数量已达上限'+runtime.weaponLimit+'件，无法继续获得');return;}
 u.counters['weapon:'+key]=(u.counters['weapon:'+key]??0)+1;u.counters.weapon_count=weaponCount(u)+1;
 u.counters.weapon_serial=(u.counters.weapon_serial??0)+1;const source='weapon#'+u.counters.weapon_serial;u.statuses.push({id:'weapon',source,until:null,debuff:false,value:1,data:{key}});
 emit(rec,{kind:'status',target:u.id,text:'获得武器「'+weaponLabels[key]+'」',value:1});
 if(key==='absorb_shield')u.shields.push({id:'sword_dance:absorb_shield:'+u.counters['weapon:'+key],type:'spell',value:100});
}
function removeWeapon(b:Battle,rec:Settlement,u:Unit,key:string,reason:string){
 const count=u.counters['weapon:'+key]??0;if(count<=0)return false;
 u.counters['weapon:'+key]=count-1;u.counters.weapon_count=Math.max(0,weaponCount(u)-1);
 const marker=u.statuses.find(s=>s.id==='weapon'&&s.data?.key===key);if(marker)u.statuses=u.statuses.filter(s=>s!==marker);
 if(key==='absorb_shield'){const shield=u.shields.find(s=>s.id.startsWith('sword_dance:absorb_shield:'));if(shield)u.shields=u.shields.filter(s=>s!==shield);}
 emit(rec,{kind:'status',target:u.id,text:'失去武器「'+weaponLabels[key]+'」（'+reason+'）',value:-1});
 if(key==='flying_axe')for(const target of enemy(b,u))damage(b,rec,u,target,skillOf('sword_dance_1'),{channel:'physical',power:100,target:'all_enemies'},{elements:['战斗'],channel:'physical',depth:1});
 return true;
}
interface ActionPpCost { amount:number; disasters:number }
function triggerDisaster(b:Battle,rec:Settlement,owner:Unit,actor:Unit,skillId:string,chance:number,cost:ActionPpCost){
 if(random(b)>=chance)return true;
 const skill=skillOf(skillId),remaining=actor.pp[skillId]??skill.pp??-1;
 if(remaining<0){emit(rec,{kind:'status',actor:owner.id,target:actor.id,skill:skillId,text:'触发「灾厄」：「'+skill.name+'」为无限PP技能，无需额外扣除，正常发动'});return true;}
 cost.amount=Math.max(2,cost.amount+1);cost.disasters++;
 if(remaining+(actor.counters.omni_pp??0)>=cost.amount){emit(rec,{kind:'status',actor:owner.id,target:actor.id,skill:skillId,text:'触发「灾厄」：'+cardOf(actor.cardId).name+' 的「'+skill.name+'」本次共需消耗'+cost.amount+' PP，全部判定通过后统一扣除'});return true;}
 emit(rec,{kind:'status',actor:owner.id,target:actor.id,skill:skillId,text:'触发「灾厄」：本次需要'+cost.amount+' PP，可用PP不足，技能发动失败，不消耗任何PP，并失去10%最大生命'});
 directLoss(b,rec,actor,maximum(actor)*.1,'灾厄');return false;
}
function modifyStage(b:Battle,rec:Settlement,u:Unit,changes:Partial<Record<Stage,number>>,source:string,duration:number|null=null){
 if(has(u,'calamity_immunity')){notice(rec,u,'玄宇宙：免疫属性等级变化');return;}
 for(const [s,n] of Object.entries(changes) as [Stage,number][]){
  if(!n)continue;
  let delta=n;
  if(delta<0&&cardNo(u)===22&&u.form===0){exclusive(rec,u,'属性不可削弱');continue;}
  if(delta>0&&has(u,'stiff'))continue;
  const old=stageValue(u,s),next=clamp(old+delta,runtime.stageMin,runtime.stageMax),actual=next-old;
  if(!actual)continue;
  if(duration!==null)u.stageModifiers.push({stat:s,delta:actual,until:b.round+duration-1,source});else{let remaining=actual;if(remaining<0){for(const m of u.stageModifiers.filter(m=>m.stat===s&&m.delta>0)){const used=Math.min(m.delta,-remaining);m.delta-=used;remaining+=used;if(!remaining)break;}}else if(remaining>0){for(const m of u.stageModifiers.filter(m=>m.stat===s&&m.delta<0)){const used=Math.min(-m.delta,remaining);m.delta+=used;remaining-=used;if(!remaining)break;}}u.stageModifiers=u.stageModifiers.filter(m=>m.delta!==0);u.stages[s]=clamp(u.stages[s]+remaining,-6,6);}
  emit(rec,{kind:'stage',target:u.id,skill:source,text:s+' '+(actual>0?'+':'')+actual+'级',value:actual});
  if(has(u,'heartache'))directLoss(b,rec,u,maximum(u)*status(u,'heartache')!.value,'钻心',false);
  if(actual<0&&s!=='crit'&&activeTalent(u,10)){talent(rec,u,10,'削弱属性后暴击 +1级');u.stages.crit=clamp(u.stages.crit+1,-6,6);}
 }
}
function flat(b:Battle,rec:Settlement,u:Unit,changes:Partial<Record<Stat,number>>,source:string,duration:number|null=null){
 if(has(u,'calamity_immunity')){notice(rec,u,'玄宇宙：免疫属性点数变化');return;}
 for(const [s,n] of Object.entries(changes) as [Stat,number][]){
  if(n<0&&cardNo(u)===22&&u.form===0){exclusive(rec,u,'属性数值不可削弱');continue;}
  if(n>0&&has(u,'stiff'))continue;
  u.modifiers.push({stat:s,delta:n,until:duration===null?null:b.round+duration-1,source});
  u.hp=Math.min(u.hp,maximum(u));emit(rec,{kind:'point',target:u.id,skill:source,text:s+' '+(n>0?'+':'')+Math.floor(n),value:n});
 }
}
function cleanse(u:Unit,all=false){u.statuses=u.statuses.filter(s=>!s.debuff);u.stageModifiers=u.stageModifiers.filter(s=>all?false:s.delta>=0);for(const s of stages)if(all||u.stages[s]<0)u.stages[s]=0;}
function heal(b:Battle,rec:Settlement,u:Unit,n:number,reason:string,share=true){
 if(!alive(u)||has(u,'stiff'))return;
 if(has(u,'madness')){directLoss(b,rec,u,n,'疯狂：回复转为伤害',false);return;}
 const amount=Math.max(0,Math.min(Math.floor(n),maximum(u)-u.hp));u.hp+=amount;
 if(u.fragments){let remaining=amount;for(let i=0;i<u.fragments.length;i++)if(u.fragments[i]>0){const v=Math.min(remaining,(u.fragmentMax??0)-u.fragments[i]);u.fragments[i]+=v;remaining-=v;}}
 if(amount){emit(rec,{kind:'heal',target:u.id,text:reason+' · 回复 '+amount,value:amount});if(share&&activeTalent(u,12)){talent(rec,u,12,'同步队友回复');for(const t of team(b,u).filter(t=>t.id!==u.id))heal(b,rec,t,amount,'古渊露华',false);}}
}
function directLoss(b:Battle,rec:Settlement,u:Unit,n:number,reason:string,damage=true){
 if(!alive(u))return 0;
 const amount=Math.min(u.hp,Math.max(0,Math.floor(n)));u.hp-=amount;
 if(u.fragments){let remaining=amount;for(let i=0;i<u.fragments.length;i++){const v=Math.min(remaining,u.fragments[i]);u.fragments[i]-=v;remaining-=v;}u.split=u.fragments.filter(v=>v>0).length;}
 if(damage)u.damagedThisRound+=amount;
 emit(rec,{kind:'damage',target:u.id,text:cardOf(u.cardId).name+' 因「'+reason+'」失去 '+amount+' 点生命',value:amount});
 checkDeath(b,rec,u);return amount;
}
function setForm(b:Battle,rec:Settlement,u:Unit,f:number){u.form=f;u.base={...cardOf(u.cardId).forms[f]};u.hp=Math.min(u.hp,maximum(u));u.elements=cardNo(u)===19?[f===0?'灵':'战斗']:[['风'],['战斗'],['灵']][f];u.elementUntil=null;notice(rec,u,'切换形态：'+(cardNo(u)===19?['白魂','黑魂'][f]:['平静相','般若相','神圣相'][f]));}
function checkDeath(b:Battle,rec:Settlement,u:Unit){
 if(u.hp>0||u.dead||u.counters.death_processing)return;
 u.counters.death_processing=1;
 if(has(u,'tiger_finale')){u.counters.death_processing=0;u.hp=maximum(u);u.stages=Object.fromEntries(stages.map(s=>[s,0])) as Unit['stages'];u.stageModifiers=[];u.statuses=[];for(const id of u.skills)if(id!=='white_tiger_6')u.pp[id]=skillOf(id).pp!;b.endedRound=true;emit(rec,{kind:'revive',target:u.id,text:'风起白虎潭：满血复活，重置等级、异常与其他技能PP，本技能PP不恢复，终止当回合行动'});return;}
 if(hasPassive(u,2)&&cardNo(u)===14&&random(b)<rules.vermilion_2.chance){u.counters.death_processing=0;passive(rec,u,2,'凤凰涅槃');u.hp=Math.max(1,Math.floor(maximum(u)*rules.vermilion_2.heal));cleanse(u);emit(rec,{kind:'revive',target:u.id,text:'凤凰涅槃：以30%最大生命复活'});return;}
 if(u.cardId==='death_reaper'&&hasPassive(u,1)&&(u.counters.death_reaper_ready??0)<=b.round){const ghost=(u.counters.ghost_next??0)>0||Boolean(u.counters.ghost_active);u.counters.death_processing=0;u.hp=ghost?rules.death_reaper_1.ghostHp:1;u.counters.death_reaper_ready=b.round+rules.death_reaper_1.cooldown;emit(rec,{kind:'revive',target:u.id,skill:'death_reaper_1',text:(ghost?'幽冥·':'')+'鬼墨无忧：受到致命伤害，生命保留为 '+u.hp+'；'+(ghost?'不消耗幽冥次数；':'')+'下次可触发于第'+u.counters.death_reaper_ready+'回合'});return;}
 for(const core of b.units.filter(x=>x.cardId==='calamity_core'&&alive(x)&&hasPassive(x,1))){
  if(has(core,'calamity_prophecy'))flat(b,rec,core,{atk:u.base.atk*rules.calamity_core_3.deathStatRatio,dfs:u.base.dfs*rules.calamity_core_3.deathStatRatio,sp_atk:u.base.sp_atk*rules.calamity_core_3.deathStatRatio,sp_dfs:u.base.sp_dfs*rules.calamity_core_3.deathStatRatio,spd:u.base.spd*rules.calamity_core_3.deathStatRatio},'calamity_core_3');
  const pact=status(core,'calamity_pact'),partner=pact&&b.units.find(x=>x.id===pact.data?.partner);
  if(partner&&alive(partner)){partner.counters.omni_pp=(partner.counters.omni_pp??0)+Object.values(u.pp).reduce((n,v)=>n+Math.max(0,v),0);notice(rec,partner,'算式·契约：获得 '+partner.counters.omni_pp+' 点全能PP');if(partner.cardId.endsWith('_core'))partner.counters.core_disaster=1;}
 }
 if(cardOf(u.cardId).elements.includes('火')&&!u.counters.hell_explosion_triggered){
  const hell=b.units.find(x=>x.side===u.side&&x.cardId==='hell_core'&&hasPassive(x,6)&&alive(x));
  const fireSkills=cardOf(u.cardId).skills.filter(s=>s.kind==='attack'&&s.elements.includes('火'));
  if(hell&&fireSkills.length){u.counters.hell_explosion_triggered=1;const s=fireSkills[Math.floor(random(b)*fireSkills.length)],r=rules[s.id]??{},targets=s.target==='all_enemies'?enemy(b,u):[enemy(b,u)[Math.floor(random(b)*Math.max(1,enemy(b,u).length))]].filter(Boolean);passive(rec,hell,6,'算式·殉爆：'+cardOf(u.cardId).name+' 即将倒下，触发 '+skillDisplayName(s,u));for(const t of targets)damage(b,rec,u,t,s,r,{multiplier:1+rules.hell_core_6.bonusMultiplier,depth:1});}
 }
 if(u.cardId==='sword_dance')for(const ally of b.units)ally.stageModifiers=ally.stageModifiers.filter(m=>m.source!=='sword_dance_6:'+u.id);
 u.dead=true;emit(rec,{kind:'death',target:u.id,text:cardOf(u.cardId).name+' 倒下'});
 const summoner=b.units.find(t=>t.side===u.side&&alive(t)&&cardNo(t)===9&&hasPassive(t,2));
 if(summoner&&!u.counters.soul_returned){u.counters.soul_returned=1;passive(rec,summoner,2,'摄魂术：队友立即行动2次后消散');u.dead=false;u.hp=1;for(let i=0;i<2&&!b.endedRound;i++){u.hp=Math.max(1,u.hp);u.dead=false;extraAction(b,rec,u,'summoner_2',b.plannedActions??[],1);}u.hp=0;u.dead=true;emit(rec,{kind:'death',target:u.id,text:cardOf(u.cardId).name+' 的摄魂术额外行动结束，消散'});}
}
export function validateLoadouts(loadouts:Loadout[],picks:string[],mode:'quick'|'duel'='duel'){
 if(!Array.isArray(loadouts)||loadouts.length!==2)throw Error('每方需要配置两名角色');
 if(new Set(loadouts.map(l=>l.cardId)).size!==2||loadouts.some(l=>!picks.includes(l.cardId)))throw Error('角色与轮选不符');
 for(const l of loadouts){const c=cardOf(l.cardId);const expectedSkills=mode==='quick'?c.skills.map(s=>s.id):null;if(!Array.isArray(l.skills)||l.skills.length!==(mode==='quick'?6:4)||new Set(l.skills).size!==l.skills.length||l.skills.some(id=>!c.skills.some(s=>s.id===id))||(expectedSkills&&expectedSkills.some(id=>!l.skills.includes(id))))throw Error(mode==='quick'?'快速模式必须携带全部六个技能':'必须从六个技能中选四个');
 for(const id of l.skills)if(rules[id]?.unavailable)throw Error(skillOf(id).name+'：'+rules[id].unavailable);
 const lockedTalent=exclusiveTalentId(c);
 if(lockedTalent!==null){if(l.talent!==lockedTalent)throw Error(c.name+'必须携带锁定专属特性');continue;}
 if(mode==='quick'){if(l.talent!==0)throw Error('快速模式不携带通用特性');continue;}
 const t=talentOf(l.talent);if(!t||!t.available||t.exclusive)throw Error('请选择通用天赋');
 if(l.talent===6){const a=l.allocation??{atk:100,sp_atk:100,spd:100};const entries=Object.entries(a);if(entries.some(([k,v])=>!['hp','atk','dfs','sp_atk','sp_dfs','spd'].includes(k)||!Number.isInteger(v)||v!<0||v!>150)||entries.reduce((n,[,v])=>n+v!,0)!==300)throw Error('远古遗赠需分配300点，每项至多150');l.allocation=a;}
 }
}
export function createBattle(loadouts:[Loadout[],Loadout[]],seed:number):Battle{
 const b:Battle={round:1,units:loadouts.flatMap((ls,s)=>ls.map((l,i)=>createUnit(l,s as Side,i))),seed:seed||1,winner:null,records:[],global:{},endedRound:false};
 const rec:Settlement={round:0,events:[],order:[]};
 for(const u of b.units){if(u.talent===6){for(const [s,n] of Object.entries(u.allocation))flat(b,rec,u,{[s]:n!*(s==='hp'?2:1)},'talent_6');u.hp=maximum(u);talent(rec,u,6,'开局属性分配已公开');}
 if(u.talent===11){flat(b,rec,u,{sp_dfs:120},'talent_11');talent(rec,u,11,'抗性 +120');}
 if(u.talent===10){modifyStage(b,rec,u,{crit:1},'talent_10');talent(rec,u,10,'初始暴击 +1级');}}
 b.records.push(rec);return b;
}
function shieldAdd(b:Battle,rec:Settlement,u:Unit,r:Rule,source:string){
 const sh=r.shield;const value=Math.floor((sh.base??0)+(sh.atkRatio??0)*effective(u,'atk')+(sh.selfAtkRatio??0)*effective(u,'atk'));
 for(let layer=0;layer<(sh.layers??1);layer++)u.shields.push({id:source+':'+b.round+':'+u.shields.length,type:sh.type,value,linked:r.linked?source:undefined,breakStage:r.breakStage});emit(rec,{kind:'shield',target:u.id,text:'获得 '+(sh.layers?sh.layers+'层各':'')+value+' '+(sh.type==='spell'?'法术':'物理')+'护盾',value});
}
function resolveWinner(b:Battle){const a=b.units.some(u=>u.side===0&&alive(u)),c=b.units.some(u=>u.side===1&&alive(u));b.winner=!a&&!c?'draw':!a?1:!c?0:null;}
function calculatedDefense(u:Unit,s:Stat,penetration=0){
 if(s!=='dfs'&&s!=='sp_dfs')return penetration?Math.max(1,pointValue(u,s)-penetration)*Math.pow(1.2,stageValue(u,s as Stage)):effective(u,s);
 const base=u.base[s]+u.modifiers.filter(m=>m.stat===s).reduce((n,m)=>n+m.delta,0);
 return Math.max(1,Math.max(config.damage.min_defense_value,base)-penetration)*Math.pow(1.2,stageValue(u,s));
}
function allUsableSkillsExhausted(u:Unit){
 const skills=availableSkills(u).filter(id=>id!=='tackle'&&id!=='charge').map(skillOf).filter(s=>s.timing!=='passive');
 if((u.counters.omni_pp??0)>0&&skills.some(s=>s.pp!==-1))return false;
 return skills.every(s=>(u.pp[s.id]??s.pp??-1)===0);
}
function allLivingSkillsExhausted(b:Battle){
 const living=b.units.filter(alive);
 return living.length>0&&living.every(allUsableSkillsExhausted);
}
interface NextAttackEffects { dormant?:number; powerDown?:number }
function consumeNextAttack(u:Unit):NextAttackEffects {
 const effects={dormant:status(u,'dormant')?.value,powerDown:status(u,'next_power_down')?.value};
 u.statuses=u.statuses.filter(st=>!['dormant','next_power_down'].includes(st.id));
 return effects;
}
interface HitOptions {power?:number;fixed?:number;fixedFinal?:number;channel?:Channel;multiplier?:number;elements?:string[];reaction?:boolean;noEffects?:boolean;depth?:number;fragment?:number;nextAttack?:NextAttackEffects;speedBonus?:number;attackId?:string}
function damage(b:Battle,rec:Settlement,a:Unit,t:Unit,s:Skill,r:Rule,opt:HitOptions={}):DamageRecord{
 const depth=opt.depth??0,attackId=opt.attackId??newAttackId(rec);
 const nextAttack=opt.nextAttack??(s.kind==='attack'&&r.isAttack!==false?consumeNextAttack(a):{});
 let channel:Channel=has(a,'mixed_conversion')||has(t,'mixed_conversion')?'mixed':opt.channel??r.channel??s.channel;
 if(t.cardId==='death_reaper'&&(channel==='physical'||channel==='mixed'))channel='spell';
 let power=opt.power??s.power??0,fixed=opt.fixed??0,fixedFinal=opt.fixedFinal??0;
 let attack=channel==='spell'?effective(a,'sp_atk'):effective(a,'atk');
 let basis=r.defenseBasis??(channel==='spell'?'sp_dfs':'dfs');
 let defense=basis==='minimum'?Math.min(...(['atk','dfs','sp_atk','sp_dfs','spd'] as Stat[]).map(k=>calculatedDefense(t,k))):calculatedDefense(t,basis as Stat);
 let pen=r.penetration??0;
 if(r.powerTargetDfs)power=calculatedDefense(t,'dfs')*r.powerTargetDfs;
 if(r.powerSelfDfs)power=calculatedDefense(a,'dfs')*r.powerSelfDfs;
 if(r.powerSelfDefenses)power=(calculatedDefense(a,'dfs')+calculatedDefense(a,'sp_dfs'))*r.powerSelfDefenses;
 if(r.powerMissingSelf)power+=(maximum(a)-a.hp)*r.powerMissingSelf;
 if(r.powerPerStage)power+=buffCount(r.resetStages?a:t)*r.powerPerStage;
 if(r.powerPerDebuff)power+=debuffCount(t)*r.powerPerDebuff;
 if(r.usagePower)power+=(a.counters['uses:'+s.id]??0)*r.usagePower;
 if(r.powerRoundMultiplier)power+=b.round*r.powerRoundMultiplier;
 if(team(b,a).some(u=>u.cardId==='sword_dance'&&(u.counters['weapon:victory_sword']??0)>0)&&channel==='physical'&&stageValue(t,'dfs')<=stageValue(a,'dfs'))power+=40;
 if(r.powerCounter)power+=(a.counters[r.powerCounter]??0)*r.powerPerCounter;
 if(r.speedStep)power+=Math.max(0,Math.floor((effective(a,'spd')-r.speedThreshold)/r.speedStep))*r.powerStep;
 const ghostScythePower=s.id==='death_reaper_6'&&a.counters.ghost_active?(t.counters.death_energy??0)*rules.death_reaper_6.ghostEnergyRatio:0;
 power+=ghostScythePower;
 if(r.fixedMissingSelf)fixed+=(maximum(a)-a.hp)*r.fixedMissingSelf;
 if(r.fixedTargetMax)fixed+=maximum(t)*r.fixedTargetMax;
 if(r.fixedTargetRoundDamage)fixed+=t.damagedThisRound*r.fixedTargetRoundDamage;
 if(r.fixedTargetSpeed&&a.hp/maximum(a)<=r.firstBelow)fixed+=effective(t,'spd')*r.fixedTargetSpeed;
 if(r.fixedDifference)fixed+=Math.max(0,(effective(a,'atk')-calculatedDefense(t,'dfs'))*r.fixedDifference);
 if(r.mechanic==='attack_fixed')fixed+=effective(a,'atk')*r.ratio;
 if(r.mechanic==='tail_sweep')fixed+=Math.min(r.cap,(a.counters.tail_fixed??0)*r.ratio);
 if(has(a,'space_rift')&&(status(a,'space_rift')!.data?.round as number)<b.round)fixed+=(maximum(t)-t.hp)*rules.black_dragon_6.fixedMissingTarget;
 if(has(a,'power_down'))power-=status(a,'power_down')!.value;
 if(nextAttack.powerDown)power-=nextAttack.powerDown;
 if(has(a,'soul_paralysis'))power-=status(a,'soul_paralysis')!.value;
 if(has(a,'butterfly')&&status(a,'butterfly')!.source===t.id)power+=rules.red_butterfly_1.value;
 if(has(t,'butterfly')&&status(t,'butterfly')!.source===a.id)power+=rules.red_butterfly_1.value;
 if(has(a,'shark_blade')&&s.id==='shark_king_6')power+=status(a,'shark_blade')!.value;
 const charged=a.charged||a.chargeUntil>=b.round;
 if(charged)power*=runtime.chargeMultiplier;
 power=Math.max(0,power);
 const es=attackElements(a,s,b.round,opt.elements);
 const types=attackTypeMultiplier(a,t,es,b.units);
 if(types.wind&&channel!=='fixed'){const wind=b.units.find(u=>u.id===types.wind)!;passive(rec,wind,3,'领风者：本次攻击的系别倍率视为'+(types.value>1?'克制 ×1.6':'弱化 ×0.6'));}
 if(r.mechanic==='critical_wind')applyStatus(b,rec,a,'critical_wind',r.duration,Math.max(0,stageValue(a,'crit'))*r.perStage,s.id);
 let rate=critRate(a,t,b)+(r.critBonus??0)+(activeTalent(a,1)?a.counters.crit_bonus??0:0);
 if(r.doubleBaseCrit)rate+=config.crit.base_crit_rate;
 if(hasPassive(a,1)&&cardNo(a)===3){passive(rec,a,1,'万王之荣耀：暴击率提高');rate+=rules.sacred_kirin_1.critBonus;}
 if(has(a,'critical_wind'))rate+=status(a,'critical_wind')!.value;
 rate=clamp(rate,0,1);
 let critCount=0;for(let i=0;i<(r.critRolls??1);i++)if(channel!=='fixed'&&random(b)<rate)critCount++;const crit=critCount>0;
 if(crit&&r.critPenetration)pen+=r.critPenetration;
 if(pen)defense=basis==='minimum'?Math.min(...(['atk','dfs','sp_atk','sp_dfs','spd'] as Stat[]).map(k=>calculatedDefense(t,k,pen))):calculatedDefense(t,basis as Stat,pen);
 if(critCount>1)notice(rec,a,'本次独立暴击判定成功 '+critCount+' 次');
 if(activeTalent(a,4)&&['physical','mixed'].includes(channel)){attack+=(maximum(a)-a.hp)*runtime.talentScytheRatio;talent(rec,a,4,'按已损生命增加攻击');}
 if(r.mechanic==='soul_burn'){const before=effective(a,'atk');modifyStage(b,rec,a,{atk:-r.stageCost},s.id);power+=Math.max(0,before-effective(a,'atk'));defense=Math.min(...b.units.filter(alive).map(u=>effective(u,'dfs')));}
 const denominator=(d:number)=>Math.max(1,r.minDefense??1,d);
 const physicalPart=channel==='mixed'?power*.5*(effective(a,'atk')+(activeTalent(a,4)?(maximum(a)-a.hp)*runtime.talentScytheRatio:0))/denominator(calculatedDefense(t,'dfs',pen)):0;
 const spellPart=channel==='mixed'?power*.5*effective(a,'sp_atk')/denominator(calculatedDefense(t,'sp_dfs',pen)):0;
 let spellFraction=channel==='mixed'?(physicalPart+spellPart>0?spellPart/(physicalPart+spellPart):0):channel==='spell'?1:0;
 let raw=channel==='fixed'?0:channel==='mixed'?physicalPart+spellPart:power*attack/denominator(defense);
 const fearTriggered=r.fearChance?random(b)<r.fearChance:undefined;
 const multiplierBreakdown:{label:string;value:number}[]=[];
 let multiplier=opt.multiplier??1;
 if(opt.multiplier&&opt.multiplier!==1)multiplierBreakdown.push({label:'本次攻击附加效果',value:opt.multiplier});
 const multiply=(value:number,label:string)=>{multiplier*=value;if(value!==1)multiplierBreakdown.push({label,value});};
 if(fearTriggered===false&&r.failureDamageBonus)multiply(1+r.failureDamageBonus,'未触发恐惧：伤害提高'+Math.round(r.failureDamageBonus*100)+'%');
 if(r.fastestMultiplier&&effective(t,'spd')===Math.max(...b.units.filter(alive).map(u=>effective(u,'spd'))))multiply(r.fastestMultiplier,'最快目标伤害倍率');
 if(r.dragonBonus&&cardOf(t.cardId).is_dragon)multiply(1+r.dragonBonus,'对龙族伤害加成');
 if(r.poisonMultiplier&&has(t,'poison'))multiply(r.poisonMultiplier,'目标中毒伤害加成');
 if(r.mechanic==='rainbow'&&Math.floor(a.hp)%7===0)multiply(2,'彩虹伤害倍率');
 if(r.mechanic==='wuchang_four'&&charged&&a.form===1)multiply(2,'四象归一伤害倍率');
 if(r.mechanic==='butterfly_six'&&a.form===1)multiply(2,'蝶舞形态伤害倍率');
 if(nextAttack.dormant)multiply(nextAttack.dormant,'蛰伏：下次攻击伤害');
 if(hasPassive(a,1)&&cardNo(a)===14){passive(rec,a,1,'焚灭天火');multiply(1+(a.counters.flame_growth??0),'焚灭天火伤害成长');}
 if(hasPassive(a,1)&&cardNo(a)===9&&es.some(e=>getElements(a).includes(e))){passive(rec,a,1,'同系攻击伤害提高');multiply(1+rules.summoner_1.sameTypeBonus,'同系攻击伤害加成');}
 if((a.counters['燃']??0)&&es.includes('火'))multiply(1+(a.counters['燃']??0)*rules.lava_troll_1.outgoing,'燃层火系伤害加成');
 // The seal weakens damage DEALT by the marked unit, including only the corresponding part of mixed damage.
 const silverPhysical=has(a,'silver_physical')&&(channel==='physical'||channel==='mixed');
 const silverSpell=has(a,'silver_spell')&&(channel==='spell'||channel==='mixed');
 if(silverPhysical||silverSpell){
  const factor=channel==='mixed'?(1-spellFraction)*(silverPhysical?.5:1)+spellFraction*(silverSpell?.5:1):.5;
  if(channel==='mixed')spellFraction=spellFraction*(silverSpell?.5:1)/factor;
  multiply(factor,'银龙准提印：造成的'+(silverPhysical&&silverSpell?'物理与法术':silverPhysical?'物理':'法术')+'伤害减半');
 }
 if(has(a,'wet')){if(es.includes('火'))multiply(.7,'潮湿：火系伤害弱化');if(es.includes('战斗'))multiply(.7,'潮湿：战斗系伤害弱化');}
 if(has(t,'wet')&&es.some(e=>['水','草','雷'].includes(e)))multiply(1.5,'潮湿目标伤害加成');
 if(has(t,'lost_spirit'))multiply(2,'落魄目标伤害加成');
 if(has(t,'death_despair')&&channel==='spell'){const despair=status(t,'death_despair')!,energy=(t.counters.death_energy??0);const ratio=Math.min(rules.death_reaper_5.damageCap,energy*rules.death_reaper_5.damagePerEnergy);if(ratio)multiply(1+ratio,'绝望：死气提高法术受伤');}
 if(has(a,'high_frequency')){const o=status(a,'high_frequency')!.data?.option;if(o==='spell'&&s.id==='thunder_core_6')multiply(1.5,'高周波：法术伤害加成');if(o==='physical'&&s.id==='tackle')multiply(2,'高周波：撞击伤害加成');}
 if(es.includes('火')&&(b.global['hell_fire_bonus:'+a.side]??0)>0)multiply(1+b.global['hell_fire_bonus:'+a.side],'算式·炎能：我方火属性攻击增伤');
 if(channel==='physical'){
  const spear=team(b,a).find(u=>u.cardId==='sword_dance'&&(u.counters['weapon:eternal_spear']??0)>0);
  if(spear){multiply(1.8,'永恒之枪：物理伤害×1.8');removeWeapon(b,rec,spear,'eternal_spear','触发物理伤害');}
 }
 if(activeTalent(a,2)&&r.isAttack!==false){multiply(runtime.talentLifeOrbMultiplier,'生命宝珠：攻击伤害 +20%');talent(rec,a,2,'攻击伤害 +20%');}
 if(opt.speedBonus)multiply(1+opt.speedBonus,'锦帆：仅本次攻击增伤');
 raw*=types.value;
 const critMultiplier=crit?Math.pow(r.critMultiplier??(1+config.crit.default_crit_coefficient*Math.pow(config.crit.crit_stage_multiplier_per_step,stageValue(a,'crit'))),critCount):1;
 raw*=critMultiplier;
 const specialEffects:{label:string;before:number;after:number;kind:'add'|'multiply'|'cap'|'floor'|'other'}[]=[];
 const special=(label:string,before:number,after:number,kind:'add'|'multiply'|'cap'|'floor'|'other'='other')=>{if(before!==after)specialEffects.push({label,before:Math.floor(before),after:Math.floor(after),kind});raw=after;};
 if(cardNo(t)===25&&(t.counters['weapon:black_shield']??0)>0){const before=raw;special('黑盾：伤害降低30%',before,raw*.7,'multiply');t.counters.black_shield_uses=(t.counters.black_shield_uses??0)+1;if(t.counters.black_shield_uses>=3){t.counters.black_shield_uses=0;removeWeapon(b,rec,t,'black_shield','触发3次');}}
 if(cardNo(t)===25&&(t.counters['weapon:absorb_shield']??0)>0&&channel==='spell'){const before=raw;special('吸收盾：法术伤害降低40%',before,raw*.6,'multiply');}
 const ruthlessIce=Boolean(status(t,'ice_seal')?.data?.ruthless);
 if(iceLayers(t)>0){const layers=iceLayers(t);if(!ruthlessIce){const before=raw;special('冰封：每层伤害降低5%',before,raw*Math.pow(.95,layers),'multiply');}else if(channel==='physical')fixedFinal+=20*layers;}
 if(cardNo(t)===33&&has(t,'calamity_cap')&&status(t,'calamity_cap')!.data?.attacker===a.id){const before=raw,remaining=Math.max(0,100-(t.counters['calamity_turn_damage:'+a.id]??0));special('灵魂震颤：本回合受到该目标伤害上限100',before,Math.min(raw,remaining),'cap');}
 const preSpecialDamage=raw*multiplier;
 raw=preSpecialDamage;
 if(fixed){const before=raw;raw+=fixed;special('附加固定伤害 +'+Math.floor(fixed),before,raw,'add');}
 if(has(a,'hundred_rounding')){const before=raw;const after=Math.ceil(raw/rules.lava_troll_5.step)*rules.lava_troll_5.step;special('魔族本源：造成伤害向上取整至100的整数倍',before,after,'floor');}
 if((t.counters['燃']??0)>0){const before=raw;special('燃：受到伤害提高',before,raw*(1+t.counters['燃']*rules.lava_troll_1.incoming),'multiply');}
 if(has(t,'dormant')){const before=raw;special('目标蛰伏：伤害减免',before,raw*(1-rules.venom_scorpion_3.reduction),'multiply');multiplierBreakdown.push({label:'目标蛰伏：伤害减免',value:1-rules.venom_scorpion_3.reduction});}
 if(has(t,'reduction')){const v=1-status(t,'reduction')!.value;const before=raw;special('目标伤害减免',before,raw*v,'multiply');multiplierBreakdown.push({label:'目标伤害减免',value:v});}
 if(has(t,'divine_descent')&&channel==='physical'){const v=1-status(t,'divine_descent')!.value;const before=raw;special('神降术：物理伤害减免',before,raw*v,'multiply');multiplierBreakdown.push({label:'神降术：物理伤害减免',value:v});}
 if(has(t,'delayed_attack')){const v=1-rules.flashwing_6.reduction;const before=raw;special('延迟攻击：伤害减免',before,raw*v,'multiply');multiplierBreakdown.push({label:'延迟攻击：伤害减免',value:v});}
 if(has(t,'sacred')){const prev=t.counters['previous:'+channel]??0;if(prev){const v=1-rules.alba_2.reduction;const before=raw;special('神圣：连续同类伤害减免',before,raw*v,'multiply');multiplierBreakdown.push({label:'神圣：连续同类伤害减免',value:v});}}
 if(cardNo(t)===32&&hasPassive(t,1)){const before=raw;special('云破月白：伤害减免',before,raw*Math.pow(1-rules.white_tiger_1.perHit,t.counters.moon_hits??0),'multiply');}
 if(cardNo(t)===15&&hasPassive(t,1)&&channel==='physical'){passive(rec,t,1,'蝎皇甲减免物理伤害');const before=raw;special('蝎皇甲：物理伤害固定减免',before,raw-Math.min(rules.venom_scorpion_1.physicalReduction,raw*rules.venom_scorpion_1.maxRatio),'other');}
 if(has(t,'forest_domain')){const before=raw;special('森罗万象域：伤害不高于'+status(t,'forest_domain')!.value,before,Math.min(raw,status(t,'forest_domain')!.value),'cap');}
 if(has(t,'water_spirit')){const before=raw;special('水之灵：伤害不高于'+Math.floor(power*rules.heinrich_2.cap),before,Math.min(raw,power*rules.heinrich_2.cap),'cap');}
 if(has(a,'water_spirit')){const before=raw;special('水之灵：伤害不低于'+Math.floor(power*rules.heinrich_2.min),before,Math.max(raw,power*rules.heinrich_2.min),'cap');}
 if(hasPassive(t,1)&&cardNo(t)===26&&t.hp===maximum(t)){passive(rec,t,1,'满血至多承受1点伤害');const before=raw;special('龙潜于渊：伤害不高于1',before,Math.min(raw,rules.sea_dragon_1.value),'cap');}
 const guard=team(b,t).find(u=>cardNo(u)===20&&hasPassive(u,2));
 if(guard&&s.target==='all_enemies'&&raw<rules.leviathan_2.threshold){passive(rec,guard,2,'风息障壁：低于120点的群体伤害减免50%');const before=raw;special('风息障壁：低于120点的群体伤害减免50%',before,raw*(1-rules.leviathan_2.reduction),'multiply');}
 if(has(t,'next_block')){const beforeBlock=raw;special('下次伤害减免',beforeBlock,Math.max(0,raw-status(t,'next_block')!.value),'other');if(beforeBlock>0)multiplierBreakdown.push({label:'下次伤害减免',value:beforeBlock?raw/beforeBlock:0});t.statuses=t.statuses.filter(x=>x.id!=='next_block');}
 if(has(t,'hundred_rounding')&&raw>rules.lava_troll_5.step){const before=raw;special('魔族本源：高于100点的受伤向下取整至100的整数倍',before,Math.floor(raw/rules.lava_troll_5.step)*rules.lava_troll_5.step,'floor');}
 let missed=false;
 if(!r.lock){if(has(a,'illusion')&&random(b)<rules.cairn_1.miss)missed=true;if(has(t,'evasion')&&random(b)<evasionRate(t,a)){missed=true;flat(b,rec,a,{dfs:-power*rules.flashwing_1.defenseLossPower},'flashwing_1');}}
 if(has(t,'calamity_immunity'))missed=true;
 if(has(t,'single_immunity')&&s.target!=='all_enemies'){missed=true;modifyStage(b,rec,t,{dfs:-1},'black_dragon_1');}
 if(has(t,'space_rift')&&(status(t,'space_rift')!.data?.round as number)===b.round&&t.counters.acted===b.round){missed=true;}
 if(!missed&&s.kind==='attack'&&has(t,'holy_blessing')&&raw+fixedFinal>rules.sacred_kirin_2.value){missed=true;t.statuses=t.statuses.filter(x=>x.id!=='holy_blessing');modifyStage(b,rec,t,rules.sacred_kirin_2.triggerStage,'sacred_kirin_2');notice(rec,t,'圣灵祝福：该次攻击的伤害及附加效果无效，魔攻与速度各提高1级');}
 if(fixedFinal){const before=raw;raw+=fixedFinal;special('冰封：最终固定伤害 +'+Math.floor(fixedFinal),before,raw,'add');}
 const postSpecialDamage=Math.floor(raw);
 let amount=missed?0:Math.max(raw>0?config.damage.min_final_damage:0,Math.floor(raw));
 const deathConversion=cardNo(a)===34&&s.kind==='attack';
 const deathQi=deathConversion?amount:0;if(deathConversion)amount=0;
 const before=t.hp;let absorbed=0,overflow=0;
 if(!missed&&!r.bypass){
  const nonfixed=Math.max(0,amount-Math.floor(fixed)),magical=Math.floor(nonfixed*spellFraction);
  const eligible={physical:channel==='spell'?0:channel==='mixed'?nonfixed-magical:amount,spell:magical};
  for(const sh of [...t.shields]){if(amount<=0)break;const blocked=Math.min(amount,eligible[sh.type]);if(blocked<=0)continue;const taken=Math.min(sh.value,blocked);sh.value-=taken;absorbed+=taken;
   if(sh.value<=0){overflow+=blocked-taken;amount-=blocked;if(sh.id.startsWith('sword_dance:absorb_shield:'))removeWeapon(b,rec,t,'absorb_shield','护盾破碎');t.shields=t.shields.filter(x=>x!==sh);if(sh.linked){t.modifiers=t.modifiers.filter(x=>x.source!==sh.linked);t.stageModifiers=t.stageModifiers.filter(x=>x.source!==sh.linked);}if(sh.breakStage)modifyStage(b,rec,t,{atk:1},sh.id);}
   else amount-=taken;eligible[sh.type]=Math.max(0,eligible[sh.type]-(sh.value<=0?blocked:taken));
  }
 }
 if(has(t,'reflect')&&depth<runtime.maxReactionDepth&&amount>0){directLoss(b,rec,a,amount,'誓言之魂反弹');amount=0;}
 const sacrifice=team(b,t).find(u=>u.id!==t.id&&cardNo(u)===6&&hasPassive(u,1));
 if(sacrifice&&amount>0&&!opt.reaction&&s.kind==='attack'&&r.isAttack!==false){
  const rt=roundRuntimes.get(b),id=b.round+':sacrifice:'+(rt?rt.reactionIndex++:0);
  const request:ReactionRequest={id,kind:'sacrifice',side:sacrifice.side,actor:sacrifice.id,attacker:a.id,target:t.id,skill:s.id,incomingDamage:amount,sacrificeCost:Math.floor(amount*rules.xuanwu_1.multiplier),allyDamage:rules.xuanwu_1.allyDamage};
  if(rt?.options.interactive&&rt.options.decisions?.[id]===undefined)throw new ReactionRequired(request,checkpoint(b,rec));
  if(rt?.options.decisions?.[id]===true){passive(rec,sacrifice,1,'献祭：主动选择代受伤害');directLoss(b,rec,sacrifice,request.sacrificeCost,'献祭');amount=request.allyDamage;}
 }
 const damageAmount=missed?0:Math.max(0,amount);
 if(t.fragments){const index=opt.fragment??t.fragments.findIndex(v=>v>0);const lost=Math.min(t.fragments[index]??0,amount);if(index>=0)t.fragments[index]-=lost;t.hp=t.fragments.reduce((n,v)=>n+v,0);t.split=t.fragments.filter(v=>v>0).length;}else t.hp=Math.max(0,t.hp-Math.min(t.hp,amount));const lost=before-t.hp;
 if(deathQi>0){t.counters.death_energy=(t.counters.death_energy??0)+deathQi;emit(rec,{kind:'status',actor:a.id,target:t.id,skill:s.id,text:'死神的「'+skillDisplayName(s,a)+'」未造成生命伤害，为 '+cardOf(t.cardId).name+' 叠加 '+deathQi+' 点死气（当前 '+t.counters.death_energy+'）',value:deathQi});}
 a.damageThisRound+=lost;t.damagedThisRound+=lost;t.counters['received:'+channel]=(t.counters['received:'+channel]??0)+lost;
 if(t.cardId==='calamity_core'&&has(t,'calamity_cap')&&status(t,'calamity_cap')!.data?.attacker===a.id)t.counters['calamity_turn_damage:'+a.id]=(t.counters['calamity_turn_damage:'+a.id]??0)+damageAmount;
 const attackStat=channel==='spell'?'sp_atk':'atk';const defenseStat=(['atk','dfs','sp_atk','sp_dfs','spd'].includes(basis)?basis:'dfs') as Exclude<Stat,'hp'>;
 const detail:DamageRecord={target:t.id,channel,attack,defense,defenseBasis:basis,power,crit,critRate:rate,critCount,critMultiplier,defensePenetration:pen,typeFactors:types.factors,typeRaw:types.raw,typeMultiplier:types.value,clamped:types.clamped,rawDamage:Math.floor(raw),preSpecialDamage:Math.floor(preSpecialDamage),calculatedDamage:missed?0:postSpecialDamage,damageAmount:Math.floor(damageAmount),shieldAbsorbed:absorbed,overflowNullified:overflow,fixedDamage:Math.floor(fixed),hpLost:lost,isAttack:r.isAttack!==false,missed,multiplierBreakdown,specialEffects,attackBreakdown:{base:a.base[attackStat],points:a.modifiers.filter(m=>m.stat===attackStat).reduce((n,m)=>n+m.delta,0),stage:stageValue(a,attackStat)},defenseBreakdown:{base:t.base[defenseStat],points:t.modifiers.filter(m=>m.stat===defenseStat).reduce((n,m)=>n+m.delta,0),stage:stageValue(t,defenseStat)},targetFragment:opt.fragment};
 const recipient=cardOf(t.cardId).name+(opt.fragment!==undefined?'（个体 '+(opt.fragment+1)+'）':'');
 emit(rec,{kind:'damage',actor:a.id,target:t.id,skill:s.id,text:cardOf(a.cardId).name+' 的「'+skillDisplayName(s,a)+'」'+(missed?'对 '+recipient+' 的攻击未生效':'对 '+recipient+' 造成 '+damageAmount+' 点伤害'+(crit?' · 暴击'+(critCount>1?' '+critCount+'次 · ×'+multiplierLabel(critMultiplier):''):'')+(channel!=='fixed'&&types.value!==1?' · '+(types.value>1?'克制':'弱化')+' ×'+multiplierLabel(types.value):'')+(channel!=='fixed'&&types.clamped?' · 倍率已截断':'')),value:damageAmount,detail});
 if(s.kind==='attack'&&detail.isAttack)settleAttackTalents(b,rec,a,t,s,detail,es);
 if(!missed&&damageAmount>0&&fixedFinal>0&&ruthlessIce&&a.cardId!=='ice_core')removeIce(b,rec,t,1,'非冰原核心的物理攻击触发算式·无情');
 if(!opt.noEffects&&!missed)afterDamage(b,rec,a,t,s,r,detail,depth,es,attackId,fearTriggered);
 if(ghostScythePower>0&&deathQi>0){const ratio=ghostScythePower/Math.max(1,power);heal(b,rec,a,deathQi*ratio,'幽冥死神之镰吸血',false);}
 if(crit&&!missed&&hasPassive(a,1)&&cardNo(a)===3)modifyStage(b,rec,a,{crit:rules.sacred_kirin_1.critStage},'sacred_kirin_1');
 checkDeath(b,rec,t);checkDeath(b,rec,a);return detail;
}

function settleAttackTalents(b:Battle,rec:Settlement,a:Unit,t:Unit,s:Skill,d:DamageRecord,elements:string[]){
 if(activeTalent(a,1)){const critical=d.crit&&!d.missed;a.counters.crit_bonus=critical?0:(a.counters.crit_bonus??0)+runtime.talentCritIncrement;talent(rec,a,1,critical?'本次攻击暴击，重置累积加成':'本次攻击未暴击，累积暴击率加成 '+Math.round(a.counters.crit_bonus*100)+' 个百分点');}
 if(d.missed||d.hpLost<=0)return;
 const weaknessKey='weakness:'+a.id;
 if(activeTalent(t,3)&&(d.crit||d.typeMultiplier>1)&&t.counters[weaknessKey]!==b.round){t.counters[weaknessKey]=b.round;talent(rec,t,3,'受到 '+cardOf(a.cardId).name+' 的克制或暴击，物攻+1级');modifyStage(b,rec,t,{atk:1},'talent_3');}
 if(activeTalent(a,14)){
  const dims:Record<string,Stat>={'水':'dfs','火':'atk','土':'sp_dfs','风':'spd','草':'hp','雷':'sp_atk'};
  const use=(actionContexts.get(rec)?.id??'effect')+':'+a.id+':'+s.id+':'+t.id;
  let used=elementalistUses.get(rec);if(!used){used=new Set();elementalistUses.set(rec,used);}
  if(used.has(use)||!elements.some(e=>dims[e]))return;used.add(use);
  for(const e of new Set(elements)){const k=dims[e];if(k){const value=runtime.talentElementAbsorbPoints;talent(rec,a,14,'吸取目标'+k+' '+value+'点');flat(b,rec,t,{[k]:-value},'talent_14');flat(b,rec,a,{[k]:value},'talent_14');}}
 }
}

function afterDamage(b:Battle,rec:Settlement,a:Unit,t:Unit,s:Skill,r:Rule,d:DamageRecord,depth:number,elements:string[],attackId:string,fearTriggered?:boolean){
 const lost=d.hpLost;
 if(lost>0&&t.cardId==='ice_core'&&hasPassive(t,1)){passive(rec,t,1,'指令·冰封：受到伤害后获得冰封');addIce(b,rec,t,1,'ice_core_1');}
 if(r.flatEnemy&&alive(t))flat(b,rec,t,r.flatEnemy,s.id);
 if(r.stageEnemy&&alive(t))modifyStage(b,rec,t,r.stageEnemy,s.id);
 if(r.stageEnemyIfDamageOver&&(d.damageAmount??lost)>r.stageEnemyIfDamageOver&&alive(t))modifyStage(b,rec,t,r.stageEnemy,s.id);
 if(s.id==='calamity_core_4'&&alive(a))applyStatus(b,rec,a,'calamity_cap',1,100,a.id,true,{attacker:t.id});
 if(r.reduceMaxByDamage&&lost)flat(b,rec,t,{hp:-lost},s.id);
 if(r.damageToAtk&&lost)flat(b,rec,a,{atk:lost*r.damageToAtk},s.id);
 if(r.damageToMax&&lost)flat(b,rec,a,{hp:lost*r.damageToMax},s.id);
 if(r.defenseDamageRatio&&lost)flat(b,rec,t,{dfs:lost*r.defenseDamageRatio},s.id);
 if(r.enemyPpAll){for(const id of t.skills)if(t.pp[id]>0)t.pp[id]=Math.max(0,t.pp[id]+r.enemyPpAll);clearExhaustedEncore(t,rec);}
 if(r.cleanseEnemyBuffs){t.stageModifiers=t.stageModifiers.filter(m=>m.delta<=0);for(const k of stages)if(t.stages[k]>0)t.stages[k]=0;}
 if(r.extraEnemyPpCost){
  if(t.counters.acted!==b.round){t.counters.extra_pp=(t.counters.extra_pp??0)+r.extraEnemyPpCost;t.counters.extra_pp_round=b.round;}
  else{const used=[...rec.events].reverse().find(e=>e.kind==='action'&&e.actor===t.id)?.skill;if(used)spendExtraPp(rec,t,used,r.extraEnemyPpCost);}
 }
 if(r.interruptIfUnacted&&t.counters.acted!==b.round)applyStatus(b,rec,t,'stun',1,0,a.id,true);
 if(r.enemyStatus&&alive(t)&&!['freeze','taunt','defer_next'].includes(r.enemyStatus)){
  if(r.enemyStatus==='encore'){
   if(t.lastSkill&&(t.pp[t.lastSkill]??skillOf(t.lastSkill).pp??-1)!==0)applyStatus(b,rec,t,'encore',r.duration+1,0,a.id,true,{skill:t.lastSkill,starts:b.round+1});
   clearExhaustedEncore(t,rec);
  }
  else if(r.enemyStatus==='corrosion'&&a.split>1&&has(t,'corrosion'))status(t,'corrosion')!.value+=r.hp;
  else applyStatus(b,rec,t,r.enemyStatus,r.duration??null,r.value??r.hp??r.count??0,a.id,true,r.enemyStatus==='fire_next'?{starts:b.round+1}:undefined);
 }
 if(r.enemyStatus==='defer_next'&&alive(t))applyStatus(b,rec,t,'defer_next',2,0,a.id,true,{starts:b.round+1});
 if(r.freezeCondition&&maximum(t)-t.hp<=maximum(a)-a.hp)applyStatus(b,rec,t,'freeze',2,0,a.id,true,{starts:b.round+1});
 if(r.enemyStatus==='taunt'||r.tauntCounter){const n=r.tauntCounter?a.counters['燃']??0:r.duration; if(n)applyStatus(b,rec,t,'taunt',n,0,a.id,true);}
 if(r.stunChance&&random(b)<r.stunChance)applyStatus(b,rec,t,'stun',1,0,a.id,true);
 if(r.paralyzeChance&&random(b)<r.paralyzeChance)applyStatus(b,rec,t,'paralysis',null,0,a.id,true);
 if(fearTriggered)applyStatus(b,rec,t,'fear',r.duration,0,a.id,true);
 if(r.critStealThreshold&&lost>=r.critStealThreshold){modifyStage(b,rec,t,{crit:-1},s.id);modifyStage(b,rec,a,{crit:1},s.id);}
 if(r.selfStatus)applyStatus(b,rec,a,r.selfStatus,r.duration??null,0,s.id,false);
 if(r.afterForm!==undefined)setForm(b,rec,a,r.afterForm);
 if(r.healMaxAfter)heal(b,rec,a,maximum(a)*r.healMaxAfter,skillDisplayName(s,a));
 let life=r.lifesteal??0;
 if(d.isAttack&&cardNo(a)===12&&hasPassive(a,1)){passive(rec,a,1,'再生吸血');life+=rules.terminus_rabbit_1.lifesteal;}
 if(has(a,'lifesteal'))life+=status(a,'lifesteal')!.value;
 if(cardNo(a)===22&&a.form===1){exclusive(rec,a,'般若相60%吸血');life+=.6;}
 if(r.mechanic==='phoenix_fire'){if(t.hp+lost>a.hp)life+=r.lifesteal;else modifyStage(b,rec,a,{sp_atk:r.stage},s.id);}
 if(r.mechanic==='wuchang_five'&&a.form===0&&!t.attackedThisRound){a.charged=true;life+=1;}
 if(life&&lost)heal(b,rec,a,lost*life,skillDisplayName(s,a)+'吸血');
 if(r.selfDamage&&lost)directLoss(b,rec,a,lost*r.selfDamage,skillDisplayName(s,a)+'反噬',false);
 if(r.mechanic==='next_damage_block')applyStatus(b,rec,a,'next_block',1,lost,s.id);
 if(r.mechanic==='reset_gate'){
  const key='gate:'+t.id;
  if(a.counters[key]){delete a.counters[key];notice(rec,t,'深海暗流：蓄力许可已重置，须重新蓄力才能将深海鲸鲨王选为单体攻击目标');}
  else modifyStage(b,rec,a,{spd:1,crit:1},s.id);
 }
 if(r.mechanic==='invert_highest'){const max=Math.max(...stages.map(k=>stageValue(t,k)));const k=stages.find(k=>stageValue(t,k)===max)!;if(max>0)modifyStage(b,rec,t,{[k]:-max*2},s.id);}
 if(r.mechanic==='wuchang_four'&&(a.charged||a.chargeUntil>=b.round))modifyStage(b,rec,t,a.form===0?{atk:-1,sp_atk:-1}:{dfs:-1,sp_dfs:-1},s.id);
 if(r.mechanic==='wuchang_five'&&a.form===1){const n=Math.floor(lost/r.stageDivisor);if(n)modifyStage(b,rec,t,{dfs:-n,sp_dfs:-n},s.id);}
 if(r.mechanic==='butterfly_six'&&a.form===0)modifyStage(b,rec,a,{atk:1,sp_atk:1,dfs:2,sp_dfs:2},s.id);
 if(d.isAttack&&cardNo(a)===23&&hasPassive(a,1)&&alive(t)){
  const mapping:Record<string,Stage>={'水':'dfs','火':'atk','土':'sp_dfs','风':'spd','草':'crit','雷':'sp_atk'},seal=rules.silver_dragon_1;
  for(const e of new Set(elements)){
   const k=mapping[e];if(!k&&e!=='战斗'&&e!=='灵')continue;
   passive(rec,a,1,'银龙准提印');
   if(k){const before=stageValue(t,k);modifyStage(b,rec,t,{[k]:-seal.debuff},'silver_dragon_1');const taken=Math.max(0,before-stageValue(t,k));if(taken)modifyStage(b,rec,a,{[k]:taken},'silver_dragon_1');}
   else applyStatus(b,rec,t,e==='战斗'?'silver_physical':'silver_spell',seal.duration,0,a.id,true);
  }
 }
 if(lost>0&&cardNo(a)===30&&hasPassive(a,1)){for(const u of b.units)u.statuses=u.statuses.filter(st=>st.id!=='rose_seal'||st.source!==a.id);applyStatus(b,rec,t,'rose_seal',rules.alba_1.duration,0,a.id,true);passive(rec,a,1,'皇家魔宫玫瑰：封印被动与天赋');}
 if(d.isAttack&&lost>0&&cardNo(a)===13&&hasPassive(a,1)&&alive(t)&&t.hp<=rules.soul_luoxi_1.perRound*Math.max(1,a.aliveRounds)){passive(rec,a,1,'星灵灭斩杀');directLoss(b,rec,t,t.hp,'星灵灭');}
 if(lost>0&&has(t,'butterfly')&&status(t,'butterfly')!.source===a.id&&cardNo(a)===22)setForm(b,rec,a,2);
 if(lost>0&&cardNo(t)===18&&hasPassive(t,1)&&lost<=rules.titan_1.threshold&&(t.counters.awaken_round??0)<rules.titan_1.limit){t.counters.awaken_round=(t.counters.awaken_round??0)+1;passive(rec,t,1,'力量觉醒');modifyStage(b,rec,t,rules.titan_1.stage,'titan_1');flat(b,rec,t,{atk:lost,spd:lost},'titan_1');}
 if(lost>0){t.counters.history_hits=(t.counters.history_hits??0)+1;if(cardNo(t)===30&&t.hp<rules.alba_6.unlockHp)t.counters.alba_unlocked=1;}
 if(lost>0&&a.cardId==='sword_dance'&&d.channel==='physical'&&(a.counters['weapon:flying_axe']??0)>0&&random(b)<.5)removeWeapon(b,rec,a,'flying_axe','物理伤害触发飞斧效果');
 if(lost>0&&cardNo(t)===27&&hasPassive(t,1)){t.counters.dark_total=(t.counters.dark_total??0)+lost;while(t.counters.dark_total>=rules.slime_1.threshold){t.counters.dark_total-=rules.slime_1.threshold;passive(rec,t,1,'黑暗源流');for(const u of enemy(b,t))directLoss(b,rec,u,rules.slime_1.value*(has(t,'slime_redirect')?rules.slime_3.multiplier:1),'黑暗源流');}}
 if(cardNo(t)===32&&hasPassive(t,1)){t.counters.moon_hits=(t.counters.moon_hits??0)+1;passive(rec,t,1,'云破月白：获得回合免伤层');}
 if(d.damageAmount!==undefined&&d.damageAmount>200&&t.cardId==='sword_dance'&&weaponCount(t)>0){const keys=Object.keys(weaponLabels).filter(k=>(t.counters['weapon:'+k]??0)>0);if(keys.length)removeWeapon(b,rec,t,keys[Math.floor(random(b)*keys.length)],'单次受伤超过200');}
 if(has(t,'low_pressure')&&lost>0)modifyStage(b,rec,a,{dfs:-1},'griffin_2');
 if(has(t,'rising_air')&&lost>0&&!t.counters.rising_triggered){t.counters.rising_triggered=1;modifyStage(b,rec,t,{spd:1},'griffin_1');}
 if(lost>0&&has(a,'recoil'))directLoss(b,rec,a,lost*status(a,'recoil')!.value,'叶旋反伤');
 if(lost>0&&d.isAttack&&has(a,'divine_descent')&&triggerOnce(rec,attackId,'divine_descent',t.id)){
  const before=stageValue(t,'sp_dfs');modifyStage(b,rec,t,{sp_dfs:-1},'soul_luoxi_3');const taken=Math.max(0,before-stageValue(t,'sp_dfs'));if(taken)modifyStage(b,rec,a,{sp_dfs:taken},'soul_luoxi_3');
 }
 if(lost>80&&!s.elements.includes('战斗')&&activeTalent(t,8)&&!t.counters.primal_round){t.counters.primal_round=1;talent(rec,t,8,'削弱伤害来源抗性');modifyStage(b,rec,a,{sp_dfs:-1},'talent_8');}
 if(lost>beforeDamageHp(t,lost)*config.talent_options.eternal_guard_threshold&&activeTalent(t,13)){talent(rec,t,13,'单次受伤超过当前生命20%');modifyStage(b,rec,t,{dfs:2,sp_dfs:2,crit:-2},'talent_13');}
 if(cardNo(t)===29&&hasPassive(t,1)&&s.elements.includes('火')){t.counters['燃']=(t.counters['燃']??0)+1;passive(rec,t,1,'受到火攻获得燃');}
 if(s.elements.includes('雷')&&has(t,'magnetized')&&random(b)<status(t,'magnetized')!.value)applyStatus(b,rec,t,'stun',1,0,a.id,true);
 if(d.isAttack&&depth<runtime.maxReactionDepth){
  const counter=status(t,'counter');if(counter&&t.side!==a.side&&alive(t)&&alive(a)&&triggerOnce(rec,attackId,'counter',t.id)){const p=counter.value;counter.value+=rules.xuanwu_6.increment;t.counters.counter_triggers=(t.counters.counter_triggers??0)+1;damage(b,rec,t,a,{...skillOf('xuanwu_6'),name:'四象反击',elements:['战斗'],channel:'physical',power:p,target:'single'}, {},{reaction:true,depth:depth+1});}
  if(has(t,'evil_system')&&alive(t)&&alive(a)&&!b.endedRound)extraAction(b,rec,t,'thunder_core_1',b.plannedActions??[],depth+1,'attack');
 }
}
function beforeDamageHp(t:Unit,lost:number){return t.hp+lost;}
export function validateActions(b:Battle,side:Side,actions:Action[]){
 const own=b.units.filter(u=>u.side===side&&alive(u)&&!preplannedUnable(u,b.round));
 if(!Array.isArray(actions)||actions.length!==own.length||new Set(actions.map(a=>a.actor)).size!==own.length)throw Error('请为每名存活角色提交一个行动');
 for(const action of actions){const u=own.find(u=>u.id===action.actor);if(!u)throw Error('无法操作此角色');validateOneAction(b,u,action);}
}
export function validateOneAction(b:Battle,u:Unit,a:Action,extra=false){
 const restriction=skillRestriction(b,u,a.skill);if(restriction)throw Error(restriction);
 const s=skillOf(a.skill),r=rules[s.id]??{};
 const target=b.units.find(t=>t.id===a.target),mode=attackTargetMode(u,s,b.round,s.kind==='support'?supportTarget(s):s.target);
 if(s.kind==='attack'&&['single','any'].includes(mode)&&target?.side!==u.side&&target?.cardId==='shark_king'&&hasPassive(target,1)&&!target.counters['gate:'+u.id])throw Error('受天降奇兵影响，敌方角色须先蓄力，才能将深海鲸鲨王选为单体攻击目标');
 if(a.resetSpeed&&!(u.cardId==='shark_king'&&hasPassive(u,2)&&s.kind==='attack'&&r.isAttack!==false&&effective(u,'spd')>u.base.spd))throw Error('锦帆仅能在自身有效速度高于初始速度时重置速度');
 if(s.kind==='attack'&&s.target==='single'&&a.target&&has(u,'taunt')&&status(u,'taunt')!.source!==a.target)throw Error('嘲讽状态必须指定嘲讽来源');
 const targetMode=r.target??(s.kind==='attack'?'single':supportTarget(s));
 if(a.targetFragment!==undefined&&(!target?.fragments||!Number.isInteger(a.targetFragment)||a.targetFragment<0||a.targetFragment>=target.fragments.length||target.fragments[a.targetFragment]<=0))throw Error('分裂个体目标无效');
 if(['single','any','ally','ally_or_self'].includes(targetMode)&&(!target||!alive(target)))throw Error('请选择存活目标');
 if(targetMode==='single'&&target?.side===u.side)throw Error('请选择敌方目标');
 if(targetMode==='ally'&&(target?.side!==u.side||target?.id===u.id))throw Error('只能选择己方另一名存活角色');
 if(targetMode==='ally_or_self'&&target?.side!==u.side)throw Error('请选择己方目标');
 if(r.mechanic==='repeat_stages'&&!b.units.some(t=>t.id===a.secondaryTarget&&alive(t)))throw Error('请选择存活的第二目标，以叠加第一目标的属性等级增减益');
 if(r.chooseElement&&!['水','火','土','风','草','雷'].includes(a.element??''))throw Error('请选择元素弹系别');
 if(r.chooseChannel&&!['physical','spell'].includes(a.option??''))throw Error('请选择伤害类型');
 if(r.mechanic==='high_frequency'&&!['physical','spell'].includes(a.option??''))throw Error('请选择武装模式');
 if(r.mechanic==='weapon_choose'&&!r.weapons.includes(a.option??''))throw Error('请选择武器');
 if(r.mechanic==='weapon_reforge'&&(!a.option||!(u.counters['weapon:'+a.option]??0)))throw Error('请选择已有武器');
 if(r.mechanic==='choose_flat'&&!['atk','dfs','sp_atk','sp_dfs','spd'].includes(a.attribute??''))throw Error('请选择增加的属性');
 if(r.mechanic==='copy_field'&&!['0','1','2'].includes(a.option??''))throw Error('请选择形态');
 if(r.mechanic==='prophecy'&&(!a.copySkill||['charge','tackle'].includes(a.copySkill)))throw Error('请选择预言技能');
 if(r.mechanic==='seal_skill'&&!a.copySkill)throw Error('请选择封印的技能');
 if(r.mechanic==='stage_allocation')for(const allocation of [a.allocation,a.boostAllocation]){if(!allocation||Object.entries(allocation).some(([k,v])=>!stages.includes(k as Stage)||!Number.isInteger(v)||v!<0)||Object.values(allocation).reduce((n,v)=>n+(v??0),0)!==r.stages)throw Error('削弱和强化各需分配3级');}
 if(r.mechanic==='replace_skill'&&a.replaceTo){const recipient=b.units.find(t=>t.id===a.replacement&&t.side===u.side&&alive(t));if(!recipient||!a.replaceFrom||!recipient.skills.includes(a.replaceFrom)||!cardOf(recipient.cardId).skills.some(s=>s.id===a.replaceTo)||recipient.skills.includes(a.replaceTo)||rules[a.replaceTo]?.unavailable)throw Error('替换技能选择无效');}
 if(!extra&&a.extra){if(a.extra.length>2)throw Error('额外行动过多');for(const x of a.extra){if(x.actor!==u.id)throw Error('额外行动角色错误');if(s.id==='black_dragon_5'&&skillOf(x.skill).kind==='attack')throw Error('黑龙暗光波的追加行动不能攻击');validateOneAction(b,u,x,true);}}
}
// Only explicitly documented skill effects waive PP; basic charge never does.
function skillPpFree(u:Unit,id:string){return Boolean(has(u,'high_frequency')&&status(u,'high_frequency')!.data?.option==='spell'&&id==='thunder_core_6'||id==='wuchang_3'&&u.charged);}
function activeEncore(u:Unit,round:number){
 const st=status(u,'encore'),id=st?.data?.skill;
 return st&&typeof id==='string'&&(st.until===null||st.until>=round)&&Number(st.data?.starts??0)<=round&&(u.pp[id]??skillOf(id).pp??-1)!==0?st:undefined;
}
function clearExhaustedEncore(u:Unit,rec:Settlement){
 const forced=status(u,'encore'),id=forced?.data?.skill;
 if(typeof id==='string'&&(u.pp[id]??skillOf(id).pp??-1)===0){u.statuses=u.statuses.filter(st=>st!==forced);notice(rec,u,'「'+skillOf(id).name+'」PP耗尽，「再来一次」已解除，可自由选择技能');}
}
function spendExtraPp(rec:Settlement,u:Unit,id:string,amount:number){
 const remaining=u.pp[id]??skillOf(id).pp??-1;
 if(remaining<0){notice(rec,u,'灵魂冲击：「'+skillOf(id).name+'」为无限PP技能，无需额外扣除PP');return;}
 const skillSpent=Math.min(remaining,amount),omniSpent=Math.min(u.counters.omni_pp??0,amount-skillSpent);
 u.pp[id]=remaining-skillSpent;if(omniSpent)u.counters.omni_pp-=omniSpent;
 notice(rec,u,'灵魂冲击：「'+skillOf(id).name+'」额外扣除'+skillSpent+'点招式PP、'+omniSpent+'点全能PP（最多扣至0，不影响技能发动）');
 clearExhaustedEncore(u,rec);
}
export function skillRestriction(b:Pick<Battle,'round'|'global'>,u:Unit,id:string):string|undefined{
 if(!availableSkills(u).includes(id))return '技能未携带或已废除';
 if(preplannedUnable(u,b.round))return '受预定无法行动效果影响，本回合无需选择技能';
 const s=skillOf(id),r=rules[id]??{};
 if(r.mechanic==='weapon_choose'&&weaponCount(u)>=runtime.weaponLimit)return '武器已达'+runtime.weaponLimit+'件上限，请先消耗武器';
 if(s.timing==='passive')return '被动技能自动生效，无需选择';
 if(r.unavailable)return r.unavailable;
 const forced=activeEncore(u,b.round);if(forced&&id!==forced.data!.skill)return '受「再来一次」影响，必须使用「'+skillOf(String(forced.data!.skill)).name+'」';
 if(has(u,'madness')&&s.kind!=='attack')return '受「疯狂」影响，必须使用攻击技能';
 if(has(u,'sealed')&&status(u,'sealed')!.data?.skill===id)return '受「封印」影响，不能使用「'+skillDisplayName(s,u)+'」';
 const free=skillPpFree(u,id);
 if((u.pp[id]??s.pp??-1)===0&&!free&&(u.counters.omni_pp??0)<=0)return '技能PP不足';
 if(r.requiresPreviousSupport&&u.lastWasAttack)return '上次行动未攻击才可使用';
 if(r.unlockHp&&!u.counters.alba_unlocked)return '生命首次低于300点后解锁';
 if(r.noConsecutive&&u.lastSkill===id)return '此技能不能连续使用';
 if(r.noConsecutiveRounds&&u.counters['last_success:'+id]===b.round-1)return '此技能不能连续两回合使用';
 if(r.globalOnce&&b.global[id])return '该技能全场仅可使用一次，已被使用';
 if(r.counterCost&&(u.counters[r.counterCost.name]??0)<r.counterCost.value)return '「'+r.counterCost.name+'」不足：需要'+r.counterCost.value+'层，当前'+(u.counters[r.counterCost.name]??0)+'层';
}
export function actionHints(b:Pick<Battle,'round'>,u:Unit):string[]{
 const hints:string[]=[],forced=activeEncore(u,b.round);
 if(preplannedUnable(u,b.round))hints.push('本回合受「'+(has(u,'hell_stun')?'火流星反噬':'冰冻')+'」影响，无法行动，无需选择或提交技能');
 if(u.cardId==='death_reaper'&&(u.counters.ghost_next??0)>0)hints.push('幽冥状态：接下来 '+u.counters.ghost_next+' 次已装备技能的成功使用将发动对应幽冥效果；鬼墨无忧的被动触发、撞击、蓄力和控制失败不消耗次数');
 if(forced&&Number(forced.data?.starts??0)<=b.round&&forced.data?.skill){
  const id=String(forced.data.skill);
  hints.push('受「再来一次」影响，必须使用「'+skillOf(id).name+'」；该技能PP耗尽时自动解除');
 }
 if(has(u,'madness'))hints.push('受「疯狂」影响，必须使用攻击技能，生命回复会转为伤害');
 if(has(u,'fear'))hints.push('受「恐惧」影响，持续期间下一次攻击将失效且不消耗PP，可选择法术或蓄力');
 if(has(u,'stun'))hints.push('受「眩晕」影响，本回合内下一次行动将失效且不消耗PP，回合结束时自动移除');
 if(has(u,'lost_soul'))hints.push('受「失魂」影响，攻击将失效且不消耗PP');
 if(has(u,'taunt'))hints.push('受「嘲讽」影响，单体攻击必须以嘲讽来源为目标');
 return hints;
}
function defaultSkillAction(b:Battle,u:Unit,id:string):Action|undefined{
 const s=skillOf(id),r=rules[id]??{},mode=attackTargetMode(u,s,b.round,s.kind==='support'?supportTarget(s):s.target);
 const targets=b.units.filter(alive).filter(t=>mode==='self'?t.id===u.id:mode==='ally'?t.side===u.side&&t.id!==u.id:mode==='ally_or_self'||mode==='all_allies'?t.side===u.side:mode==='any'?true:t.side!==u.side);
 for(const t of targets){const action:Action={actor:u.id,skill:id,target:t.id,...(r.mechanic==='repeat_stages'?{secondaryTarget:t.id}:{}),element:'水',option:r.mechanic==='copy_field'?'0':'spell',attribute:'atk',allocation:{atk:3},boostAllocation:{spd:3},copySkill:cardOf(t.cardId).skills.find(s=>s.timing!=='passive')?.id};try{validateOneAction(b,u,action,true);return action;}catch{}}
}
export function validateExtraAction(b:Battle,request:ExtraActionRequest,a:Action){
 if(!a||typeof a!=='object'||a.actor!==request.actor||!request.allowedSkills.includes(a.skill)||a.extra)throw Error('请选择当前角色可用的额外行动');
 const u=b.units.find(u=>u.id===request.actor);if(!u||!alive(u))throw Error('角色已无法行动');
 if(request.restriction!=='any'&&skillOf(a.skill).kind!==(request.restriction==='attack'?'attack':'support'))throw Error(request.restriction==='attack'?'本次额外行动必须使用攻击技能':'本次额外行动不能使用攻击技能');
 validateOneAction(b,u,a,true);
}
function extraAction(b:Battle,rec:Settlement,u:Unit,source:string,allActions:Action[],depth:number,restriction:ExtraActionRequest['restriction']='any'){
 if(!alive(u)||b.endedRound||depth>runtime.maxReactionDepth)return;
 const choices=[...new Set(['charge','tackle',...availableSkills(u)])].filter(id=>restriction==='any'||skillOf(id).kind===(restriction==='attack'?'attack':'support')).map(id=>defaultSkillAction(b,u,id)).filter((a):a is Action=>Boolean(a));
 if(!choices.length){notice(rec,u,'没有符合条件的额外行动，本次跳过');return;}
 const rt=roundRuntimes.get(b),id=b.round+':extra-action:'+(rt?rt.reactionIndex++:0);
 const request:ExtraActionRequest={id,kind:'extra-action',side:u.side,actor:u.id,skill:source,restriction,allowedSkills:choices.map(a=>a.skill),defaultAction:choices[0]};
 notice(rec,u,skillOf(source).name+'：触发额外行动'+(restriction==='support'?'（不能使用攻击）':restriction==='attack'?'（必须使用攻击）':''));
 const decision=rt?.options.decisions?.[id];
 if(rt?.options.interactive&&decision===undefined)throw new ReactionRequired(request,checkpoint(b,rec));
 const action=decision&&typeof decision==='object'?decision:request.defaultAction;
 validateExtraAction(b,request,action);executeAction(b,rec,u,action,allActions,depth);
}
export function supportTarget(s:Skill){const r=rules[s.id]??{};return r.target??(r.enemyStatus||['invert_stages','prophecy','declare_next','triple_soul','flower_sequence','seal_skill'].includes(r.mechanic)?'single':'self');}
export function priority(u:Unit,s:Skill){
 if(cardNo(u)===22&&u.form===2)return 4;
 const base=s.kind==='support'?config.priority.support:config.priority.attack;
 const first=s.timing==='first'||has(u,'next_first')&&(status(u,'next_first')!.data?.starts as number)<=u.aliveRounds||s.id==='shark_king_6'&&has(u,'shark_blade')||rules[s.id]?.firstBelow&&u.hp/maximum(u)<=rules[s.id].firstBelow;
 const last=s.timing==='last'||has(u,'defer_next')&&(status(u,'defer_next')!.data?.starts as number)<=u.aliveRounds;
 return base+(first?config.priority.first:0)+(last?config.priority.last:0);
}

function targetsFor(b:Battle,a:Unit,s:Skill,r:Rule,action:Action){
 const mode=attackTargetMode(a,s,b.round,s.kind==='support'?supportTarget(s):s.target);
 if(mode==='self')return [a];if(mode==='all_enemies')return enemy(b,a);if(mode==='all_allies')return team(b,a);if(mode==='all_except_self')return b.units.filter(t=>alive(t)&&t.id!==a.id);
 let t=b.units.find(t=>t.id===action.target&&alive(t));
 if(!t)return [];
 if(s.kind==='attack'&&t.side!==a.side){
  const swap=status(a,'target_swap');if(swap){const map=swap.data as Record<string,string>;t=b.units.find(u=>u.id===map[t!.id]&&alive(u))??t;}
  const taunt=status(a,'taunt');if(taunt)t=b.units.find(u=>u.id===taunt.source&&alive(u))??t;
  const tornado=b.units.find(u=>u.side===t!.side&&has(u,'tornado_target'));if(tornado)t=b.units.find(u=>u.id===status(tornado,'tornado_target')!.data?.target&&alive(u))??t;
  const redirect=b.units.find(u=>u.side===t!.side&&alive(u)&&cardNo(u)===16&&hasPassive(u,1)&&s.elements.some(e=>rules.treant_1.elements.includes(e)));
  if(redirect)t=redirect;
  const slime=b.units.find(u=>u.side===t!.side&&alive(u)&&has(u,'slime_redirect'));
  if(slime&&!s.elements.some(e=>['灵','战斗'].includes(e)))t=slime;
  const butterfly=b.units.find(u=>has(u,'butterfly_swap')&&status(u,'butterfly_swap')!.data?.other===t!.id);
  if(butterfly)t=butterfly;
 }
 return [t];
}
function executeSupport(b:Battle,rec:Settlement,a:Unit,t:Unit,s:Skill,r:Rule,action:Action,allActions:Action[]){
 if(r.mechanic!=='repeat_stages'&&has(t,'calamity_immunity')){notice(rec,t,'玄宇宙：免疫「'+skillDisplayName(s,a)+'」效果');return;}
 const source=s.id,duration=r.duration??null;
 if(r.hpCost)directLoss(b,rec,a,a.hp*r.hpCost,skillDisplayName(s,a)+'代价',false);
 if(r.maxCost)flat(b,rec,a,{hp:-maximum(a)*r.maxCost},source);
 if(r.healMax)heal(b,rec,t,maximum(t)*r.healMax,skillDisplayName(s,a));
 if(r.healMissing)heal(b,rec,t,(maximum(t)-t.hp)*r.healMissing,skillDisplayName(s,a));
 if(r.stage)modifyStage(b,rec,t,r.stage,source,r.linked?999:r.stageDuration??null);
 if(r.flat)flat(b,rec,t,r.flat,source,r.linked?999:r.flatDuration??null);
 if(r.flatAfter)flat(b,rec,t,r.flatAfter,source);
 if(r.flatFromSpeed)flat(b,rec,a,{atk:effective(a,'spd')*r.flatFromSpeed},source);
 if(r.status){applyStatus(b,rec,t,r.status,duration,r.value??r.reduction??0,source,false,r.status==='space_rift'?{round:b.round}:undefined);if(r.noConsecutiveRounds&&status(t,r.status)?.source===source)a.counters['last_success:'+s.id]=b.round;}
 if(r.enemyStatus&&t.side!==a.side)applyStatus(b,rec,t,r.enemyStatus,duration,r.value??0,a.id,true);
 if(r.selfReduction)applyStatus(b,rec,a,'reduction',1,r.selfReduction,source);
 if(r.shield)shieldAdd(b,rec,t,r,source);
 if(r.cleanse)cleanse(t);
 if(r.counter)a.counters[r.counter.name]=(a.counters[r.counter.name]??0)+r.counter.delta;
 if(r.elements){t.elements=[...r.elements];t.elementUntil=b.round+(r.duration??1)-1;}
 executeMechanic(b,rec,a,t,s,r,action,allActions);
}
function executeMechanic(b:Battle,rec:Settlement,a:Unit,t:Unit,s:Skill,r:Rule,action:Action,allActions:Action[]){
 const source=s.id;
 switch(r.mechanic){
 case 'dragon_crossing':{const values=Object.fromEntries((['hp','atk','dfs','sp_atk','sp_dfs','spd'] as Stat[]).map(k=>[k,effective(a,k)])) as Unit['base'];a.base=values;a.modifiers=[];a.stages=Object.fromEntries(stages.map(k=>[k,0])) as Unit['stages'];a.stageModifiers=[];notice(rec,a,'龙渡：初始属性设为当前有效值，属性等级重置');break;}
 case 'swap_ally_targets':{
  const ally=team(b,a).find(u=>u.id!==a.id);if(ally){for(const e of enemy(b,a))applyStatus(b,rec,e,'target_swap',1,0,a.id,false,{[a.id]:ally.id,[ally.id]:a.id});for(const ac of allActions.filter(ac=>ac.target===a.id)){const attacker=b.units.find(u=>u.id===ac.actor)!;flat(b,rec,attacker,{dfs:-r.debuffDefense,sp_dfs:-r.debuffDefense},source,1);}}break;}
 case 'trick_room': b.global.trick_room_until=b.round+r.duration-1;notice(rec,a,'戏法空间：行动排序速度反转，持续3回合');break;
 case 'invert_stages':for(const k of stages)modifyStage(b,rec,t,{[k]:-2*stageValue(t,k)},source);break;
 case 'next_aoe':for(const u of team(b,a))applyStatus(b,rec,u,'next_aoe',null,a.charged?r.charged:r.normal,source);break;
 case 'stage_allocation':modifyStage(b,rec,t,Object.fromEntries(Object.entries(action.allocation!).map(([k,v])=>[k,-v!])),source);modifyStage(b,rec,t,action.boostAllocation!,source);break;
 case 'blood_shield':{const hp=a.hp*r.ratio;directLoss(b,rec,a,hp,skillDisplayName(s,a)+'代价',false);a.shields.push({id:source+':'+b.round,type:'physical',value:Math.floor(hp),breakStage:true});break;}
 case 'prophecy':{
  flat(b,rec,a,{dfs:r.selfDefense,sp_dfs:r.selfDefense},source,1);
  if(t.skills.includes(action.copySkill!)){
   const enemyAction=allActions.find(x=>x.actor===t.id);
   if(enemyAction){
    const forced=defaultSkillAction(b,t,action.copySkill!);
    if(forced){
     // A changed skill needs its own valid element/form/options. Retain the
     // target player's submitted target whenever it is legal for the new move.
     const retainedTarget={...forced,target:enemyAction.target,targetFragment:enemyAction.targetFragment};
     try{validateOneAction(b,t,retainedTarget,true);Object.assign(forced,retainedTarget);}catch{}
     for(const key of Object.keys(enemyAction))delete (enemyAction as unknown as Record<string,unknown>)[key];
     Object.assign(enemyAction,forced);
    }else enemyAction.skill=action.copySkill!;
   }
   notice(rec,a,'大预言术指定成功');
  }else notice(rec,a,'大预言术：目标未携带该技能，指定失败');break;}
 case 'steal_field_stages':for(const u of b.units.filter(alive)){if(u.id===a.id)continue;for(const k of r.attributes as Stage[]){const n=stageValue(u,k);modifyStage(b,rec,u,{[k]:-n},source);modifyStage(b,rec,a,{[k]:n},source);}}break;
 case 'flower_sequence':applyStatus(b,rec,a,'flower_self',r.duration,r.value,t.id);applyStatus(b,rec,t,'flower_drain',r.duration,r.value,a.id,true);break;
 case 'repeat_stages':{
  applyStatus(b,rec,a,'reduction',1,r.reduction,source);
  const recipient=b.units.find(u=>u.id===action.secondaryTarget&&alive(u));
  if(!recipient){notice(rec,a,'有凤来仪：第二目标已倒下，属性等级叠加落空');break;}
  const changes=Object.fromEntries(stages.map(k=>[k,stageValue(t,k)]));
  emit(rec,{kind:'notice',actor:a.id,target:recipient.id,skill:s.id,text:'有凤来仪：将'+cardOf(t.cardId).name+'的属性等级增减益叠加至'+cardOf(recipient.cardId).name});
  modifyStage(b,rec,recipient,changes,source);break;
 }
 case 'restore_history':{const old=a.history[Math.max(0,a.history.length-r.rounds)]??a.hp;const hits=a.counters.history_hits??0;a.hp=clamp(old,0,maximum(a));modifyStage(b,rec,a,{dfs:-hits},source);notice(rec,a,'复苏：生命恢复至两回合前，不计为回血');break;}
 case 'swap_elements':{const ae=[...getElements(a)],te=[...getElements(t)];a.elements=te;t.elements=ae;a.elementUntil=t.elementUntil=999;modifyStage(b,rec,t,{dfs:t.side===a.side?r.stage:-r.stage},source);break;}
 case 'switch_form':setForm(b,rec,a,a.form===0?1:0);a.charged=true;applyStatus(b,rec,a,'next_first',2,0,source,false,{starts:b.round+1});applyStatus(b,rec,a,'control_immune',1,0,source);break;
 case 'declare_next':if(has(t,'declaration')&&status(t,'declaration')!.source===a.id){const old=a.form;setForm(b,rec,a,old===0?1:0);if(random(b)<r.chance)applyStatus(b,rec,t,old===0?'lost_spirit':'lost_soul',r.duration,0,a.id,true);t.statuses=t.statuses.filter(x=>x.id!=='declaration');}else{applyStatus(b,rec,t,'declaration',r.duration,0,a.id,true);if(a.pp[s.id]>-1)a.pp[s.id]++;}break;
 case 'triple_soul':{let hits=0;for(let i=0;i<r.rolls;i++)if(random(b)<r.chance)hits++;if(hits)applyStatus(b,rec,t,a.form===0?'soul_paralysis':'stiff',r.duration*hits,a.form===0?20*hits:0,a.id,true);if(hits===r.rolls)applyStatus(b,rec,t,a.form===0?'lost_soul':'lost_spirit',r.duration,0,a.id,true);break;}
 case 'copy_field':setForm(b,rec,a,Number(action.option));a.copied=[...new Set(allActions.filter(ac=>ac.actor!==a.id).map(ac=>ac.skill))];for(const id of a.copied)a.pp[id]=1;notice(rec,a,'记录本回合其他角色技能，各可使用一次');break;
 case 'butterfly_swap':if(has(t,'butterfly')){applyStatus(b,rec,a,'butterfly_swap',1,0,source,false,{other:t.id});applyStatus(b,rec,t,'butterfly_swap',1,0,source,false,{other:a.id});status(t,'butterfly')!.until=b.round+r.duration-1;}break;
 case 'dragon_domain':{const v=r.value+(cardOf(t.cardId).is_dragon?r.dragonExtra:0);flat(b,rec,t,{atk:v,dfs:v,sp_atk:v,sp_dfs:v,spd:v},source,r.duration);break;}
 case 'random_heal':{const n=r.min+Math.floor(random(b)*(r.max-r.min+1));heal(b,rec,a,n,skillDisplayName(s,a));if(n<=r.low)modifyStage(b,rec,a,{dfs:1,sp_dfs:1},source);else if(n>=r.high)modifyStage(b,rec,a,{sp_atk:2},source);else if(a.pp[s.id]>-1)a.pp[s.id]++;break;}
 case 'split':{const hp=Math.floor(a.hp*r.hpRatio);a.split=r.count;a.fragments=Array.from({length:r.count},()=>hp);a.fragmentMax=hp;a.hp=hp*r.count;notice(rec,a,'裂解为3个独立生命个体，每个继承50%当前生命，使用相同技能');break;}
 case 'evil_system':a.disabled=a.skills.filter(id=>skillOf(id).kind!=='attack');applyStatus(b,rec,a,'evil_system',null,0,source);break;
 case 'emp':if(random(b)<r.chance)applyStatus(b,rec,t,'stun',1,0,a.id,true);for(const u of b.units)u.statuses=u.statuses.filter(st=>{const origin=b.units.find(x=>x.id===st.source);return !origin||origin.side===a.side;});break;
 case 'high_frequency':if(action.option==='spell')modifyStage(b,rec,a,{dfs:-2,sp_atk:1,sp_dfs:1},source);else modifyStage(b,rec,a,{sp_dfs:-2,atk:2},source);applyStatus(b,rec,a,'high_frequency',r.duration,0,source,false,{option:action.option});a.elements=[action.option==='spell'?'雷':'战斗'];a.elementUntil=b.round+r.duration-1;break;
 case 'missing_all_stats':{const n=(maximum(a)-a.hp)*r.ratio;flat(b,rec,a,{hp:n,atk:n,dfs:n,sp_atk:n,sp_dfs:n,spd:n},source);break;}
 case 'seal_skill':if(t.skills.includes(action.copySkill!)){for(const u of b.units)u.statuses=u.statuses.filter(st=>st.id!=='sealed');applyStatus(b,rec,t,'sealed',r.duration,0,a.id,true,{skill:action.copySkill});}else notice(rec,a,'目标未携带该技能，封印失败');break;
 case 'choose_flat':flat(b,rec,a,{[action.attribute!]:r.value},source);break;
 case 'cost_cleanse':{const n=debuffCount(a);cleanse(a);directLoss(b,rec,a,n*r.cost,'归英敛华代价',false);break;}
 case 'tiger_finale':applyStatus(b,rec,a,'tiger_finale',1,0,source);break;
 case 'ice_core_mode':
  b.global.ice_ruthless=1;applyStatus(b,rec,a,'ice_ruthless',null,0,source);
  for(const u of b.units){const layers=iceLayers(u);if(!layers)continue;u.statuses=u.statuses.filter(st=>st.id!=='ice_seal');u.statuses.push({id:'ice_seal',source,until:b.round+2,debuff:false,value:layers,data:{ruthless:true}});u.counters['冰封']=layers;}
  notice(rec,a,'算式·无情已启动：冰封持续3回合，不再降低速度或提供免伤；每层附加20点最终固定伤害，仅非冰原核心的攻击消耗1层');break;
 case 'hell_energy':{
  b.global['hell_fire_bonus:'+a.side]=(b.global['hell_fire_bonus:'+a.side]??0)+r.teamFireBonus;
 const total=b.global['hell_fire_bonus:'+a.side];let marker=status(a,'hell_fire_bonus');if(!marker){a.statuses.push({id:'hell_fire_bonus',source:s.id,until:null,debuff:false,value:total});}else marker.value=total;
  applyStatus(b,rec,a,'reduction',1,r.reduction,source);
  if(a.lastSkill===s.id)directLoss(b,rec,a,r.repeatCost,'算式·炎能连续使用',false);
  notice(rec,a,'我方火属性攻击永久增伤累积至 '+Math.round(b.global['hell_fire_bonus:'+a.side]*100)+'%');break;
 }
 case 'hell_guidance':applyStatus(b,rec,a,'hell_guidance',r.duration,0,source);break;
 case 'hell_ray':applyStatus(b,rec,a,'hell_fire_hit',3,1,source,false,{starts:b.round+1});break;
 case 'weapon_choose':addWeapon(b,rec,a,action.option!);break;
 case 'weapon_reforge':removeWeapon(b,rec,a,action.option!,'重铸');addWeapon(b,rec,a,Object.keys(weaponLabels)[Math.floor(random(b)*Object.keys(weaponLabels).length)]);heal(b,rec,a,(maximum(a)-a.hp)*.35,skillDisplayName(s,a));break;
 case 'weapon_sacrifice':{
  const count=weaponCount(a),ally=t.side===a.side&&t.id!==a.id?t:undefined;
  for(const key of Object.keys(weaponLabels))while(a.counters['weapon:'+key])removeWeapon(b,rec,a,key,'舍身的架势');
  if(ally&&count&&alive(a)){const linkedSource=source+':'+a.id,n=Math.min(5,count),before=ally.stageModifiers.length;modifyStage(b,rec,ally,Object.fromEntries(stages.map(stat=>[stat,n])),linkedSource,1);for(const modifier of ally.stageModifiers.slice(before))if(modifier.source===linkedSource)modifier.until=null;}
  break;
 }
 case 'calamity_mark':{
  const used=rec.events.find(e=>e.kind==='action'&&e.actor===t.id)?.skill;
  (b.mentalMarks??=[]).push({owner:a.id,target:t.id,round:b.round,skills:used?[used]:[]});
  emit(rec,{kind:'notice',actor:a.id,text:'精神操控已秘密指定 '+cardOf(t.cardId).name+'；记录其本回合实际使用的技能，下次再次发动时触发灾厄',privateSide:a.side});
  applyStatus(b,rec,a,'control_immune',1,0,source);break;
 }
 case 'calamity_prophecy':applyStatus(b,rec,a,'calamity_prophecy',r.duration,0,source,false,{starts:b.round});break;
 case 'calamity_cap':applyStatus(b,rec,a,'calamity_cap',r.duration,0,source,false,{attacker:t.id});break;
 case 'calamity_immunity':applyStatus(b,rec,a,'calamity_immunity',r.duration,0,source);break;
 case 'calamity_pact':{
  const ally=b.units.find(u=>u.id===action.target&&u.side===a.side&&u.id!==a.id&&alive(u));
  if(ally){const total=a.hp+ally.hp,each=Math.floor(total/2);a.hp=Math.min(maximum(a),each);ally.hp=Math.min(maximum(ally),total-a.hp);applyStatus(b,rec,a,'calamity_pact',null,0,source,false,{partner:ally.id});applyStatus(b,rec,ally,'calamity_pact',null,0,source,false,{partner:a.id});notice(rec,a,'算式·契约：双方当前生命已平均分配');}
  break;
 }
 case 'death_slash':if((t.counters.death_energy??0)>t.hp){const current=t.hp;directLoss(b,rec,t,t.hp,'忘川渡人斩杀');if(a.counters.ghost_active)heal(b,rec,a,current,'幽冥忘川渡人',false);}break;
 case 'death_gaze':{
  const thresholds=a.counters.ghost_active?r.ghostThresholds:r.thresholds;let steal=0;
  for(let i=0;i<thresholds.length;i++)if(a.counters.ghost_active&&thresholds[i]===0||(t.counters.death_energy??0)>thresholds[i])steal=i+1;
  if(steal){modifyStage(b,rec,t,{sp_dfs:-steal},source);modifyStage(b,rec,a,{sp_dfs:steal},source);notice(rec,a,'三途凝望：吸取目标 '+steal+' 级魔抗');}break;
 }
 case 'death_fake_death':applyStatus(b,rec,t,'death_fake',r.duration,0,a.id,true,{starts:b.round,attempts:0,ghost:a.counters.ghost_active?1:0});break;
 case 'death_despair':applyStatus(b,rec,t,'death_despair',r.duration,0,a.id,true,{starts:b.round,owner:a.id,ghost:a.counters.ghost_active?1:0});break;
 }
}
function executeAction(b:Battle,rec:Settlement,a:Unit,action:Action,allActions:Action[],depth=0){
 if(depth>runtime.maxReactionDepth||b.endedRound)return;
 const parent=actionContexts.get(rec),sequence=(actionSequences.get(rec)??0)+1;actionSequences.set(rec,sequence);
 const context={id:b.round+':action:'+sequence,parentId:parent?.id};actionContexts.set(rec,context);
 try{
  performAction(b,rec,a,action,allActions,depth);
  const despairTarget=b.units.find(t=>alive(t)&&has(t,'death_despair')&&status(t,'death_despair')!.source===a.id&&(t.counters.death_energy??0)>t.hp);
  if(despairTarget){const despair=status(despairTarget,'death_despair')!,current=despairTarget.hp;directLoss(b,rec,despairTarget,current,'冥罗无妄：忘川渡人');if(despair.data?.ghost){heal(b,rec,a,current,'幽冥冥罗无妄',false);const id='death_reaper_5';if((a.pp[id]??-1)>=0)a.pp[id]=Math.min(skillOf(id).pp??0,a.pp[id]+1);}}
  if(cardNo(a)===30&&hasPassive(a,1)&&b.round%rules.alba_1.everyRounds===0&&depth===0&&alive(a)&&!b.endedRound){passive(rec,a,1,'第3倍数回合追加行动');extraAction(b,rec,a,'alba_1',allActions,depth+1);}
  (rec.completedActions??=[]).push(context.id);
  roundRuntimes.get(b)?.options.onFrame?.(checkpoint(b,rec));
 }finally{if(parent)actionContexts.set(rec,parent);else actionContexts.delete(rec);}
}
function performAction(b:Battle,rec:Settlement,a:Unit,action:Action,allActions:Action[],depth=0){
 if(depth>runtime.maxReactionDepth||b.endedRound)return;
 let s=skillOf(action.skill),r=rules[s.id]??{};
 const pp=a.pp[s.id]??-1;
 if(!availableSkills(a).includes(s.id)||a.disabled.includes(s.id)){notice(rec,a,'技能已被废除或不再可用');return;}
 if(r.noConsecutiveRounds&&a.counters['last_success:'+s.id]===b.round-1){notice(rec,a,'此技能不能连续两回合使用，行动未能发动');return;}
 if(has(a,'sealed')&&status(a,'sealed')!.data?.skill===s.id){notice(rec,a,'技能被封印，无法使用');return;}
 const ghostVersion=(a.counters.ghost_next??0)>0&&a.skills.includes(s.id);a.counters.ghost_active=0;
 const free=skillPpFree(a,s.id);
 const consumeCharge=(consumeGhost=true)=>{if(a.charged&&a.chargeUntil===b.round){a.charged=false;a.chargeUntil=0;if(s.id.startsWith('wuchang_'))a.chargeUntil=b.round+runtime.chargeChainTurns;}if(ghostVersion&&consumeGhost)a.counters.ghost_next=Math.max(0,(a.counters.ghost_next??0)-1);a.counters.ghost_active=0;};
 if(pp===0&&!free&&(a.counters.omni_pp??0)<=0){notice(rec,a,'技能PP耗尽，行动失败');return;}
 const extraPpSpent=a.counters.extra_pp??0,cost:ActionPpCost={amount:free?0:1,disasters:0};
 const payPp=()=>{
  if(cost.disasters){const omni=Math.min(a.counters.omni_pp??0,cost.amount);if(omni)a.counters.omni_pp-=omni;a.pp[s.id]=pp-(cost.amount-omni);}
  else if(!free){if((a.counters.omni_pp??0)>0)a.counters.omni_pp--;else if(pp>0)a.pp[s.id]=pp-1;}
  a.counters.extra_pp=0;
  if(extraPpSpent&&!free)spendExtraPp(rec,a,s.id,extraPpSpent);
  clearExhaustedEncore(a,rec);
 };
 a.counters.ghost_active=ghostVersion?1:0;
 a.counters.acted=b.round;
 const hellStun=status(a,'hell_stun'),freeze=status(a,'freeze'),isAttack=s.kind==='attack'&&r.isAttack!==false;
 const blockingControl=has(a,'stun')?'stun':hellStun&&Number(hellStun.data?.starts??0)<=b.round?'hell_stun':freeze&&Number(freeze.data?.starts??0)<=b.round?'freeze':has(a,'fear')&&isAttack?'fear':has(a,'lost_soul')&&isAttack?'lost_soul':undefined;
 if(blockingControl){if(['stun','fear','hell_stun'].includes(blockingControl))a.statuses=a.statuses.filter(x=>x.id!==blockingControl);if(r.controlConsumesPp)payPp();notice(rec,a,'受「'+statusLabel(blockingControl)+'」影响，行动受到控制，未能发动'+(r.controlConsumesPp?'（按技能说明消耗PP）':'（未消耗PP）'));consumeCharge(r.controlConsumesPp===true);return;}
 if(has(a,'death_fake')&&Number(status(a,'death_fake')!.data?.starts??0)<=b.round){
  const fake=status(a,'death_fake')!,attempt=Number(fake.data?.attempts??0),chances=rules.death_reaper_4.chances as number[],chance=chances[Math.min(attempt,chances.length-1)];
  if(random(b)<chance){a.statuses=a.statuses.filter(st=>st!==fake);applyStatus(b,rec,a,'death_fake_immune',2,0,fake.source,true,{starts:b.round});notice(rec,a,'假死解除：本回合及下回合免受假死影响');}
  else{fake.data={...fake.data,attempts:attempt+1};if(fake.data.ghost){a.counters.death_energy=(a.counters.death_energy??0)+rules.death_reaper_4.ghostEnergy;emit(rec,{kind:'status',target:a.id,text:'幽冥白夜尽墨：解除失败，获得100点死气',value:100});}if(attempt+1>=rules.death_reaper_4.tries)directLoss(b,rec,a,a.hp,'白夜尽墨：假死未解除');else notice(rec,a,'假死未解除，行动失败（第 '+(attempt+1)+' 次）');payPp();consumeCharge();return;}
 }
 for(const mark of [...(b.mentalMarks??[])].filter(mark=>mark.target===a.id&&mark.skills.includes(s.id))){
  b.mentalMarks=b.mentalMarks!.filter(m=>m!==mark);const core=b.units.find(u=>u.id===mark.owner)!;
  notice(rec,core,'精神操控记录的「'+skillDisplayName(s,a)+'」再次发动，触发灾厄');if(!triggerDisaster(b,rec,core,a,s.id,1,cost)){consumeCharge(false);return;}
 }
 for(const core of b.units.filter(x=>x.cardId==='calamity_core'&&x.side!==a.side&&alive(x))){
  const targets=targetsFor(b,a,s,r,action);
  const prophesied=has(core,'calamity_prophecy')&&Number(status(core,'calamity_prophecy')!.data?.starts??0)<=b.round;
  if(hasPassive(core,1)&&targets.some(t=>t.id===core.id)){passive(rec,core,1,'敌方行动指定自身，判定灾厄');if(!triggerDisaster(b,rec,core,a,s.id,rules.calamity_core_1.chance,cost)){consumeCharge();return;}}
  if(prophesied&&random(b)<rules.calamity_core_3.chance){passive(rec,core,3,'末日预言触发灾厄');if(!triggerDisaster(b,rec,core,a,s.id,1,cost)){consumeCharge();return;}}
 }
 for(const core of b.units.filter(x=>x.side!==a.side&&x.counters.core_disaster===1&&alive(x)&&targetsFor(b,a,s,r,action).some(t=>t.id===x.id))){notice(rec,core,'契约继承的指令·灾厄触发');if(!triggerDisaster(b,rec,core,a,s.id,rules.calamity_core_1.chance,cost)){consumeCharge();return;}}
 payPp();
 if(has(a,'death_despair')&&s.id==='charge'){
  const despair=status(a,'death_despair')!,ghost=Boolean(despair.data?.ghost);
  if(!ghost||random(b)<rules.death_reaper_5.ghostChargeBreakChance){a.statuses=a.statuses.filter(st=>st!==despair);notice(rec,a,'蓄力解除绝望');}
 }
 if(has(a,'spell_null')&&s.channel==='spell'&&s.kind==='attack'){const st=status(a,'spell_null')!;st.value--;if(st.value<=0)a.statuses=a.statuses.filter(x=>x!==st);notice(rec,a,'spell nullified; PP still consumed');consumeCharge();return;}
 if(cardNo(a)===29&&hasPassive(a,1)&&(a.counters['燃']??0)>0&&random(b)<clamp(a.counters['燃']*rules.lava_troll_1.chancePerCounter,0,1)){passive(rec,a,1,'lava rage: self stun and recover');heal(b,rec,a,rules.lava_troll_1.heal,'lava rage');modifyStage(b,rec,a,Object.fromEntries(stages.map(k=>[k,1])),'lava_troll_1');a.counters['燃']=0;consumeCharge();return;}
 if(r.requiresNoDamage&&a.damagedThisRound>0){if(r.refundOnFail&&pp>0)a.pp[s.id]++;notice(rec,a,'already damaged this round; action failed and PP refunded');consumeCharge();return;}
 revealSkill(a,s.id);emit(rec,{kind:'action',actor:a.id,skill:s.id,target:r.mechanic==='calamity_mark'?undefined:action.target,text:cardOf(a.cardId).name+' 使用 '+skillDisplayName(s,a)});
 for(const mark of b.mentalMarks??[])if(mark.target===a.id&&mark.round===b.round&&!mark.skills.length)mark.skills.push(s.id);
 if(s.id==='charge'){
  a.charged=true;a.chargeUntil=Math.max(a.chargeUntil,b.round+1);notice(rec,a,'蓄力完成：下回合攻击强化');
  for(const shark of enemy(b,a).filter(t=>t.cardId==='shark_king'&&t.skills.includes('shark_king_1'))){shark.counters['gate:'+a.id]=1;if(hasPassive(shark,1))passive(rec,shark,1,cardOf(a.cardId).name+' 已完成蓄力，可将自身选为单体攻击目标');}
  a.lastSkill=s.id;a.lastWasAttack=false;consumeCharge();return;
 }
 if(r.counterCost)a.counters[r.counterCost.name]-=r.counterCost.value;
 if(r.globalOnce)b.global[s.id]=1;
 if(r.removeShield){const t=b.units.find(t=>t.id===action.target);if(t){const links=t.shields.map(sh=>sh.linked).filter(Boolean);t.shields=[];t.modifiers=t.modifiers.filter(m=>!links.includes(m.source));t.stageModifiers=t.stageModifiers.filter(m=>!links.includes(m.source));}}
 if(r.mechanic==='attack_fixed')modifyStage(b,rec,a,{atk:-r.costStage},s.id);
 if(r.mechanic==='tail_sweep'){a.counters.tail_fixed=maximum(a)-a.hp;flat(b,rec,a,{hp:-(maximum(a)-a.hp)},s.id);}
 if(r.hpSet)a.hp=r.hpSet;
 if(s.id==='fire_wyvern_4'&&has(a,'dragon_dance'))modifyStage(b,rec,a,{atk:1},s.id);
 const ts=targetsFor(b,a,s,r,action).filter(t=>r.mechanic!=='ice_age'||t.side!==a.side&&iceLayers(t)>0);
 if(s.kind==='attack')for(const target of ts){if(cardNo(target)===16&&hasPassive(target,1)&&s.elements.some(e=>rules.treant_1.elements.includes(e))){passive(rec,target,1,'超能吸引：吸引元素攻击并强化');modifyStage(b,rec,target,rules.treant_1.stage,'treant_1');}}
 if(!ts.length){if(r.mechanic==='ice_age')finishIceAge(b,rec,a,s.id);else notice(rec,a,'目标已倒下，行动落空');consumeCharge();return;}
 if(s.kind==='support'||r.mechanic==='tiger_finale')for(const t of ts)executeSupport(b,rec,a,t,s,r,action,allActions);
 else{
  a.attackedThisRound=r.isAttack!==false;
  if(r.counter)a.counters[r.counter.name]=(a.counters[r.counter.name]??0)+r.counter.delta;
  let modifier=1;
  if(r.chance&&random(b)<r.chance){modifier*=r.chanceMultiplier;a.counters[r.counter?.name]=(a.counters[r.counter?.name]??0)+(r.chanceCounter??0);}
  if(r.mechanic==='dark_light'){const n=random(b);modifier*=n<1/3?r.low:n<2/3?r.high:1;}
  let dealt=0,nextAttack:NextAttackEffects|undefined;const targets=[...ts],attackId=newAttackId(rec);
  if(r.alsoSelf)targets.push(a);
  if(r.mechanic==='delayed_attack'){applyStatus(b,rec,a,'delayed_attack',2,0,s.id,false,{target:action.target,starts:b.round+1});a.lastSkill=s.id;a.lastWasAttack=true;consumeCharge();return;}
  const resetSpeed=cardNo(a)===17&&hasPassive(a,2)&&action.resetSpeed&&r.isAttack!==false&&effective(a,'spd')>a.base.spd;
  const speedReset=resetSpeed?Math.max(0,effective(a,'spd')-a.base.spd):0,speedBonus=speedReset*rules.shark_king_2.perSpeed;
  for(const t of targets){
   if(!alive(t)||!alive(a)||b.endedRound)continue;
   if(r.allyHeal&&t.side===a.side){const cloned=JSON.parse(JSON.stringify(b)) as Battle;const ca=cloned.units.find(u=>u.id===a.id)!,ct=cloned.units.find(u=>u.id===t.id)!;ct.hp=maximum(ct);const dr=damage(cloned,{round:b.round,events:[],order:[]},ca,ct,s,r,{noEffects:true});heal(b,rec,t,dr.rawDamage,'日光雨');continue;}
   const fragmentTargets=t.fragments?(s.target==='all_enemies'?t.fragments.map((v,i)=>v>0?i:-1).filter(i=>i>=0):[action.targetFragment??t.fragments.findIndex(v=>v>0)]):[];
   if(nextAttack===undefined){nextAttack=r.isAttack!==false?consumeNextAttack(a):{};if(speedBonus>0)passive(rec,a,2,'锦帆：以 '+Math.floor(speedReset)+' 点额外速度换取本次攻击伤害 +'+Math.round(speedBonus*100)+'%，本次攻击结算后重置速度，加成不保留');}
  let count=(r.hits??(r.hitsDefenseDivisor?r.hitsBase+Math.floor(pointValue(t,'dfs')/r.hitsDefenseDivisor):r.hitsCounter?r.hitsBase+(a.counters[r.hitsCounter]??0):1))*(fragmentTargets.length||1)*a.split;
  const iceRainBaseHits=count;if(r.mechanic==='ice_rain')count+=iceLayers(a)+iceLayers(t);
  const attackEs=attackElements(a,s,b.round,r.chooseElement?[action.element!]:undefined);
  const hellFireBonus=attackEs.some(e=>e==='火')?team(b,a).reduce((n,u)=>n+(has(u,'hell_fire_hit')&&Number(status(u,'hell_fire_hit')!.data?.starts??0)<=b.round?status(u,'hell_fire_hit')!.value:0),0):0;
  count+=hellFireBonus;
   let hits=count;for(let i=0;i<hits&&alive(t)&&alive(a)&&!b.endedRound;i++){
    let hitRule={...r};let hitSkill=s;if(r.chooseChannel)hitRule.channel=action.option;if(r.mechanic==='butterfly_six')hitRule.channel=a.form===2?'mixed':'physical';
    if(s.id==='wuchang_4'||s.id==='wuchang_5'){hitSkill={...s,channel:a.form===0?'spell':'physical',elements:[a.form===0?'灵':'战斗']};}
    if(s.id==='death_reaper_6'&&a.counters.ghost_active)hitSkill={...s,channel:'spell',elements:['灵']};
    if(r.mechanic==='thunder_judgment')hitRule={...hitRule};
    const p=r.mechanic==='thunder_judgment'?(s.power??0)+allActions.filter(ac=>ac.target===a.id).reduce((n,ac)=>n+(skillOf(ac.skill).power??0),0):undefined;
    const hitPower=r.mechanic==='ice_age'?iceLayers(t)*40:r.mechanic==='ice_rain'&&i>=iceRainBaseHits?10:p;
    const d=damage(b,rec,a,t,hitSkill,hitRule,{multiplier:modifier,power:hitPower,elements:r.chooseElement?[action.element!]:undefined,depth,fragment:fragmentTargets.length?fragmentTargets[i%fragmentTargets.length]:undefined,nextAttack,speedBonus,attackId});dealt+=d.hpLost;
    if(r.mechanic==='seal_skill'&&!d.missed&&alive(t))executeMechanic(b,rec,a,t,s,r,action,allActions);
    if(r.repeatOnCrit&&d.crit)hits++;
    if(hits>runtime.flashwing_max_hits){hits=runtime.flashwing_max_hits;notice(rec,a,'连击达到安全上限');}
    if(r.extraHit&&alive(t))damage(b,rec,a,t,s,r,{power:(s.power??0)*r.extraHit,depth,noEffects:true,nextAttack,speedBonus,attackId});
   }
  }
  if(r.mechanic==='calamity_immunity'&&alive(a))executeMechanic(b,rec,a,a,s,r,action,allActions);
  if(r.mechanic==='shark_blade')applyStatus(b,rec,a,'shark_blade',r.duration,r.value??0,s.id);
  if(r.mechanic==='ice_add'){for(const t of ts)addIce(b,rec,t,r.layers,s.id);addIce(b,rec,a,r.layers,s.id);}
  if(r.mechanic==='ice_age')finishIceAge(b,rec,a,s.id);
  if(r.mechanic==='death_scythe'&&!ghostVersion){a.counters.ghost_next=2;notice(rec,a,'死神之镰：接下来2次已装备技能的成功使用将强化为幽冥版本；鬼墨无忧的被动触发、撞击、蓄力和控制失败不消耗次数');}
  if(r.mechanic==='dark_light'){if(dealt>r.threshold){for(const t of ts.filter(alive))damage(b,rec,a,t,{...s,channel:'spell',power:r.bonusPower},{},{depth,nextAttack,speedBonus,attackId});}else extraAction(b,rec,a,s.id,allActions,depth+1,'support');}
  if(r.stageSelfAfter)modifyStage(b,rec,a,r.stageSelfAfter,s.id);
  if(r.firstStage&&ts.some(t=>t.counters.acted!==b.round))modifyStage(b,rec,a,r.firstStage,s.id);
  if(r.mechanic==='counter_team')for(const u of team(b,a))applyStatus(b,rec,u,'counter',r.duration,r.power,a.id);
  if(r.mechanic==='replace_skill'&&action.replaceTo&&action.replaceFrom){const recipient=b.units.find(t=>t.id===action.replacement&&t.side===a.side);if(recipient)applyStatus(b,rec,recipient,'replace_at_end',1,0,a.id,false,{from:action.replaceFrom,to:action.replaceTo});}
  if(r.mechanic==='hell_ray')applyStatus(b,rec,a,'hell_fire_hit',3,1,s.id,false,{starts:b.round+1});
  if(r.selfStatus)applyStatus(b,rec,a,r.selfStatus,r.duration??null,0,s.id,false,{round:b.round});
  if(r.mechanic==='ice_storm')for(const t of ts.filter(alive)){const actedSkill=allActions.find(ac=>ac.actor===t.id)?.skill;const attacked=actedSkill&&skillOf(actedSkill).kind==='attack';addIce(b,rec,t,1+(attacked?1:0),s.id);}
  if(r.extraWorstMissing){const worst=ts.filter(alive).sort((x,y)=>y.damagedThisRound-x.damagedThisRound)[0];if(worst)directLoss(b,rec,worst,(maximum(worst)-worst.hp)*r.extraWorstMissing,skillDisplayName(s,a));}
  if(cardNo(a)===29&&hasPassive(a,1)&&s.elements.includes('火')){a.counters['燃']=(a.counters['燃']??0)+1;passive(rec,a,1,'使用火攻获得燃');}
  if(cardNo(a)===9&&hasPassive(a,1)){a.elements=r.chooseElement?[action.element!]:[...s.elements];a.elementUntil=999;passive(rec,a,1,'召灵：变为本次攻击系别');}
  if(resetSpeed&&nextAttack!==undefined){a.modifiers=a.modifiers.filter(m=>m.stat!=='spd');a.stages.spd=0;a.stageModifiers=a.stageModifiers.filter(m=>m.stat!=='spd');notice(rec,a,'锦帆：本次攻击结算完毕，速度已重置，本次增伤已移除');}
  if(activeTalent(a,2)&&r.isAttack!==false)directLoss(b,rec,a,maximum(a)*.1,'生命宝珠代价',false);
  if(dealt>0)a.statuses=a.statuses.filter(st=>st.id!=='single_immunity');
  if(has(a,'next_aoe')){const st=status(a,'next_aoe')!;st.value--;if(st.value<=0)a.statuses=a.statuses.filter(x=>x!==st);}
 }
 if(r.clearCounter)a.counters[r.clearCounter]=0;
 if(r.resetStages){a.stages=Object.fromEntries(stages.map(s=>[s,0])) as Unit['stages'];a.stageModifiers=[];}
 if(s.kind==='attack'&&depth<runtime.maxReactionDepth){
  for(const hell of team(b,a).filter(u=>u.cardId==='hell_core'&&has(u,'hell_guidance')&&u.id!==a.id)){
   const guidance=status(hell,'hell_guidance')!;
   if(Number(guidance.data?.starts??0)<=b.round){passive(rec,hell,4,'精确制导：队友攻击后追加攻击');for(const target of ts.filter(alive))damage(b,rec,hell,target,{...skillOf('tackle'),id:'hell_core_4',name:'精确制导',elements:['火'],channel:'physical',power:60},{},{channel:'physical',elements:['火'],depth:depth+1});}
  }
 }
 a.counters['uses:'+s.id]=(a.counters['uses:'+s.id]??0)+1;a.lastSkill=s.id;a.lastWasAttack=s.kind==='attack';
 if(a.copied.includes(s.id)){a.copied=a.copied.filter(id=>id!==s.id);}
 consumeCharge();
}
export function settleRound(input:Battle,submitted:[Action[],Action[]],options:RoundOptions={}):Battle{
 const b=JSON.parse(JSON.stringify(input)) as Battle;
 for(const u of b.units)delete u.counters.speed_damage;
 validateActions(b,0,submitted[0]);validateActions(b,1,submitted[1]);
 const rec:Settlement={round:b.round,events:[],order:[]};b.endedRound=false;roundRuntimes.set(b,{options,reactionIndex:0});recordBattles.set(rec,b);
 for(const u of b.units)clearExhaustedEncore(u,rec);
 for(const u of b.units){u.counters.acted=0;u.counters.moon_hits=0;u.counters.awaken_round=0;u.counters.weakness_round=0;u.counters.primal_round=0;u.counters.rising_triggered=0;for(const key of Object.keys(u.counters))if(key.startsWith('calamity_turn_damage:'))delete u.counters[key];u.damagedThisRound=0;u.damageThisRound=0;u.attackedThisRound=false;u.aliveRounds++;u.history.push(u.hp);if(cardNo(u)===30&&u.hp<rules.alba_6.unlockHp)u.counters.alba_unlocked=1;
  const frost=status(u,'frostbite');if(frost&&Number(frost.data?.starts??0)<=b.round)directLoss(b,rec,u,maximum(u)*.1,'冻伤');
 }
 const allActions=JSON.parse(JSON.stringify(submitted.flat())) as Action[];b.plannedActions=allActions;
 const queue=allActions.map(action=>{const u=b.units.find(u=>u.id===action.actor)!;return {action,priority:priority(u,skillOf(action.skill)),speed:effective(u,'spd')*(b.global.trick_room_until>=b.round?-1:1),tie:random(b)};}).sort((a,c)=>c.priority-a.priority||c.speed-a.speed||a.tie-c.tie);
 rec.order=queue.map(x=>({actor:x.action.actor,skill:x.action.skill,speed:x.speed,priority:x.priority}));
 for(const q of queue){if(b.endedRound)break;const a=b.units.find(u=>u.id===q.action.actor)!;if(alive(a)){executeAction(b,rec,a,q.action,allActions);const delayed=status(a,'delayed_attack');if(delayed&&(delayed.data?.starts as number)===b.round){const target=b.units.find(u=>u.id===delayed.data?.target&&alive(u));if(target)damage(b,rec,a,target,skillOf('flashwing_6'),rules.flashwing_6);a.statuses=a.statuses.filter(st=>st!==delayed);}}else if(a.counters.ghost_actions){a.dead=false;a.hp=1;for(let i=0;i<2&&alive(a);i++)executeAction(b,rec,a,q.action.extra?.[i]??q.action,allActions);a.hp=0;a.dead=true;a.counters.ghost_actions=0;}
  for(const u of b.units)if(cardNo(u)===30&&u.hp<rules.alba_6.unlockHp)u.counters.alba_unlocked=1;
 }
 roundEnd(b,rec,allActions);resolveWinner(b);
 if(b.winner===null&&allLivingSkillsExhausted(b)){b.winner='draw';emit(rec,{kind:'notice',text:'全场存活角色的可用技能PP均已耗尽，本局平局。'});}
 if(b.round>=runtime.maxBattleRounds&&b.winner===null){b.winner='draw';emit(rec,{kind:'notice',text:'达到配置的300回合上限，本局平局。'});}b.records.push(rec);b.round++;delete b.plannedActions;return b;
}
function roundEnd(b:Battle,rec:Settlement,actions:Action[]){
 b.mentalMarks=b.mentalMarks?.filter(mark=>mark.skills.length>0);
 for(const u of b.units.filter(alive)){
  if(u.cardId==='sword_dance'&&(u.counters['weapon:moon_blade']??0)>0){const targets=enemy(b,u);if(targets.length){const target=targets[Math.floor(random(b)*targets.length)];damage(b,rec,u,target,{...skillOf('tackle'),id:'sword_dance_1',name:'削月刀',elements:['战斗'],power:80},{},{channel:'physical',depth:1});}}
  if(hasPassive(u,1)&&cardNo(u)===1){passive(rec,u,1,'龙族誓愿');for(const t of enemy(b,u).filter(t=>t.hp<=u.hp))directLoss(b,rec,t,rules.heinrich_1.value,'龙族誓愿');}
  if(hasPassive(u,1)&&cardNo(u)===10){passive(rec,u,1,'雷灵战鼓');directLoss(b,rec,u,maximum(u)*rules.thunder_dragon_1.selfMaxCost,'雷灵战鼓',false);u.counters['雷痕']=(u.counters['雷痕']??0)+rules.thunder_dragon_1.counter;}
  if(hasPassive(u,1)&&cardNo(u)===14){u.counters.flame_growth=(u.counters.flame_growth??0)+rules.vermilion_1.perRound;passive(rec,u,1,'焚灭天火：伤害成长');}
  if(hasPassive(u,1)&&cardNo(u)===20){passive(rec,u,1,'古神血脉');directLoss(b,rec,u,rules.leviathan_1.cost,'古神血脉',false);for(const t of team(b,u)){const v=rules.leviathan_1.value;flat(b,rec,t,{atk:v,dfs:v,sp_atk:v,sp_dfs:v,spd:v},'leviathan_1');}}
  if(hasPassive(u,6)&&cardNo(u)===19){passive(rec,u,6,'无常回合末');if(u.form===0)heal(b,rec,u,enemy(b,u).reduce((n,t)=>n+debuffCount(t),0)*rules.wuchang_6.perDebuff,'无常伞边残花泪');else for(const t of enemy(b,u))directLoss(b,rec,t,debuffCount(t)*rules.wuchang_6.perDebuff,'南台桥下东风遥');}
  if(activeTalent(u,5)){talent(rec,u,5,'回合末回复8%最大生命');heal(b,rec,u,maximum(u)*.08,'妖精之风');}
  if(activeTalent(u,9)&&u.damageThisRound===0){talent(rec,u,9,'未造成伤害，双防降低，攻魔暴速提升');modifyStage(b,rec,u,{dfs:-1,sp_dfs:-1,atk:1,sp_atk:1,crit:1,spd:1},'talent_9');}
  if(has(u,'silent_water'))modifyStage(b,rec,u,u.damagedThisRound?{atk:1,sp_atk:1}:{dfs:1,sp_dfs:1},'heinrich_3');
  if(has(u,'poison'))directLoss(b,rec,u,u.attackedThisRound?rules.venom_scorpion_2.attacking:rules.venom_scorpion_2.normal,'剧毒');
  if(has(u,'corrosion')){const st=status(u,'corrosion')!,owner=b.units.find(x=>x.id===st.source);const lost=directLoss(b,rec,u,st.value,'腐蚀');if(owner)heal(b,rec,owner,lost,'腐蚀吸取');flat(b,rec,u,{dfs:-rules.slime_5.defense,sp_dfs:-rules.slime_5.defense},'slime_5');}
  if(has(u,'flower_drain')){const st=status(u,'flower_drain')!,owner=b.units.find(x=>x.id===st.source);if(owner&&alive(owner)){flat(b,rec,u,{atk:-st.value,sp_atk:-st.value,dfs:-st.value,sp_dfs:-st.value},'soul_luoxi_2');flat(b,rec,owner,{atk:st.value,sp_atk:st.value,dfs:st.value,sp_dfs:st.value},'soul_luoxi_2');}}
  if(has(u,'tiger_finale')&&alive(u)){const r=rules.white_tiger_6,power=Math.max(0,r.powerBase-u.hp),nextAttack=consumeNextAttack(u);for(const t of enemy(b,u))damage(b,rec,u,t,{...skillOf('white_tiger_6'),power,kind:'attack',channel:'physical',target:'all_enemies'}, {lifesteal:r.lifesteal},{power,nextAttack});}
  if(has(u,'replace_at_end')){const st=status(u,'replace_at_end')!,from=st.data?.from as string,to=st.data?.to as string;u.skills=u.skills.map(id=>id===from?to:id);u.pp[to]??=skillOf(to).pp!;emit(rec,{kind:'notice',actor:u.id,text:'水流喷射：已替换为 '+skillOf(to).name,privateSide:u.side});}
  if(u.charged&&u.chargeUntil<b.round)u.charged=false;
 }
 for(const u of b.units){
  if(u.counters.extra_pp_round===b.round){u.counters.extra_pp=0;delete u.counters.extra_pp_round;}
  const ice=status(u,'ice_seal');if(ice?.until!==null&&ice?.until!==undefined&&ice.until<=b.round)removeIce(b,rec,u,iceLayers(u),'持续时间结束');
  const expired=u.stageModifiers.filter(m=>m.until!==null&&m.until<=b.round);for(const m of expired)emit(rec,{kind:'stage',target:u.id,text:m.stat+' 临时等级效果到期'});
  u.stageModifiers=u.stageModifiers.filter(m=>m.until===null||m.until>b.round);u.modifiers=u.modifiers.filter(m=>m.until===null||m.until>b.round);u.statuses=u.statuses.filter(s=>s.until===null||s.until>b.round);u.counters['冰封']=iceLayers(u);
  if(u.elementUntil!==null&&u.elementUntil<=b.round){u.elements=[...cardOf(u.cardId).elements];u.elementUntil=null;}
  if(u.chargeUntil===b.round){u.chargeUntil=0;u.charged=false;}
  if(has(u,'fire_next')&&(status(u,'fire_next')!.data?.starts as number)===b.round+1){u.elements=['火'];u.elementUntil=b.round+1;}
  u.hp=Math.min(u.hp,maximum(u));u.counters['previous:physical']=u.counters['received:physical']??0;u.counters['previous:spell']=u.counters['received:spell']??0;u.counters['received:physical']=u.counters['received:spell']=0;
 }
}
export function defaultActions(b:Battle,side:Side):Action[]{
 return b.units.filter(u=>u.side===side&&alive(u)&&!preplannedUnable(u,b.round)).map(u=>{
  const forced=activeEncore(u,b.round)?.data?.skill;
  if(typeof forced==='string'){const action=defaultSkillAction(b,u,forced);if(action)return action;}
  let target=enemy(b,u).sort((a,c)=>a.hp-c.hp)[0]?.id;if(has(u,'taunt'))target=status(u,'taunt')!.source;
  const proposed:Action={actor:u.id,skill:'tackle',target};
  try{validateOneAction(b,u,proposed);return proposed;}catch{return {actor:u.id,skill:'charge',target:u.id};}
 });
}




