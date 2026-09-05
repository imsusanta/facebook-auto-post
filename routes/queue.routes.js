const router=require('express').Router();
const storage=require('../services/storage');
const scheduler=require('../services/scheduler');
const upload=require('../middleware/upload');
const {validatePost}=require('../security/validation');
const {broadcastSSE}=require('../middleware/sse');
router.get('/',async(req,res)=>res.json(await storage.getQueue()));
router.post('/',upload.single('image'),validatePost,async(req,res)=>{
 const {message='',scheduledAt,facebookPageId}=req.body;const imageUrl=req.file?.url||req.body.imageUrl;
 if(!message&&!imageUrl)return res.status(400).json({error:'Message or image required'});
 const item=await storage.addToQueue({message,imageUrl,scheduledAt,facebookPageId});broadcastSSE('queue_updated',await storage.getQueue());res.json({success:true,item});
});
router.delete('/:id',async(req,res)=>{const queue=await storage.removeFromQueue(req.params.id);broadcastSSE('queue_updated',queue);res.json({success:true,queue});});
router.post('/:id/publish-now',async(req,res)=>{
 const item=(await storage.getQueue()).find(q=>q.id===req.params.id);if(!item)return res.status(404).json({error:'Queue item not found'});
 const result=await scheduler.processManualQueueItem(item);if(!result)return res.status(409).json({error:'Job is already processing or finished'});res.json({success:true,result});
});
module.exports=router;
