import {parentPort} from 'node:worker_threads';
import {chooseBotActions,chooseBotReaction} from '../src/bots/index';
import type {BotJob} from './bots';

parentPort!.on('message',(job:BotJob)=>{
 try {
  const options={strategy:'greedy' as const,seed:job.seed};
  const result=job.request?chooseBotReaction(job.view,job.request,options):chooseBotActions(job.view,options);
  parentPort!.postMessage({result});
 } catch(error) {parentPort!.postMessage({error:String(error)});}
});
