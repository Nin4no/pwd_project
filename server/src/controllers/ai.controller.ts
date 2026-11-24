import asyncHandler from "../utils/asyncHandler";
import * as service from "../services/ai.service";
export const furniture=asyncHandler(async(req,res)=>{const {retries:_retries,...result}=await service.createFurniture((req.body as any)?.prompt);res.json({data:result});});
export const roomPhoto=asyncHandler(async(req,res)=>{const body=req.body as any;res.json({data:await service.analyzeRoom(body?.imageDataUrl,body?.calibration)});});
export const furniturePhoto=asyncHandler(async(req,res)=>{const body=req.body as any;res.json({data:await service.analyzeFurniturePhoto(body?.imageDataUrl,{hintName:body?.hintName,knownWidthCm:body?.knownWidthCm,preferredCategory:body?.preferredCategory})});});
