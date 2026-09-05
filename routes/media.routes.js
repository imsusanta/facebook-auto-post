const router=require('express').Router();
const db=require('../services/db');
const {current}=require('../security/context');
const media=require('../security/media');
const upload=require('../middleware/upload');
router.get('/',async(req,res)=>{const {rows}=await db.query('SELECT filename,size,created_at FROM media_assets WHERE workspace_id=$1 ORDER BY created_at DESC',[current().workspaceId]);res.json(rows.map(r=>({fileName:r.filename,url:'/uploads/'+r.filename,size:Number(r.size),createdAt:r.created_at.toISOString()})));});
router.post('/upload',upload.single('image'),(req,res)=>{if(!req.file)return res.status(400).json({error:'Image required'});res.json({success:true,fileName:req.file.filename,url:req.file.url,size:req.file.size});});
router.delete('/:fileName',async(req,res)=>{await media.remove(req.params.fileName);res.json({success:true});});
module.exports=router;
