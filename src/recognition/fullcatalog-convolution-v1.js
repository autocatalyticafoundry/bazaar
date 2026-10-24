
// Full-catalogue convolution/PDE discovery using pre-existing 16x16 RGB artwork.
// No neural model, no source-image downloads for first pass, and no ground truth labels.
// This tests whether weak binary shortlist retrieval was losing true candidates.
function bzFullConvBaseV1(inputKey){
  return "debug/region-fullcatalog-convolution-v1/"+bzRegionImageShaV1(inputKey)+"/";
}
async function bzFullConvRegionV1(env,body){
  const inputKey=String(body.input_key||""),
    sha=bzRegionImageShaV1(inputKey),base=bzFullConvBaseV1(inputKey),
    id=String(body.region_id||"");
  const data=await env.BENCHMARK_R2.get(bzRegionBaseV1(sha)+"regions.json");
  if(!data)throw new Error("missing card-region proposals");
  const loc=JSON.parse(await new Response(data.body).text()),
    r=loc.regions.find(a=>a.region_id===id);
  if(!r)throw new Error("invalid region id");
  const loaded=await loadProofInputs(env,inputKey),
    W=16,H=16,target=bzAffineSummaryV1(
      bzAffineGridV1(loaded.image,r.bbox,W,H,"target"),W,H);
  const refs=loaded.refs,ranking=[],errors=[];
  if(refs.length<1300)throw new Error("unexpectedly incomplete full artwork catalogue");
  for(const ref of refs){
    const b=ref.rgb16;
    if(!b||b.length!==W*H*3){errors.push({asset:ref.asset_path,error:"invalid_rgb16"});continue;}
    const rgba=new Uint8Array(W*H*4);
    for(let p=0;p<W*H;p++){
      rgba[p*4]=b[p*3];rgba[p*4+1]=b[p*3+1];
      rgba[p*4+2]=b[p*3+2];rgba[p*4+3]=255;
    }
    const art={width:W,height:H,rgba},slices=[];
    for(const [mode,shift] of [["cover",0],["cover",-.16],["cover",.16],["stretch",0]]){
      const f=bzAffineSummaryV1(bzAffineGridV1(art,r.bbox,W,H,mode,shift),W,H),
        comp=bzAffineCompareV1(target,f);
      slices.push({score:comp.score,mode,shift,
        gaussian_hog:comp.hog,pde_hog:comp.pde_hog});
    }
    slices.sort((a,b)=>b.score-a.score);
    const best=slices[0];
    ranking.push({canonical_visual_asset:ref.asset_path,
      source_sha256:ref.source_sha256,
      score:Number(best.score.toFixed(6)),mode:best.mode,shift:best.shift,
      gaussian_hog:Number(best.gaussian_hog.toFixed(5)),
      pde_hog:Number(best.pde_hog.toFixed(5))});
  }
  ranking.sort((a,b)=>b.score-a.score||a.canonical_visual_asset.localeCompare(b.canonical_visual_asset));
  const result={schema_version:1,version:"region-fullcatalog-convolution-v1",
    input_key:inputKey,region_id:id,bbox:r.bbox,reference_count:refs.length,
    compared:ranking.length,errors,top:ranking.slice(0,64),
    // Save complete score list so later label truth can be evaluated without
    // rerunning the image processing, but do not interpret as probabilities.
    all_scores:ranking.map(x=>[x.canonical_visual_asset,x.score]),
    score_semantics:"low-resolution convolution+nonlinear diffusion template similarity, not posterior probabilities",
    no_label_leakage:true};
  await env.BENCHMARK_R2.put(base+id+".json",JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"}});
  const complete=[];
  for(const x of loc.regions)if(await env.BENCHMARK_R2.head(base+x.region_id+".json"))
    complete.push(x.region_id);
  if(complete.length===loc.regions.length)await bzFullConvAggregateV1(env,{input_key:inputKey});
  return {region_id:id,compared:ranking.length,top:ranking.slice(0,5)};
}
async function bzFullConvAggregateV1(env,body){
  const inputKey=String(body.input_key||""),sha=bzRegionImageShaV1(inputKey),
    base=bzFullConvBaseV1(inputKey),
    v=await env.BENCHMARK_R2.get(bzRegionBaseV1(sha)+"regions.json");
  if(!v)throw new Error("localization missing");
  const loc=JSON.parse(await new Response(v.body).text()),regions=[];
  for(const r of loc.regions){
    const o=await env.BENCHMARK_R2.get(base+r.region_id+".json");
    if(!o)throw new Error("missing convolution full-catalogue output "+r.region_id);
    const row=JSON.parse(await new Response(o.body).text());
    regions.push({region_id:r.region_id,bbox:r.bbox,compared:row.compared,
      ranked_top:row.top.slice(0,24),full_score_artifact:base+r.region_id+".json",
      errors:row.errors});
  }
  const result={schema_version:1,version:"region-fullcatalog-convolution-v1",
    input_key:inputKey,regions,region_count:regions.length,
    total_comparisons:regions.reduce((n,r)=>n+r.compared,0),
    candidate_universe:loc.regions.length?regions[0].compared:null,
    warning:"Low-resolution full-catalogue retrieval. Candidate ranks do not imply calibrated likelihood or accepted identity.",
    generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"result.json",JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"}});
  return {result_key:base+"result.json",regions:regions.length,
    comparisons:result.total_comparisons};
}
