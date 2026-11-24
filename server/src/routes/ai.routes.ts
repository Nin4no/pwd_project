import {Router,type RequestHandler} from "express";
import {isAuthenticated} from "../middleware/auth.middleware";
import {furniture,furniturePhoto,roomPhoto} from "../controllers/ai.controller";
const router=Router();const requests=new Map<string,number[]>();
export const aiRateLimit:RequestHandler=(req,res,next)=>{const id=req.auth?.id;if(!id){res.status(401).json({message:"Authentication required."});return;}const now=Date.now(),recent=(requests.get(id)||[]).filter(t=>now-t<60000);if(recent.length>=10){res.status(429).json({message:"AI request limit exceeded."});return;}recent.push(now);requests.set(id,recent);next();};
router.use(isAuthenticated,aiRateLimit);router.post("/furniture",furniture);router.post("/room-photo",roomPhoto);router.post("/furniture-photo",furniturePhoto);export default router;
