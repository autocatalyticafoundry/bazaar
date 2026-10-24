
// Ranks all references by descriptor-verified spatial consistency, without
// running RANSAC in individual pool partitions. Geometric verification only
// runs on the final bounded shortlist.
// Relies on the fixed v3 native-resolution descriptor and versioned bank.
async function glHoughReduceShardV1(env,body){
  const si=Math.max(0,Math.min(7,Math.floor(Number(body.shard_index)||0)));
  const poolSize=24,topN=Math.max(8,Math.min(40,Number(body.shortlist)||24));
  const prefix=String(body.part_prefix||"debug/global-local-v7-pool24/");
  const outputKey=String(body.output_key||"debug/global-local-v7-pool24/reduced-shard-"+String(si).padStart(2,"0")+".json");
  if(!prefix.startsWith("debug/")||!outputKey.startsWith("debug/")||!outputKey.endsWith(".json"))
    throw new Error("invalid experimental artifact path");
  const bankKey="debug/whole-screen-local-feature-bank-v3/shards/shard-"+String(si).padStart(2,"0")+".json";
  const bank=await lgLoadBank(env,bankKey);
  const expected=bank.refs.length,parts=[],scores=[],allRarityRanked=new Set();
  let first=null,rankedCount=null;
  for(let start=0;start<expected;start+=poolSize){
    const key=prefix+"shard-"+String(si).padStart(2,"0")+"-p"+String(start).padStart(3,"0")+".json";
    const f=await env.BENCHMARK_R2.get(key);
    if(!f)throw new Error("missing ranking partition "+key);
    const v=JSON.parse(await new Response(f.body).text());
    if(v.error)throw new Error("failed ranking partition "+key+": "+v.error);
    if(v.bank_version!==3||v.shard_index!==si||v.pool_start!==start||
       v.pool_count!==poolSize||v.ranking_mode!=="hough"||v.diagnostic_only!==true||
       v.geometry_executed_count!==0||!Array.isArray(v.shortlist))
      throw new Error("incompatible ranking partition "+key);
    if(first && (first.input_key!==v.input_key||first.descriptor_scale!==v.descriptor_scale))
      throw new Error("inconsistent partition target "+key);
    first=first||v;
    if(rankedCount===null)rankedCount=v.full_ranking_count;
    if(rankedCount!==v.full_ranking_count)throw new Error("inconsistent ranked reference count");
    const shortlist=v.shortlist;
    for(const x of shortlist){
      if(!x.asset_path||!Number.isFinite(x.hough_peak))throw new Error("invalid pool shortlist");
      const prev=scores.find(y=>y.asset_path===x.asset_path);
      if(prev)throw new Error("reference repeated across rarity partitions "+x.asset_path);
      scores.push({...x,source_part:key,source_pool_start:start});
    }
    parts.push({key,considered:Math.min(poolSize,Math.max(0,rankedCount-start)),
      winners:shortlist.length,top_peak:shortlist[0]?.hough_peak||0});
    if(start+poolSize>=rankedCount)break;
  }
  if(!first||!parts.length||parts.reduce((sum,p)=>sum+p.considered,0)!==rankedCount)
    throw new Error("incomplete Hough pool coverage");
  const pathToIndex=new Map(bank.refs.map((r,i)=>[r.asset_path,i]));
  scores.sort((a,b)=>b.hough_peak-a.hough_peak||
    a.hough_mean_hamming-b.hough_mean_hamming||
    b.score-a.score||a.asset_path.localeCompare(b.asset_path));
  const unique=scores.slice(0,topN).map(row=>{
    const i=pathToIndex.get(row.asset_path);
    if(i===undefined)throw new Error("unknown canonical visual "+row.asset_path);
    return {i,...row};
  });
  const tr=await glV3Screenshot(env,first.input_key,first.descriptor_scale);
  const idx=await glLoadPackedIndexV2(env,si,3);
  if(idx.reference_count!==bank.refs.length)throw new Error("v3 packed mismatch");
  const found=glDenseRarePairsV1(tr.features,bank,idx,unique,48,192);
  const refs=unique.map(v=>bank.refs[v.i]),rows=glRankRefs24(found.per,refs,{x:0,y:0});
  const accepted=rows.filter(row=>{
    const t=row.transform;
    return !!t&&((t.inlier_count>=6&&t.mean_hamming<=18&&t.mean_residual<=2.5)||
      (t.inlier_count>=4&&t.mean_hamming<=4&&t.mean_residual<=1));
  });
  const out={
    schema_version:1,proof_version:"dense-rare-shortlist-v1",
    retrieval_version:"exhaustive-24-pool-hough-v1",
    shard_index:si,bank_version:3,input_key:first.input_key,
    descriptor_scale:first.descriptor_scale,target_feature_count:tr.features.length,
    reference_count:bank.refs.length,ranked_reference_count:rankedCount,
    partition_count:parts.length,partitions:parts,
    hough_candidates_considered:scores.length,
    candidate_reference_count:rows.length,geometry_executed_count:rows.length,
    shortlist_count:unique.length,
    shortlist:unique.map((x,rank)=>({rank:rank+1,name:basename(x.asset_path),
      asset_path:x.asset_path,hough_peak:x.hough_peak,
      hough_mean_hamming:x.hough_mean_hamming,score:x.score,
      source_pool_start:x.source_pool_start,raw_pairs:found.per[rank]?.length||0})),
    accepted_count:accepted.length,accepted,top:rows.slice(0,24),
    diagnostics:found.stats
  };
  await env.BENCHMARK_R2.put(outputKey,JSON.stringify(out),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"exhaustive-24-pool-hough-v1",
      reference_count:String(bank.refs.length),ranked_reference_count:String(rankedCount),
      candidate_count:String(scores.length),accepted_count:String(accepted.length)}});
  return {key:outputKey,shortlisted:unique.length,accepted:accepted.length};
}
