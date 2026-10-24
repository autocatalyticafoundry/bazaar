
// Screenshot-level aggregation for verified canonical visual detections.
// No screenshot-specific identity rules or HUD hardcoding.
function glOverlapIoUV1(a,b){
  const x=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
  const y=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const intersection=x*y,union=a.width*a.height+b.width*b.height-intersection;
  return union>0?intersection/union:0;
}
function glValidArtBoxV1(b,w,h){
  return b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>3&&b.height>3&&
    b.x+b.width>0&&b.y+b.height>0&&b.x<w&&b.y<h;
}
async function glAggregateScreenV1(env,body){
  const keys=Array.isArray(body.shard_keys)?body.shard_keys:[],
    out=String(body.output_key||"");
  if(keys.length<1||keys.length>8||new Set(keys).size!==keys.length||
    keys.some(k=>typeof k!=="string"||!k.startsWith("debug/")||!k.endsWith(".json")))
    throw new Error("require 1-8 distinct debug shard result keys");
  if(!out.startsWith("debug/")||!out.endsWith(".json"))throw new Error("invalid aggregate output");
  const results=[];
  for(const key of keys){
    const obj=await env.BENCHMARK_R2.get(key);
    if(!obj)throw new Error("missing shard result "+key);
    const z=JSON.parse(await new Response(obj.body).text());
    if(z.bank_version!==3||z.proof_version!=="dense-rare-shortlist-v1")
      throw new Error("unsupported shard experiment "+key);
    results.push({key,record:z});
  }
  const inputKey=results[0].record.input_key;
  if(results.some(z=>z.record.input_key!==inputKey))throw new Error("mixed screenshot results");
  const tr=await glV3Screenshot(env,inputKey,results[0].record.descriptor_scale);
  const candidateRows=[],loadedShards=new Map();
  for(const {key,record} of results){
    for(const hit of record.accepted||[]){
      if(!glValidArtBoxV1(hit.bbox,tr.width,tr.height)||!hit.transform)continue;
      let index=loadedShards.get(record.shard_index);
      if(!index){
        const bankKey="debug/whole-screen-local-feature-bank-v3/shards/shard-"+
          String(record.shard_index).padStart(2,"0")+".json";
        const b=await env.BENCHMARK_R2.get(bankKey);
        if(!b)throw new Error("missing reference provenance "+bankKey);
        const ref=JSON.parse(await new Response(b.body).text());
        index=new Map(ref.rows.map(row=>[row.asset_path,row]));
        loadedShards.set(record.shard_index,index);
      }
      const ref=index.get(hit.asset_path);
      if(!ref)throw new Error("unresolved accepted visual "+hit.asset_path);
      const t=hit.transform;
      candidateRows.push({
        canonical_visual_asset:hit.asset_path,source_sha256:ref.source_sha256,
        bbox:hit.bbox,instance_state:{bbox:hit.bbox,art_scale:t.scale,rotation_deg:t.rotation_deg},
        proof:{inlier_count:t.inlier_count,mean_residual_px:t.mean_residual,
          mean_hamming:t.mean_hamming,shard_index:record.shard_index,
          source_result_key:key},
        identity_scope:"verified_visual_reference"
      });
    }
  }
  candidateRows.sort((a,b)=>b.proof.inlier_count-a.proof.inlier_count||
    a.proof.mean_residual_px-b.proof.mean_residual_px||
    a.proof.mean_hamming-b.proof.mean_hamming);
  const kept=[],suppressed=[];
  for(const row of candidateRows){
    const prev=kept.find(p=>glOverlapIoUV1(row.bbox,p.bbox)>=0.4);
    if(!prev)kept.push(row);
    else suppressed.push({canonical_visual_asset:row.canonical_visual_asset,
      duplicate_of:prev.canonical_visual_asset,iou:glOverlapIoUV1(row.bbox,prev.bbox),
      identity_conflict:row.canonical_visual_asset!==prev.canonical_visual_asset});
  }
  const result={
    schema_version:1,aggregation_version:"screen-dedupe-v1",
    input_key:inputKey,width:tr.width,height:tr.height,
    descriptors:"brief128-v3",input_shard_keys:keys,
    candidate_count:candidateRows.length,detection_count:kept.length,
    duplicate_count:suppressed.length,detections:kept,suppressed_duplicates:suppressed,
    important_limit:"Visual reference identities and artwork bboxes only; semantic game data and unseen cards not inferred."
  };
  await env.BENCHMARK_R2.put(out,JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"screen-dedupe-v1",detection_count:String(kept.length),
      input_shard_count:String(keys.length),duplicate_count:String(suppressed.length)}});
  return {key:out,detections:kept.length,duplicates:suppressed.length};
}
