import ts from 'typescript';
import fs from 'node:fs/promises';
export async function resolve(specifier,context,next){try{return await next(specifier,context);}catch(e){if((specifier.startsWith('.')||specifier.startsWith('/'))&&!/\.[a-z]+$/i.test(specifier)){for(const ext of ['.ts','.tsx','.json'])try{return await next(specifier+ext,context);}catch{}}throw e;}}
export async function load(url,context,next){if(url.endsWith('.ts')||url.endsWith('.tsx')){const source=await fs.readFile(new URL(url),'utf8');const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:new URL(url).pathname});return {format:'module',source:result.outputText,shortCircuit:true};}if(url.endsWith('.json'))return {format:'module',source:'export default '+await fs.readFile(new URL(url),'utf8'),shortCircuit:true};return next(url,context);}

