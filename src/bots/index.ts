import {cardOf,exclusiveTalentId,skillOf,stages,talents} from '../shared/catalog';
import {attackTargetMode} from '../shared/combat-presentation';
import {preplannedUnable,ReactionRequired,rules,settleRound,skillRestriction,supportTarget,validateExtraAction,validateOneAction} from '../shared/engine';
import {alive,availableSkills,effective,stageValue} from '../shared/primitives';
import {projectUnit} from '../shared/projection';
import type {Action,Battle,GameMode,Loadout,PublicUnit,ReactionDecision,ReactionRequest,RoomView,Side,Stage,Unit} from '../shared/types';
import {seededRandom,seedOf,shuffled} from './random';

export type BotStrategy='greedy'|'random';
/** No battle seed, opponent submissions, hidden skills/talent, or secret mental marks. */
export interface BotObservation {
 side:Side;round:number;units:PublicUnit[];global:Record<string,number>;
 declaredSkills?:{actor:string;skill:string}[];
}
export interface BotOptions { strategy:BotStrategy;seed:number }
export function observeBattle(b:Battle,side:Side):BotObservation{
 return {side,round:b.round,units:b.units.map(u=>projectUnit(u,side,b)),global:Object.fromEntries(Object.entries(b.global).filter(([key])=>key==='trick_room_until'||Boolean(rules[key]?.globalOnce)||key.startsWith('hell_fire_bonus:')||key==='ice_ruthless'))};
}
/** Adapter for the same projected room messages used by a human client. */
export function observeRoom(room:RoomView):BotObservation{
 const global:Record<string,number>={};
 for(const unit of room.units)for(const st of unit.statuses){
  if(st.id==='ice_ruthless'||st.id==='ice_seal'&&st.data?.ruthless)global.ice_ruthless=1;
 }
 for(const record of room.records)for(const event of record.events){
  if(event.kind==='action'&&event.skill&&rules[event.skill]?.globalOnce)global[event.skill]=1;
  if(event.kind==='action'&&event.skill==='laplace_2'&&record.round+2>=room.round)global.trick_room_until=record.round+2;
 }
 return {side:room.side,round:room.round,units:structuredClone(room.units),global,declaredSkills:room.declarations?.locked.map(({actor,skill})=>({actor,skill}))};
}
/** Reconstruct a policy-only state using exactly the supplied visible information. */
function visibleBattle(view:BotObservation):Battle{
 const units=view.units.map(p=>{
  const {effective:_,maxHp,preplannedUnable:__,skillRestrictions:___,targetRestrictions:____,actionHints:_____,...u}=structuredClone(p);
  return {...u,talent:u.talent??0,allocation:u.allocation??{}} as Unit;
 });
 return {round:view.round,units,global:{...view.global},seed:seedOf('public-preview',view.round),winner:null,records:[],endedRound:false};
}

