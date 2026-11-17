/** Policy randomness is isolated from the authoritative battle RNG. */
export function seedOf(...parts:(string|number)[]){
 let n=2166136261;
 for(const c of parts.join('|')){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}
 return n>>>0||1;
}
export function seededRandom(seed:number){
 let state=seed>>>0||1;
 return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
export function shuffled<T>(items:readonly T[],random:()=>number){
 const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}
