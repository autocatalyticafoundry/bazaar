
// Optional diagnostic-only regions omitted by the repeated-card-row gate.
// Never merges fallback guesses into accepted cards without independent evidence.
function bzFallbackBaseV1(inputKey){
  return "debug/region-fallback-v2/"+bzRegionImageShaV1(inputKey)+"/";
}
async function bzFallbackStartV1(env,body){
  const inputKey=String(body.input_key||""),sha=bzRegionImageShaV1(inputKey),
    l=await env.BENCHMARK_R2.get(bzRegionBaseV1(sha)+"regions.json");
  if(!l)throw new Error("localization_missing");
  const loc=JSON.parse(await new Response(l.body).text()),regions=[];
  for(const band of loc.rejected_bands||[]){
    for(const b of band.candidates||[]){
      if(!bzRegionIoUV1||!(b.width>80&&b.height>100))continue;
      if(loc.regions.some(x=>bzRegionIoUV1(b,x.bbox)>.25))continue;
      regions.push({
        region_id:"fallback-"+String(regions.length+1).padStart(2,"0"),
        bbox:b,source_band_y:band.y,band_proposal_count:band.proposal_count,
        proposal_status:"rejected_by_primary_localizer",source:"isolated_rejected_band"
      });
    }
  }
  // Supplemental wider rectangles are evidence-only. Never mix them into
  // primary playable-card counts or assert an identity without verification.
  for(const band of loc.bands||[]){
    if(band.proposal_count<3)continue;
    for(const probe of band.wide_spans||[]){
      const b=probe.bbox;
      if(!b||!(b.width>80&&b.height>100))continue;
      if(loc.regions.some(x=>bzRegionIoUV1(b,x.bbox)>.25))continue;
      if(regions.some(x=>bzRegionIoUV1(b,x.bbox)>.66))continue;
      regions.push({
        region_id:"fallback-"+String(regions.length+1).padStart(2,"0"),
        bbox:b,source_band_y:band.y,band_proposal_count:band.proposal_count,
        proposal_status:"diagnostic_only",source:"wide_cadence_frame_span",
        proposal_score:probe.proposal_score,texture_stddev:probe.texture_stddev,
        span_in_units:probe.span_in_units,border_evidence:probe.border_evidence
      });
    }
  }
  const base=bzFallbackBaseV1(inputKey),
    doc={schema_version:1,version:"isolated-and-wide-frame-probes-v2",
      input_key:inputKey,regions,region_count:regions.length,
      acceptance_policy:"diagnostic_only_never_promote_without_verification",
      comparison_source:"rejected_bands and wide_spans from accepted pixel-frame rows",
      generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"regions.json",JSON.stringify(doc),{
    httpMetadata:{contentType:"application/json"}});
  if(regions.length>16)throw new Error("too_many_supplemental_regions");
  if(body.dispatch!==false&&regions.length){
    if(!env.REGION_QUEUE)throw new Error("REGION_QUEUE_missing");
    await env.REGION_QUEUE.sendBatch(regions.map(r=>({
      body:{kind:"fullconv_region_v1",input_key:inputKey,
        region_id:r.region_id,region_set:"fallback",
        output_key:base+"error-"+r.region_id+".json"}
    })));
  }
  return {proposed_regions:regions.length,region_source:base+"regions.json",
    score_prefix:base};
}
async function bzFallbackAggregateV1(env,body){
  const inputKey=String(body.input_key||""),base=bzFallbackBaseV1(inputKey),
    o=await env.BENCHMARK_R2.get(base+"regions.json");
  if(!o)throw new Error("fallback_regions_missing");
  const manifest=JSON.parse(await new Response(o.body).text()),rows=[];
  for(const r of manifest.regions){
    const v=await env.BENCHMARK_R2.get(base+r.region_id+".json");
    if(!v)throw new Error("fallback_comparison_missing "+r.region_id);
    const x=JSON.parse(await new Response(v.body).text());
    rows.push({region_id:r.region_id,bbox:r.bbox,
      status:"unverified_fallback_region",source:r.source,span_in_units:r.span_in_units||null,compared:x.compared,
      top:x.top.slice(0,6),source_band_y:r.source_band_y});
  }
  const result={schema_version:1,version:"isolated-and-wide-frame-probes-v2",
    input_key:inputKey,region_count:rows.length,regions:rows,
    all_regions_unverified:true,no_identity_acceptances:true,
    warnings:["Rejected band regions may be HUD or decoration","Wide spans may be non-card panels","Ranked candidates are not card detections"],
    generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"result.json",JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"}});
  return {result_key:base+"result.json",regions:rows.length};
}
