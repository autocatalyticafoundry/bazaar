
// Experimental 32x32 multiscale convolution/PDE benchmark.
// No human labels are loaded at any point in candidate selection or scoring.
// The 32x32 descriptors are derived from an independent preexisting artwork corpus.
function bzMultiscaleBaseV1(inputKey){
  return "debug/region-multiscale-diagnostic-v1/"+bzRegionImageShaV1(inputKey)+"/";
}
function bzMultiscaleRefImageV1(descriptor){
  const raw=b64bytes(descriptor.rgba32);
  if(raw.length!==32*32*4)throw new Error("bad_rgba32_descriptor");
  return {width:32,height:32,rgba:raw};
}
function bzMultiscale16ImageV1(rgb16){
  if(!rgb16||rgb16.length!==16*16*3)throw new Error("bad_rgb16");
  const rgba=new Uint8Array(16*16*4);
  for(let p=0;p<16*16;p++){
    rgba[4*p]=rgb16[3*p];rgba[4*p+1]=rgb16[3*p+1];
    rgba[4*p+2]=rgb16[3*p+2];rgba[4*p+3]=255;
  }
  return {width:16,height:16,rgba};
}
function bzMultiscaleCompareV1(target,ref,box,W,H){
  const variants=[["cover",0],["cover",-.16],["cover",.16],["stretch",0]];
  let best=null;
  for(const [mode,shift] of variants){
    const grid=bzAffineGridV1(ref,box,W,H,mode,shift);
    const summary=bzAffineSummaryV1(grid,W,H);
    const comp=bzAffineCompareV1(target,summary);
    if(!best||comp.score>best.score)best={
      score:comp.score,mode,shift,
      no_pde:(.28*comp.ga+.22*comp.chroma+.24*comp.hog)/.74,
      pde_only:(.13*comp.pde_hog+.13*comp.pde_correlation)/.26,
      components:{gaussian:comp.ga,chroma:comp.chroma,
        hog:comp.hog,pde_hog:comp.pde_hog,pde_corr:comp.pde_correlation}
    };
  }
  return best;
}
async function bzMultiscaleRegionV1(env,body){
  const inputKey=String(body.input_key||""),
    sha=bzRegionImageShaV1(inputKey),
    id=String(body.region_id||"");
  if(!/^region-\d{2}$/.test(id))throw new Error("bad_multiscale_region_id");
  const original=await env.BENCHMARK_R2.get(bzFullConvBaseV1(inputKey)+id+".json");
  const local=await env.BENCHMARK_R2.get(bzRegionBaseV1(sha)+"regions.json");
  if(!original||!local)throw new Error("missing_multiscale_dependency");
  const prior=JSON.parse(await new Response(original.body).text());
  const loc=JSON.parse(await new Response(local.body).text());
  const reg=loc.regions.find(x=>x.region_id===id);
  if(!reg||prior.entity_type_scope!=="item_only_v1"||
      !bzSameRegionBoxV2(reg.bbox,prior.bbox))throw new Error("multiscale_region_geometry_or_type_mismatch");
  const input=await loadProofInputs(env,inputKey);
  const typed=await bzTypedItemReferenceSetV1(env,input.refs);
  const types=new Map(typed.eligible.map(x=>[x.asset_path,x]));
  const catalogObj=await env.BENCHMARK_R2.get("catalogue/item-native-rgba32-v1.json");
  if(!catalogObj)throw new Error("missing_independent_rgba32_corpus");
  const catalog=JSON.parse(await new Response(catalogObj.body).text());
  if(catalog.grid_size!==32||catalog.kind!=="typed_item_native_rgba32_corpus_v1"||catalog.rows.length<1000)
    throw new Error("unexpected_32px_catalogue");
  const desc=new Map(catalog.rows.map(x=>[x.asset_path,x]));
  const selected=new Map();
  // Expand the 16x16 comparator's original top-48 retrieval to the available
  // top-64 coarse candidates; preserve all old detailed shortlist members.
  for(const c of prior.coarse_top.slice(0,64)){
    const ref=types.get(c[0]);
    if(ref)selected.set(ref.asset_path,ref);
  }
  for(const c of prior.top){
    const ref=types.get(c.canonical_visual_asset);
    if(ref)selected.set(ref.asset_path,ref);
  }
  const target16=bzAffineSummaryV1(bzAffineGridV1(input.image,reg.bbox,16,16,"target"),16,16),
    target32=bzAffineSummaryV1(bzAffineGridV1(input.image,reg.bbox,32,32,"target"),32,32);
  const rank=[],excluded=[];
  for(const ref of selected.values()){
    const d=desc.get(ref.asset_path);
    if(!d||!d.rgba32){excluded.push({asset:ref.asset_path,error:"no_32px_descriptor"});continue;}
    if(d.source_sha256!==ref.source_sha256){excluded.push({asset:ref.asset_path,error:"source_sha_mismatch"});continue;}
    if(d.quality!=="native_rgba32"){excluded.push({asset:ref.asset_path,error:"non_native_32px_descriptor"});continue;}
    const small=bzMultiscaleCompareV1(target16,bzMultiscale16ImageV1(ref.rgb16),reg.bbox,16,16),
      large=bzMultiscaleCompareV1(target32,bzMultiscaleRefImageV1(d),reg.bbox,32,32);
    rank.push({
      canonical_visual_asset:ref.asset_path,canonical_entity_id:ref.canonical_entity_id,
      source_sha256:ref.source_sha256,reference_quality:d.quality,
      scores:{
        res16:Number(small.score.toFixed(6)),res32:Number(large.score.toFixed(6)),
        fusion:Number((.4*small.score+.6*large.score).toFixed(6)),
        no_pde32:Number(large.no_pde.toFixed(6)),
        pde_only32:Number(large.pde_only.toFixed(6))
      },
      alignment:{res16:{mode:small.mode,shift:small.shift},
        res32:{mode:large.mode,shift:large.shift}},
      components32:Object.fromEntries(Object.entries(large.components).map(
        ([k,v])=>[k,Number(v.toFixed(6))]))
    });
  }
  const modes=["res16","res32","fusion","no_pde32","pde_only32"];
  const sorted=Object.fromEntries(modes.map(k=>[k,[...rank].sort((a,b)=>
    b.scores[k]-a.scores[k]||a.canonical_visual_asset.localeCompare(b.canonical_visual_asset))
    .map((x,i)=>({rank:i+1,canonical_visual_asset:x.canonical_visual_asset,
      canonical_entity_id:x.canonical_entity_id,score:x.scores[k]}))]));
  const result={
    schema_version:1,version:"multiscale-rgba32-ablation-v1",
    input_key:inputKey,region_id:id,bbox:reg.bbox,entity_type_scope:"item_only_v1",
    labels_used_in_inference:false,candidate_source:"typed_coarse_top64_union_baseline_detail",
    source_32:"catalogue/item-native-rgba32-v1.json",
    candidate_count:selected.size,compared:rank.length,excluded,
    scoring_modes:modes,ranking:sorted,
    component_details:rank.map(x=>({asset:x.canonical_visual_asset,components32:x.components32,
      scores:x.scores})),generated_at:new Date().toISOString()
  };
  const key=bzMultiscaleBaseV1(inputKey)+id+".json";
  await env.BENCHMARK_R2.put(key,JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"}});
  return {key,compared:rank.length,exclusions:excluded.length,
    best:Object.fromEntries(modes.map(k=>[k,sorted[k][0]?.canonical_entity_id]))};
}
