import {skillOf} from '../shared/catalog';
import {rules,statusLabel} from '../shared/engine';
import type {PublicUnit,Status} from '../shared/types';

const percent=(value:number)=>Math.round(value*100)+'%';
export function effectDescription(st:Status){
 const descriptions:Record<string,string>={
  fear:'持续期间下一次攻击失效且不消耗PP，触发一次后移除；法术和蓄力可正常使用，未触发则持续时间结束时移除。',stun:'本回合内下一次行动失效且不消耗PP；触发一次后移除，未触发则回合结束时移除。',freeze:'施加当回合不影响行动；下回合无法行动，无需提交技能且不消耗PP，至下回合结束移除。',
  madness:'只能选择攻击技能，生命回复转为生命损失。',encore:'必须重复指定技能。',sealed:'指定技能无法使用。',taunt:'单体攻击只能指定嘲讽来源。',
  wet:'水、草、雷系来袭伤害提高50%；自身火、战斗系伤害降低30%。',slow:'速度降低'+percent(st.value||.3)+'。',paralysis:'速度除以1.2。',illusion:'攻击有概率失效。',
  poison:'回合末失去生命；本回合发动攻击时损失更多。',heartache:'每次属性等级变化时失去最大生命值的'+percent(st.value)+'。',
  stiff:'不能回复生命或获得属性增益。',lost_soul:'攻击失效，不能造成伤害。',lost_spirit:'受到的伤害与减益效果乘以2。',
  soul_paralysis:'招式威力降低'+st.value+'。',rose_seal:'被动技能和特性被封印。',
  dormant:'下一次攻击伤害乘以2.5，在攻击发动前受到的伤害乘以0.4。',
  next_aoe:'接下来'+st.value+'次攻击变为群体攻击。',next_power_down:'下一次攻击威力降低'+st.value+'。',power_down:'攻击威力降低'+st.value+'。',
  next_block:'下一次受到的伤害减少'+st.value+'点。',reduction:'受到的伤害降低'+percent(st.value)+'。',critical_wind:'暴击率提高'+percent(st.value)+'。',
  divine_descent:'受到的物理伤害降低'+percent(st.value)+'；每次使用攻击技能对每个受伤目标至多吸取1次魔抗，每次1级。',spell_null:'接下来'+st.value+'次魔法攻击失效，仍消耗PP。',
  recoil:'造成伤害后，自身失去本次实际伤害'+percent(st.value)+'的生命。',magnetized:'受到雷系攻击时，有'+percent(st.value)+'的概率眩晕。',
  tornado_target:'本回合，敌方原本以己方角色为目标的招式，将转向龙卷阵指定的目标。',
  corrosion:'每回合被吸取'+st.value+'点生命，并降低物防、魔抗。',
  control_immune:'免疫异常效果。',evil_system:'非攻击技能已废除；受攻击后获得一次即时攻击行动。',
  next_first:'生效回合获得先发。',defer_next:'生效回合获得后发。',fire_next:'生效回合自身及攻击均视为火系。',
  delayed_attack:'下回合行动后发动延迟攻击；发动前受到的伤害降低70%。',
  single_immunity:'免疫单体攻击，自身造成伤害后解除。',mixed_conversion:'相关攻击以物理与魔法混合伤害结算。',
  counter:'敌方每次攻击对本角色至多触发1次战斗系物理反击，多段伤害不重复触发；由本角色反击，当前反击威力'+st.value+'。',lifesteal:'攻击后按比例回复生命。',
  evasion:'按双方速度差计算闪避概率。',reflect:'受到的伤害反弹给攻击者。',
  target_swap:'本回合攻击目标发生转移。',butterfly_swap:'本回合与另一名角色交换受击目标。',
  flower_drain:'每回合被吸取物攻、魔攻、物防和魔抗各40点。',flower_self:'免疫异常效果，并每回合吸取目标物攻、魔攻、物防和魔抗各40点。',
  high_frequency:st.data?.option==='spell'?'雷系武装：电磁炮伤害提高50%，不消耗PP。':'战斗系武装：撞击伤害提高100%。',
  declaration:'选招时先锁定并公开技能名称，对方获得额外30秒决策时间。',
  water_spirit:'受到的伤害不超过攻击威力的1.8倍；自身攻击伤害不低于威力的1.2倍。',
  silent_water:'回合末若受到过伤害，物攻和魔攻各提高1级；否则物防和魔抗各提高1级。',
  holy_blessing:'下一次受到伤害大于180点的攻击时，使该次攻击的伤害及附加效果无效，魔攻与速度各提高1级。',
  low_pressure:'受到伤害后，使伤害来源的物防降低1级。',rising_air:'本回合受到伤害后，速度额外提高1级。',
  sacred:'上回合受到过同类伤害时，本次受到的该类伤害降低35%。',
  forest_domain:'单次受到的伤害最多为'+st.value+'点。',
  dragon_dance:'速度提高，龙翼撕裂发动前额外提高物攻。',shark_blade:'鲸鲨弑神刃威力提高'+st.value+'，并获得先发。',
  butterfly:'与施加者相互攻击时，攻击威力提高；可触发返魂蝶相关效果。',
  slime_redirect:'吸引敌方非灵系、非战斗系攻击；本回合黑暗源流伤害提高150%。',
  hundred_rounding:'输出伤害向上取整至100的倍数；承受伤害高于100点时才向下取整，不高于100点时保持原值。',
  space_rift:'本回合行动后免疫攻击，下回合攻击附加目标已损失生命值比例的固定伤害。',
  tiger_finale:'本回合死亡则满血复活并终止回合，恢复其他技能PP但不恢复风起白虎潭PP；存活则在回合末群攻并吸血。',
  silver_physical:'造成的物理伤害减半；混合伤害仅物理部分减半，不可叠加。',silver_spell:'造成的法术伤害减半；混合伤害仅法术部分减半，不可叠加。',
  replace_at_end:'本回合结束时执行已选择的技能替换。',
 };
 Object.assign(descriptions,{ice_ruthless:'冰封持续3回合，叠加时刷新；不降低速度或提供免伤。物理攻击每次附加冰封层数×20点最终固定伤害，仅非冰原核心的攻击消耗1层。',frostbite:'物攻、魔攻各降低1级，速度降低2级；从下回合开始，每回合开始失去最大生命值的10%。持续至所示回合结束，不可叠加。',calamity_prophecy:'敌方每次行动有33%概率触发灾厄；其他角色死亡时，获得其五种对应基础属性数值的15%。',calamity_pact:'任一契约角色死亡时，另一方继承其剩余PP作为全能PP；符合条件的核心队友还会继承指令·灾厄。',calamity_immunity:'本回合免疫所有效果。',calamity_cap:'本回合受到灵魂震颤指定角色造成的伤害累计至多100点。',hell_stun:'生效回合无法行动，无需选择或提交技能。',death_fake_immune:'免受假死效果影响。',hell_fire_bonus:'我方火属性攻击永久增伤 '+percent(st.value)+'。',hell_guidance:'本回合及下回合，队友每次使用攻击技能后追加1次威力60的火属性物理攻击。',hell_fire_hit:'火属性攻击的伤害次数额外增加1次。',death_fake:'接下来4次行动前依次判定20%、40%、60%、80%解除；未解除时行动失败。',death_despair:'死气提高所受法术伤害；蓄力有概率解除。'});
 let text=descriptions[st.id]??'效果持续生效，具体规则见来源技能。';
 if(['encore','sealed'].includes(st.id)&&typeof st.data?.skill==='string')text=(st.id==='encore'?'必须使用':'无法使用')+'「'+skillOf(st.data.skill).name+'」。'+(st.id==='encore'?'该技能PP耗尽时自动解除，可自由选择技能。':'');
 return text;
}
export function unitEffects(u:PublicUnit,round:number){
 const effects:{id:string;label:string;description:string;debuff?:boolean}[]=[];
 if(u.charged)effects.push({id:'charge',label:'蓄力',description:'下回合攻击威力获得1.5倍蓄力加成；不减免PP，也不能使用PP为0的技能，明确写明的技能专属效果除外。'});
 for(const key of ['雷痕','燃'])if(u.counters[key]!==undefined||key==='雷痕'&&u.cardId==='thunder_dragon'||key==='燃'&&u.cardId==='lava_troll')effects.push({id:key,label:key+' ×'+(u.counters[key]??0),description:key==='雷痕'?'当前可消耗的雷痕层数；钻心咒等技能会消耗雷痕。':'每层提高火系输出与自身承伤，并影响熔岩巨魔的专属技能。'});
 const ice=u.statuses.filter(st=>st.id==='ice_seal'),layers=ice.reduce((n,st)=>n+st.value,0),until=Math.max(...ice.map(st=>st.until??Infinity)),remaining=ice.length?Math.max(0,until-round+1):0;
 if(layers||u.cardId==='ice_core')effects.push({id:'ice_seal',label:'冰封 ×'+layers+(layers&&Number.isFinite(remaining)?' · 剩余'+remaining+'回合':''),description:ice.some(st=>st.data?.ruthless)?'算式·无情：不降低速度或提供免伤；受到物理攻击时附加每层20点最终固定伤害。仅非冰原核心的攻击消耗1层；叠加时统一刷新3回合。':'每层使速度降低1级、受到伤害降低5%；叠加时统一刷新2回合。冰原核心达到5层时自动全部移除。'});
 if(u.counters.weapon_count)effects.push({id:'weapon_count',label:'武器 ×'+u.counters.weapon_count,description:'最多持有6件武器；每件使物攻、物防、魔攻、魔抗和速度基础数值各提高30。'});
 if(u.counters.death_energy)effects.push({id:'death_energy',label:'死气 '+Math.floor(u.counters.death_energy),description:'死神赋予的死气；可用于忘川渡人、三途凝望、冥罗无妄和幽冥死神之镰。'});
  if(u.counters.ghost_next)effects.push({id:'ghost_next',label:'幽冥强化 · '+u.counters.ghost_next+' 次',description:'接下来 '+u.counters.ghost_next+' 次已装备技能的成功使用将转为对应的幽冥版本；鬼墨无忧的被动触发、撞击、蓄力和控制失败不会消耗次数。'});
 if(u.counters.omni_pp)effects.push({id:'omni_pp',label:'全能PP '+u.counters.omni_pp,description:'使用技能时优先消耗的共享PP。'});
 const counters:[string,string,string][]=[['flame_growth','焚灭天火','伤害成长'],['crit_bonus','神灵凝神','额外暴击率']];
 for(const [key,name,description] of counters)if(u.counters[key])effects.push({id:key,label:name+' +'+percent(u.counters[key]),description:description+'：'+percent(u.counters[key])+'。'});
 if(u.counters.alba_unlocked)effects.push({id:'alba_unlocked',label:'轮回再入已解锁',description:'生命曾低于300点，轮回再入现已解锁。'});
 if(u.counters.moon_hits)effects.push({id:'moon_hits',label:'云破月白 ×'+u.counters.moon_hits,description:'本回合已获得'+u.counters.moon_hits+'层减伤，每层降低'+percent(rules.white_tiger_1.perHit)+'伤害，逐层相乘。'});
 if(u.counters.dark_total!==undefined)effects.push({id:'dark_total',label:'黑暗源流 '+Math.floor(u.counters.dark_total)+'/'+rules.slime_1.threshold,description:'累计受伤进度；每累计受到'+rules.slime_1.threshold+'点伤害，对敌方全体造成'+rules.slime_1.value+'点生命损失。'});
 for(const [index,sh] of u.shields.entries())effects.push({id:'shield:'+index,label:(sh.type==='physical'?'物理盾 ':'法术盾 ')+Math.floor(sh.value),description:sh.type==='physical'?'抵挡物理伤害，魔法攻击无视此盾；混伤只抵挡物理部分。':'抵挡魔法伤害，物理攻击无视此盾；混伤只抵挡魔法部分。'});
 const weaponNames:Record<string,string>={moon_blade:'削月刀',flying_axe:'飞斧',absorb_shield:'吸收盾',black_shield:'黑盾',eternal_spear:'永恒之枪',victory_sword:'胜利之剑'};
  for(const [index,st] of u.statuses.entries()){if(st.id==='ice_seal')continue;const starts=Number(st.data?.starts??round),remaining=st.until===null?null:Math.max(0,st.until-(st.id==='encore'?Math.max(round,starts):round)+1);if(remaining===0||st.id==='encore'&&typeof st.data?.skill==='string'&&u.pp[st.data.skill]===0)continue;const label=st.id==='weapon'?weaponNames[String(st.data?.key)]??'武器':statusLabel(st.id);effects.push({id:st.id+':'+index,label:label+(starts>round?' · '+(starts-round)+'回合后触发':'')+(remaining!==null?' · 剩余'+remaining+'回合':' · 持续'),description:effectDescription(st),debuff:st.debuff});}
 return effects;
}
export function UnitEffects({unit,round}:{unit:PublicUnit;round:number}){const effects=unitEffects(unit,round);return <div className="unit-effects" aria-label="当前标记与持续效果">{effects.map(effect=><span className={'unit-effect '+(effect.debuff?'debuff':'')} key={effect.id} title={effect.description}><strong>{effect.label}</strong><small>{effect.description}</small></span>)}</div>;}
