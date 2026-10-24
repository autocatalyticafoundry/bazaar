
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

function glDenseExactRankV1(target,refs,idx) {
  // Confirm all 128 bits, not just a common 16-bit bucket.
  // Count distinct matched reference features to suppress repetitive UI art.
  const hits=new Uint32Array(refs.length),unique=Array.from({length:refs.length},()=>new Set());
  const seen=new Uint32Array(refs.length);
  let tested=0,exact=0,skipped_very_common=0;
  for(let ti=0;ti<target.length;ti++) {
    const d=target[ti].descriptor,base=(d[0]<<8)|d[1],
      start=idx.heads[base],end=idx.heads[base+1];
    if(end-start>384){skipped_very_common++;continue;}
    for(let j=start;j<end;j++){
      const code=idx.codes[j],ri=Math.floor(code/256),fi=code%256;
      if(ri>=refs.length)continue;
      const rd=refs[ri].features[fi]?.descriptor;
      if(!rd)continue;
      tested++;let equal=true;
      for(let byte=2;byte<16;byte++) if(d[byte]!==rd[byte]){equal=false;break;}
      if(!equal)continue;
      exact++;unique[ri].add(fi);
      if(seen[ri]!==ti+1){seen[ri]=ti+1;hits[ri]++;}
    }
  }
  const rows=[];
  for(let i=0;i<refs.length;i++)if(hits[i])rows.push({i,hits:hits[i],
    distinct_ref_features:unique[i].size,
    score:(hits[i]+3*unique[i].size)/Math.sqrt(Math.max(1,refs[i].features.length))});
  rows.sort((a,b)=>b.score-a.score||b.distinct_ref_features-a.distinct_ref_features||b.hits-a.hits);
  return {rows,diagnostics:{tested,exact,skipped_very_common,refs_with_exact:rows.length}};
}


function glHoughShortlistV1(pairsByRef,poolVotes,refs,limit=24){
  // Vote for mutually consistent translations at a small, generic set of
  // plausible image scales. This is a CHEAP shortlist, not RANSAC verification.
  const scales=[0.65,0.8,0.95,1.1,1.25,1.4,1.6],
    bin=48,shifts=[0,24],rows=[];
  for(let n=0;n<poolVotes.length;n++){
    const ref=poolVotes[n],raw=pairsByRef[n]||[],
      bestPairs=raw.filter(p=>p.distance<=22)
        .sort((a,b)=>a.distance-b.distance||a.ti-b.ti).slice(0,160),
      bins=new Map();
    for(const p of bestPairs){
      for(let k=0;k<scales.length;k++){
        const scale=scales[k],dx=p.target_x-scale*p.reference_x,
          dy=p.target_y-scale*p.reference_y;
        for(let sh=0;sh<shifts.length;sh++){
          const q=shifts[sh],bx=Math.floor((dx+q)/bin),by=Math.floor((dy+q)/bin),
            key=k+":"+sh+":"+bx+":"+by;
          let entry=bins.get(key);
          if(!entry){entry={count:0,targets:new Set(),references:new Set(),sum_distance:0,scale,dx,dy};bins.set(key,entry);}
          if(entry.targets.has(p.ti)||entry.references.has(p.ri))continue;
          entry.targets.add(p.ti);entry.references.add(p.ri);
          entry.count++;entry.sum_distance+=p.distance;
        }
      }
    }
    let peak=null;
    for(const v of bins.values())if(!peak||v.count>peak.count||
      (v.count===peak.count&&v.sum_distance/v.count<peak.sum_distance/peak.count))peak=v;
    const peakCount=peak?.count||0,peakH=peakCount?peak.sum_distance/peakCount:128;
    rows.push({...ref,score:peakCount*10-peakH*0.03+Math.log1p(raw.length)*0.01,
      hough_peak:peakCount,hough_scale:peak?.scale||null,
      hough_mean_hamming:peakCount?peakH:null,raw_pairs:raw.length,pool_position:n});
  }
  rows.sort((a,b)=>b.score-a.score||b.hough_peak-a.hough_peak||a.pool_position-b.pool_position);
  return rows.slice(0,Math.max(8,Math.min(64,limit)));
}