/** Enumerate useful legal choices; the engine remains the final validator. */
export function legalBotActions(view:BotObservation,actor:string,allowedSkills?:string[]):Action[]{
 const b=visibleBattle(view),u=b.units.find(u=>u.id===actor);
 if(!u||u.side!==view.side||!alive(u)||preplannedUnable(u,b.round))return [];
 const actions:Action[]=[],seen=new Set<string>();
 for(const id of [...new Set(availableSkills(u))]){
  if(allowedSkills&&!allowedSkills.includes(id)||view.units.find(p=>p.id===actor)?.skillRestrictions?.[id]||skillRestriction(b,u,id))continue;
  const s=skillOf(id),r=rules[id]??{},mode=attackTargetMode(u,s,b.round,s.kind==='support'?supportTarget(s):s.target);
  const targets=b.units.filter(alive).filter(t=>!(s.kind==='attack'&&['single','any'].includes(mode)&&view.units.find(p=>p.id===t.id)?.blockedAttackers?.includes(u.id))).filter(t=>mode==='self'?t.id===u.id:mode==='ally'?t.side===u.side&&t.id!==u.id:mode==='ally_or_self'||mode==='all_allies'?t.side===u.side:mode==='any'?true:mode==='all_except_self'?t.id!==u.id:t.side!==u.side);
  // All area choices share targets: avoid weighting them multiple times in random policy.
  const selectedTargets=mode.startsWith('all_')?targets.slice(0,1):targets;
  for(const target of selectedTargets){
   const base:Action={actor,skill:id,target:target.id};
   let variants:Action[]=[base];
   const expand=(options:Partial<Action>[])=>{variants=variants.flatMap(a=>options.map(o=>({...a,...o})));};
   if(r.mechanic==='repeat_stages')expand(b.units.filter(alive).map(t=>({secondaryTarget:t.id})));
   if(r.chooseElement)expand(['水','火','土','风','草','雷'].map(element=>({element})));
   if(r.chooseChannel||r.mechanic==='high_frequency')expand(['physical','spell'].map(option=>({option})));
   if(r.mechanic==='weapon_choose')expand((r.weapons as string[]).map(option=>({option})));
   if(r.mechanic==='weapon_reforge')expand(Object.keys(u.counters).filter(k=>k.startsWith('weapon:')&&u.counters[k]>0).map(k=>({option:k.slice(7)})));
   if(r.mechanic==='copy_field')expand(['0','1','2'].map(option=>({option})));
   if(r.mechanic==='choose_flat')expand((['atk','dfs','sp_atk','sp_dfs','spd'] as Stage[]).map(attribute=>({attribute})));
   // The full species skill list is public; guessing unrevealed equipped skills is legal.
   if(r.mechanic==='prophecy'||r.mechanic==='seal_skill')expand(cardOf(target.cardId).skills.filter(s=>r.mechanic==='seal_skill'||s.timing!=='passive').map(s=>({copySkill:s.id})));
   if(r.mechanic==='stage_allocation')expand(stages.flatMap(from=>stages.map(to=>({allocation:{[from]:r.stages},boostAllocation:{[to]:r.stages}}))));
   if(r.mechanic==='replace_skill'){
    const replacements:Partial<Action>[]=[{}];
    for(const ally of b.units.filter(t=>t.side===u.side&&alive(t)))for(const from of ally.skills)for(const to of cardOf(ally.cardId).skills.filter(s=>!ally.skills.includes(s.id)&&!rules[s.id]?.unavailable))replacements.push({replacement:ally.id,replaceFrom:from,replaceTo:to.id});
    expand(replacements);
   }
   if(u.cardId==='shark_king'&&u.skills.includes('shark_king_2')&&s.kind==='attack'&&effective(u,'spd')>u.base.spd)expand([{}, {resetSpeed:true}]);
   if(target.fragments&&mode==='single')expand(target.fragments.flatMap((hp,i)=>hp>0?[{targetFragment:i}]:[]));
   for(const action of variants){try{validateOneAction(b,u,action,true);const key=JSON.stringify(action);if(!seen.has(key)){actions.push(action);seen.add(key);}}catch{/* Invalid guesses/targets are omitted, never submitted. */}}
  }
 }
 return actions;
}

