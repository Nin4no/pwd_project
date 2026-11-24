import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validatePrimitives, createFurniture } from "../src/services/ai.service";
type Prompt={prompt:string;category:string};
async function main(){
 const prompts=JSON.parse(fs.readFileSync(path.resolve(process.cwd(),"../eval/furniture/prompts.json"),"utf8")) as Prompt[];
 const baseline=process.argv.includes("--baseline");
 if(!baseline&&!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required; use --baseline without credentials.");
 const clientPath=pathToFileURL(path.resolve(process.cwd(),"../src/services/ai/aiFurnitureService.ts")).href;
 const client=baseline?await import(clientPath):null;
 const parser=baseline?new client!.PromptParser():null, synthesizer=baseline?new client!.ParametricSynthesizer():null;
 const rows=[] as any[];
 for(const p of prompts){try{let spec:any,retries=0;if(baseline){const intent=parser!.parse(p.prompt);spec=synthesizer!.synthesize(intent,p.prompt);}else{const result=await createFurniture(p.prompt);if(!("spec" in result)) throw new Error("Blueprint mode requires client assemble(); set AI_FURNITURE_MODE=primitives for legacy eval.");spec=result.spec;retries=result.retries;}
  const v=validatePrimitives(spec.primitives);rows.push({prompt:p.prompt,category:p.category,matched:spec.category===p.category,valid:v.errors.length===0,retries,parts:v.primitives.length,bboxValid:v.size.every((n:number)=>Number.isFinite(n)&&n>0&&n<=4),floating:v.floating});
 }catch(e){rows.push({prompt:p.prompt,category:p.category,matched:false,valid:false,retries:2,parts:0,bboxValid:false,floating:0,error:e instanceof Error?e.message:String(e)});}}
 const report={mode:baseline?"baseline":"llm",count:rows.length,validationPassRate:rows.filter(r=>r.valid).length/rows.length,retryCount:rows.reduce((s,r)=>s+r.retries,0),averageParts:rows.reduce((s,r)=>s+r.parts,0)/rows.length,bboxValidRate:rows.filter(r=>r.bboxValid).length/rows.length,floatingParts:rows.reduce((s,r)=>s+r.floating,0),categoryMatchRate:rows.filter(r=>r.matched).length/rows.length,rows};
 const out=path.resolve(process.cwd(),"../eval/furniture/report.json");fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
 console.table([{mode:report.mode,count:report.count,valid:`${(report.validationPassRate*100).toFixed(1)}%`,retries:report.retryCount,avgParts:report.averageParts.toFixed(1),bboxValid:`${(report.bboxValidRate*100).toFixed(1)}%`,floating:report.floatingParts,categoryMatch:`${(report.categoryMatchRate*100).toFixed(1)}%`}]);
}
void main();