async function glDenseRareShardV1(env, body) {
  const si=Math.max(0,Math.min(7,Number(body.shard_index)||0));
  const ds=Math.max(.45,Math.min(1.25,Number(body.scale)||1));
  const inputKey=String(body.input_key||"perception/inputs/5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393.png");
  const benchmark="perception/inputs/5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393.png";
  // General input path keeps the native image dimensions and avoids resizing.
  const version=[2,3].includes(Number(body.bank_version))?Number(body.bank_version):1;
  const tr=version===3?await glV3Screenshot(env,inputKey,ds):
    inputKey===benchmark&&body.fresh!==true?await glLoadFullTargetDense(env,ds):
    await (async()=>{const loaded=await loadProofInputs(env,inputKey),im=loaded.image;
      return {width:im.width,height:im.height,descriptor_scale:ds,
        features:lgExtractSpatialFastGrid(im.rgba,im.width,im.height,16,12,32,2,ds)};})();
  const bankKey="debug/whole-screen-local-feature-bank-v"+version+"/shards/shard-"+String(si).padStart(2,"0")+".json";
  const bank=await lgLoadBank(env,bankKey);
  const idx=version===1?await glLoadPackedIndex(env,si):await glLoadPackedIndexV2(env,si,version);
  if(idx.reference_count!==bank.refs.length) throw new Error("packed index/bank reference mismatch for shard "+si);
  const topN=Math.max(8,Math.min(40,Number(body.shortlist)||24));
  const maxBucket=Math.max(8,Math.min(96,Number(body.max_bucket)||48));
  const rarity=glRareVotePacked(tr.features,bank.refs,idx,bank.refs.length,maxBucket);
  const exact=glDenseExactRankV1(tr.features,bank.refs,idx);
  const mode=String(body.ranking||"rarity");
  const houghMode=mode==="hough";
  const allVotes=mode==="exact"?exact.rows:rarity;
  const poolN=houghMode?Math.max(topN,Math.min(bank.refs.length,Number(body.pool)||64)):topN;
  const poolStart=houghMode?Math.max(0,Math.floor(Number(body.pool_start)||0)):0;
  const preliminary=allVotes.slice(poolStart,poolStart+poolN);
  if(!preliminary.length)throw new Error("empty rarity pool slice "+poolStart);
  const foundPool=glDenseRarePairsV1(tr.features,bank,idx,preliminary,maxBucket,192);
  const votes=houghMode?glHoughShortlistV1(foundPool.per,preliminary,bank.refs,topN):preliminary;
  const positions=new Map(preliminary.map((v,i)=>[v.i,i]));
  const found=houghMode?{...foundPool,
    selected:votes.map(v=>v.i),per:votes.map(v=>foundPool.per[positions.get(v.i)])}:foundPool;
  const baselinePairs=body.pair_mode==="baseline"?
    glCollectPairsSelectivePackedFast(tr.features,bank.refs,idx,128):null;
  const verifyPairs=baselinePairs?
    found.selected.map(i=>baselinePairs[i]):found.per;
  const refs=found.selected.map(i=>bank.refs[i]);
  // Only the selected references are geometrically estimated.
  const rows=body.diagnostic_only===true?[]:glRankRefs24(verifyPairs,refs,{x:0,y:0});
  const accepted=rows.filter(r=>{const t=r.transform;
    return !!t&&((t.inlier_count>=6&&t.mean_hamming<=18&&t.mean_residual<=2.5)
      ||(t.inlier_count>=4&&t.mean_hamming<=4&&t.mean_residual<=1));});
  const shortlist=votes.map((v,rank)=>({rank:rank+1,name:basename(bank.refs[v.i].asset_path),
    asset_path:bank.refs[v.i].asset_path,score:v.score,votes:v.votes,hits:v.hits,
    raw_pairs:verifyPairs[rank].length,
    hough_peak:v.hough_peak??null,hough_scale:v.hough_scale??null}));
  const result={
    schema_version:1,proof_version:"dense-rare-shortlist-v1",input_key:inputKey,
    shard_index:si,bank_version:version,descriptor_scale:ds,target_feature_count:tr.features.length,
    reference_count:bank.refs.length,shortlist_count:shortlist.length,
    rank_sgw:allVotes.findIndex(v=>basename(bank.refs[v.i].asset_path).includes("StainedGlassWindow"))+1 || null,
    rank_hands:allVotes.findIndex(v=>basename(bank.refs[v.i].asset_path).includes("HandsOfTime"))+1 || null,
    fresh_extraction:body.fresh===true,full_ranking_count:allVotes.length,
    ranking_mode:mode,pool_count:poolN,pool_start:poolStart,diagnostic_only:body.diagnostic_only===true,
    pair_mode:body.pair_mode==="baseline"?"baseline":"rarity",
    candidate_reference_count:rows.length,geometry_executed_count:rows.length,
    accepted_count:accepted.length,accepted,top:rows.slice(0,24),shortlist,
    diagnostics:{...found.stats,exact:exact.diagnostics},
    exact_rank_sgw:exact.rows.findIndex(v=>basename(bank.refs[v.i].asset_path).includes("StainedGlassWindow"))+1||null,
    exact_hits_sgw:exact.rows.find(v=>basename(bank.refs[v.i].asset_path).includes("StainedGlassWindow"))||null,
    exact_top:exact.rows.slice(0,12).map(v=>({...v,name:basename(bank.refs[v.i].asset_path)}))
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
