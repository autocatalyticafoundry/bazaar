
// Dense native-resolution, packed-index retrieval experiment.
// Uses one vote per screenshot feature per canonical reference, weighted by
// inverse square root of packed head-table bucket occupancy.
// This file is injected into the proof Worker, never the production Worker.
function glDenseRarePairsV1(target, bank, idx, shortlist, maxBucket=64, maxCandidates=192) {
  const selected = shortlist.map(q => q.i);
  const local = new Int16Array(bank.refs.length); local.fill(-1);
  for (let j=0;j<selected.length;j++) local[selected[j]]=j;
  const per = Array.from({length:selected.length},()=>[]);
  const seen = new Uint32Array(bank.refs.length*256);
  let stamp=1, sampled=0, capped=0, verified=0, near=0;
  for (let ti=0;ti<target.length;ti++) {
    stamp++;
    if (stamp===0xffffffff) {seen.fill(0);stamp=1;}
    const d=target[ti].descriptor;
    // Head-table lengths are global corpus rarity, not shortlist frequency.
    const buckets = [];
    for (let ci=0;ci<8;ci++) {
      const o=idx.offs[ci], base=(d[o]<<8)|d[o+1], hb=ci*65537;
      for (let b=-1;b<16;b++) {
        const v=b<0?base:base^(1<<b),s=idx.heads[hb+v],e=idx.heads[hb+v+1],n=e-s;
        if (n>0&&n<=maxBucket) buckets.push({s,e,n,exact:b<0});
      }
    }
    // Examine rarer buckets first to prevent common textures from exhausting
    // the cheap candidate cap; exact hits win ties.
    buckets.sort((a,b)=>a.n-b.n || Number(b.exact)-Number(a.exact));
    let count=0;
    for (const bucket of buckets) {
      for (let k=bucket.s;k<bucket.e;k++) {
        const code=idx.codes[k],ri=Math.floor(code/256),fi=code%256;
        if (ri>=local.length || local[ri]<0 || fi>=bank.refs[ri].features.length) continue;
        if (seen[code]===stamp) continue;
        seen[code]=stamp;
        sampled++;
        const rf=bank.refs[ri].features[fi];
        const dist=glHamFast(d,rf.descriptor);verified++;
        if (dist<=22) {
          near++;
          per[local[ri]].push({
            ti,ri:fi,reference_x:rf.x,reference_y:rf.y,
            target_x:target[ti].x,target_y:target[ti].y,distance:dist
          });
        }
        count++;
        if (count>=maxCandidates) break;
      }
      if (count>=maxCandidates) {capped++;break;}
    }
  }
  return {per,selected,stats:{sampled,capped_target_features:capped,hamming_evaluations:verified,near_pairs:near}};
}
async function glDenseRareShardV1(env, body) {
  const si=Math.max(0,Math.min(7,Number(body.shard_index)||0));
  const ds=Math.max(.45,Math.min(1.25,Number(body.scale)||1));
  const inputKey=String(body.input_key||"perception/inputs/5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393.png");
  const benchmark="perception/inputs/5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393.png";
  // General input path keeps the native image dimensions and avoids resizing.
  const tr=inputKey===benchmark&&body.fresh!==true?await glLoadFullTargetDense(env,ds):
    await (async()=>{const loaded=await loadProofInputs(env,inputKey),im=loaded.image;
      return {width:im.width,height:im.height,descriptor_scale:ds,
        features:lgExtractSpatialFastGrid(im.rgba,im.width,im.height,16,12,32,2,ds)};})();
  const bank=await lgLoadBank(env,"debug/whole-screen-local-feature-bank-v1/shards/shard-"+String(si).padStart(2,"0")+".json");
  const idx=await glLoadPackedIndex(env,si);
  if(idx.reference_count!==bank.refs.length) throw new Error("packed index/bank reference mismatch for shard "+si);
  const topN=Math.max(8,Math.min(40,Number(body.shortlist)||24));
  const maxBucket=Math.max(8,Math.min(96,Number(body.max_bucket)||48));
  const allVotes=glRareVotePacked(tr.features,bank.refs,idx,bank.refs.length,maxBucket);
  const votes=allVotes.slice(0,topN);
  const found=glDenseRarePairsV1(tr.features,bank,idx,votes,maxBucket,192);
  const refs=found.selected.map(i=>bank.refs[i]);
  // Only the selected references are geometrically estimated.
  const rows=glRankRefs24(found.per,refs,{x:0,y:0});
  const accepted=rows.filter(r=>{const t=r.transform;
    return !!t&&((t.inlier_count>=6&&t.mean_hamming<=18&&t.mean_residual<=2.5)
      ||(t.inlier_count>=4&&t.mean_hamming<=4&&t.mean_residual<=1));});
  const shortlist=votes.map((v,rank)=>({rank:rank+1,name:basename(bank.refs[v.i].asset_path),
    asset_path:bank.refs[v.i].asset_path,score:v.score,votes:v.votes,hits:v.hits,
    raw_pairs:found.per[rank].length}));
  const result={
    schema_version:1,proof_version:"dense-rare-shortlist-v1",input_key:inputKey,
    shard_index:si,descriptor_scale:ds,target_feature_count:tr.features.length,
    reference_count:bank.refs.length,shortlist_count:shortlist.length,
    rank_sgw:allVotes.findIndex(v=>basename(bank.refs[v.i].asset_path).includes("StainedGlassWindow"))+1 || null,
    rank_hands:allVotes.findIndex(v=>basename(bank.refs[v.i].asset_path).includes("HandsOfTime"))+1 || null,
    fresh_extraction:body.fresh===true,full_ranking_count:allVotes.length,
    candidate_reference_count:rows.length,geometry_executed_count:rows.length,
    accepted_count:accepted.length,accepted,top:rows.slice(0,24),shortlist,
    diagnostics:found.stats
  };
  const tag=Math.round(ds*100);
  const out=String(body.output_key||("debug/global-local-full-dense-v4-rare-shortlist/d"+tag+"-s"+si+".json"));
  if(!out.startsWith("debug/"))throw new Error("output must be under debug/");
  await env.BENCHMARK_R2.put(out,JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"dense-rare-shortlist-v1",shard_index:String(si),
      target_features:String(tr.features.length),shortlist_count:String(shortlist.length),
      accepted_count:String(accepted.length),
      accepted:JSON.stringify(accepted.slice(0,12).map(x=>({
        name:basename(x.asset_path),inliers:x.transform?.inlier_count,
        h:x.transform?.mean_hamming,res:x.transform?.mean_residual,bbox:x.bbox})))}
  });
  return result;
}