function quickActionScore(b:Battle,a:Action){
 const u=b.units.find(u=>u.id===a.actor)!,t=b.units.find(u=>u.id===a.target),s=skillOf(a.skill);
 if(s.kind==='support')return a.skill==='charge'?2:5;
 const attack=s.channel==='spell'?effective(u,'sp_atk'):effective(u,'atk'),defense=t?effective(t,s.channel==='spell'?'sp_dfs':'dfs'):300;
 return (s.power??100)*attack/Math.max(150,defense)+(t?Math.max(0,1-t.hp/effective(t,'hp'))*30:0);
}
function randomChoice(actions:Action[],random:()=>number){
 const skills=[...new Set(actions.map(a=>a.skill))],skill=skills[Math.floor(random()*skills.length)],variants=actions.filter(a=>a.skill===skill);
 return structuredClone(variants[Math.floor(random()*variants.length)]);
}
function scoreState(b:Battle,side:Side){
 if(b.winner!==null)return b.winner==='draw'?0:b.winner===side?100000:-100000;
 let score=0;
 for(const u of b.units){
  const sign=u.side===side?1:-1;if(!alive(u)){score-=sign*1800;continue;}
  let value=1000*u.hp/effective(u,'hp')+u.hp*.15;
  value+=stages.reduce((n,s)=>n+stageValue(u,s)*(s==='crit'?13:25),0);
  value+=u.modifiers.reduce((n,m)=>n+m.delta*(m.stat==='hp'?.08:.1),0);
  value+=u.shields.reduce((n,s)=>n+Math.min(s.value,500)*.15+15,0);
  value+=(u.counters.weapon_count??0)*35+(u.counters.ghost_next??0)*30+(u.counters['雷痕']??0)*12;
  value+=u.charged?45:0;
  for(const st of u.statuses)value+=st.debuff?-25:st.id==='dormant'?75:st.id==='evil_system'?70:st.id==='calamity_immunity'?0:12;
  score+=sign*value;
 }
 return score;
}
function simpleReaction(b:Battle,request:ReactionRequest):ReactionDecision{
 if(request.kind==='sacrifice'){
  const guard=b.units.find(u=>u.id===request.actor)!,target=b.units.find(u=>u.id===request.target)!;
  return request.incomingDamage>=target.hp&&guard.hp>request.sacrificeCost;
 }
 const view=observeBattle(b,request.side),actions=legalBotActions(view,request.actor,request.allowedSkills);
 return actions.sort((a,c)=>quickActionScore(b,c)-quickActionScore(b,a))[0]??request.defaultAction;
}
function preview(input:Battle,submitted:[Action[],Action[]]){
 const decisions:Record<string,ReactionDecision>={};
 for(let i=0;i<128;i++)try{return settleRound(input,submitted,{interactive:true,decisions});}catch(e){
  if(!(e instanceof ReactionRequired))throw e;
  decisions[e.request.id]=simpleReaction(e.battle,e.request);
 }
 throw Error('人机预演响应次数超过128次');
}
function baseline(view:BotObservation,b:Battle,side:Side){
 const otherView:BotObservation={...view,side};
 return b.units.filter(u=>u.side===side&&alive(u)&&!preplannedUnable(u,b.round)).map(u=>{
  const declared=view.declaredSkills?.find(d=>d.actor===u.id)?.skill;
  // Only visible opposing moves are available here, never the sealed submissions.
  let choices=legalBotActions(otherView,u.id);if(declared&&choices.some(a=>a.skill===declared))choices=choices.filter(a=>a.skill===declared);
  const best=choices.sort((a,c)=>quickActionScore(b,c)-quickActionScore(b,a))[0];
  if(!best)throw Error('角色 '+u.id+' 没有合法行动');return best;
 });
}
export function chooseBotActions(view:BotObservation,options:BotOptions):Action[]{
 const random=seededRandom(options.seed),b=visibleBattle(view),own=b.units.filter(u=>u.side===view.side&&alive(u)&&!preplannedUnable(u,b.round));
 const groups=own.map(u=>legalBotActions(view,u.id));
 if(groups.some(g=>!g.length))throw Error('人机没有合法行动：'+own[groups.findIndex(g=>!g.length)].id);
 if(options.strategy==='random')return groups.map(g=>randomChoice(g,random));
 const foe=baseline(view,b,(1-view.side) as Side),chosen=groups.map(g=>[...g].sort((a,c)=>quickActionScore(b,c)-quickActionScore(b,a))[0]);
 for(let i=0;i<groups.length;i++){
  let best=chosen[i],value=-Infinity;
  for(const action of shuffled(groups[i],random)){
   const proposed=chosen.map((a,j)=>j===i?action:a),submitted:[Action[],Action[]]=view.side===0?[proposed,foe]:[foe,proposed];
   const result=preview(b,submitted);let score=scoreState(result,view.side);
   const pp=own[i].pp[action.skill]??skillOf(action.skill).pp??-1;
   if(pp>0)score-=3/pp; // Small tie-break in favour of conserving scarce PP.
   if(score>value){value=score;best=action;}
  }
  chosen[i]=best;
 }
 return structuredClone(chosen);
}
export function chooseBotReaction(view:BotObservation,request:ReactionRequest,options:BotOptions):ReactionDecision{
 if(request.side!==view.side)throw Error('不能响应另一方的决策');
 if(request.kind==='sacrifice')return options.strategy==='random'?seededRandom(options.seed)()>=.5:simpleReaction(visibleBattle(view),request);
 const candidates=legalBotActions(view,request.actor,request.allowedSkills);
 if(!candidates.length)return structuredClone(request.defaultAction);
 const b=visibleBattle(view);
 const action=options.strategy==='random'?randomChoice(candidates,seededRandom(options.seed)):candidates.sort((a,c)=>quickActionScore(b,c)-quickActionScore(b,a))[0];
 validateExtraAction(b,request,action);return structuredClone(action);
}
export function chooseBotPick(pool:readonly string[],picked:readonly string[],options:BotOptions){
 const available=pool.filter(id=>!picked.includes(id));if(!available.length)throw Error('没有可选角色');
 const random=seededRandom(options.seed);if(options.strategy==='random')return available[Math.floor(random()*available.length)];
 return shuffled(available,random).sort((a,c)=>cardScore(c)-cardScore(a))[0];
}
function cardScore(id:string){const c=cardOf(id);return c.stats.hp*.4+c.stats.atk+c.stats.sp_atk+(c.stats.dfs+c.stats.sp_dfs)*.5+c.stats.spd*.5+c.skills.filter(s=>s.kind==='attack').reduce((n,s)=>n+(s.power??100)*(s.target==='all_enemies'?1.3:1),0)*.25;}
export function chooseBotLoadout(cardId:string,mode:GameMode,options:BotOptions):Loadout{
 const c=cardOf(cardId),random=seededRandom(options.seed),locked=exclusiveTalentId(c);
 const skills=mode==='quick'?c.skills:options.strategy==='random'?shuffled(c.skills,random).slice(0,4):[...c.skills].sort((a,b)=>{
  const score=(s:typeof a)=>s.timing==='passive'?130:s.kind==='attack'?(s.power??110)+(s.target==='all_enemies'?35:0):105;
  return score(b)-score(a);
 }).slice(0,4);
 const common=talents.filter(t=>!t.exclusive&&t.available);
 const talent=locked??(mode==='quick'?0:options.strategy==='random'?common[Math.floor(random()*common.length)].id:2);
 return {cardId,skills:skills.map(s=>s.id),talent,...(talent===6?{allocation:{atk:100,sp_atk:100,spd:100}}:{})};
}
/** Room adapters can use these functions without depending on simulation/reporting code. */
export function createBot(options:BotOptions){return {
 strategy:options.strategy,
 chooseActions:(view:BotObservation)=>chooseBotActions(view,{...options,seed:seedOf(options.seed,'turn',view.round)}),
 react:(view:BotObservation,request:ReactionRequest)=>chooseBotReaction(view,request,{...options,seed:seedOf(options.seed,request.id)}),
 pick:(pool:readonly string[],picked:readonly string[])=>chooseBotPick(pool,picked,{...options,seed:seedOf(options.seed,picked.length)}),
 loadout:(id:string,mode:GameMode)=>chooseBotLoadout(id,mode,{...options,seed:seedOf(options.seed,id)}),
};}
