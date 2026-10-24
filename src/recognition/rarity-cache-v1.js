
// Reusable native-screenshot rarity ranking. This avoids recomputing the
// same 5,560-feature full-frame descriptor votes for every pool partition.
// The cache is keyed by immutable input, bank version and shard.
async function glBuildRarityCacheV1(env,body){
  const si=Math.max(0,Math.min(7,Number(body.shard_index)||0));
  const version=3,ds=Math.max(.45,Math.min(1.25,Number(body.scale)||1));
  const inputKey=String(body.input_key||
    "perception/inputs/5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393.png");
  const key=String(body.output_key||
    "debug/global-local-v7-rarity-cache/d"+Math.round(ds*100)+"-s"+si+".json");
  if(!key.startsWith("debug/")||!key.endsWith(".json"))
    throw new Error("invalid rarity-cache output path");
  const target=await glV3Screenshot(env,inputKey,ds);
  const bank=await lgLoadBank(env,"debug/whole-screen-local-feature-bank-v3/shards/shard-"+
    String(si).padStart(2,"0")+".json");
  const idx=await glLoadPackedIndexV2(env,si,version);
  if(bank.refs.length!==idx.reference_count)throw new Error("packed reference mismatch");
  const maxBucket=Math.max(8,Math.min(96,Number(body.max_bucket)||48));
  const rows=glRareVotePacked(target.features,bank.refs,idx,bank.refs.length,maxBucket)
    .map(row=>({...row,asset_path:bank.refs[row.i].asset_path}));
  const out={schema_version:1,cache_version:"rarity-rank-v1",bank_version:version,
    input_key:inputKey,descriptor_scale:ds,shard_index:si,
    max_bucket:maxBucket,target_feature_count:target.features.length,
    reference_count:bank.refs.length,ranked_reference_count:rows.length,rows};
  await env.BENCHMARK_R2.put(key,JSON.stringify(out),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"rarity-rank-v1",reference_count:String(bank.refs.length),
      ranked_count:String(rows.length),target_features:String(target.features.length)}
  });
  return {key,ranked:rows.length};
}
async function glReadRarityCacheV1(env,key,params){
  if(!key.startsWith("debug/")||!key.endsWith(".json"))throw new Error("invalid rank cache key");
  const f=await env.BENCHMARK_R2.get(key);
  if(!f)throw new Error("missing rank cache "+key);
  const v=JSON.parse(await new Response(f.body).text());
  const {si,version,ds,inputKey,bank,maxBucket,targetCount}=params;
  if(v.cache_version!=="rarity-rank-v1"||v.shard_index!==si||
    v.bank_version!==version||v.descriptor_scale!==ds||
    v.input_key!==inputKey||v.max_bucket!==maxBucket||
    v.reference_count!==bank.refs.length||v.target_feature_count!==targetCount||
    v.ranked_reference_count!==v.rows?.length)throw new Error("incompatible rank cache");
  const visited=new Set();
  for(const x of v.rows){
    if(!Number.isInteger(x.i)||x.i<0||x.i>=bank.refs.length||
       visited.has(x.i)||bank.refs[x.i].asset_path!==x.asset_path)
      throw new Error("corrupt rank cache reference");
    visited.add(x.i);
  }
  return v.rows;
}
