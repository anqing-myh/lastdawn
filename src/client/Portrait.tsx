import {useEffect} from 'react';
import {cardOf} from '../shared/catalog';
import manifest from '../../assets/images/characters/manifest.json';
import './portrait.css';

interface ArtForm {source:string;name?:string}
const art=manifest as Record<string,ArtForm[]>;
const images=import.meta.glob<string>('../../assets/images/characters/web/*.webp',{eager:true,query:'?url',import:'default'});
function imageUrl(id:string,form:number,small=false){
 const path=`../../assets/images/characters/web/${id}-${form}${small?'-small':''}.webp`;
 const url=images[path];if(!url)throw Error('缺少角色图片：'+id+' / '+form);
 return url;
}

export function Portrait({id,form,large=false,sizes}:{id:string;form?:number;large?:boolean;sizes?:string}){
 const card=cardOf(id),forms=art[id],current=Number.isInteger(form)&&forms[form!]?form!:0;
 const label=card.name+(forms[current].name?' · '+forms[current].name:'');
 // Only battle portraits supply form. Warm the other forms before a settlement
 // changes the picture; gallery and draft portraits always use the initial form.
 useEffect(()=>{if(form===undefined||forms.length===1)return;for(let index=0;index<forms.length;index++){const image=new Image();image.src=imageUrl(id,index,true);}},[id,form===undefined]);
 return <img key={id+':'+current} className={'portrait '+(large?'large':'')} src={imageUrl(id,current,true)} srcSet={`${imageUrl(id,current,true)} 384w, ${imageUrl(id,current)} 1024w`} sizes={sizes??'(max-width: 640px) 45vw, 240px'} width="1024" height="1024" alt={label} title={label} data-character={id} data-form={current} loading="lazy" decoding="async" draggable={false}/>;
}
