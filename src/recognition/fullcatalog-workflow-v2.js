
// Full-catalogue region-first workflow. Works on any immutable screenshot in R2.
// Idempotent stage orchestration; labels/ground truth never enter the image pipeline.
async function bzFullcatalogStartV2(env,body){
  const inputKey=String(body.input_key||""),
    sha=bzRegionImageShaV1(inputKey),
    base=bzFullConvBaseV1(inputKey),
    locKey=bzRegionBaseV1(sha)+"regions.json";
  const source=await env.BENCHMARK_R2.head(inputKey);
  if(!source)throw new Error("screenshot_missing");
  let loc=await env.BENCHMARK_R2.get(locKey);
  let localization_action="reused";
  if(!loc||body.relocalize===true){
    // Don't dispatch BRIEF jobs here. This workflow starts with all-card
    // full-catalogue retrieval, independent of the earlier weak shortlist.
    await bzLocalizeRegionsV1(env,{input_key:inputKey,dispatch:false});
    loc=await env.BENCHMARK_R2.get(locKey);
    localization_action="created";
  }
  if(!loc)throw new Error("localization_failed");
  const l=JSON.parse(await new Response(loc.body).text());
  if(l.input_key!==inputKey||!Array.isArray(l.regions))throw new Error("localization_input_mismatch");
  if(l.regions.length===0)throw new Error("no_card_regions_detected");
  if(l.regions.length>36)throw new Error("too_many_card_regions");
  // Only add diagnostic retrieval for cadence-supported wide frame spans.
  // Its scores never become accepted playable-card identities.
  const wideSpanCount=(l.bands||[]).reduce((n,b)=>n+(b.wide_spans?.length||0),0);
  let supplemental_action="not_required",supplemental_error=null;
  if(wideSpanCount){
    const prior=await env.BENCHMARK_R2.head(bzFallbackBaseV1(inputKey)+"regions.json");
    if(prior&&body.retry_supplemental!==true)supplemental_action="reused";
    else try{
      await bzFallbackStartV1(env,{input_key:inputKey,dispatch:true});
      supplemental_action="submitted";
    }catch(e){
      supplemental_action="failed";
      supplemental_error=e instanceof Error?e.message:String(e);
    }
  }
  const pending=[],finished=[],errors=[];
  for(const region of l.regions){
    const id=region.region_id;
    if(!/^region-\d{2}$/.test(id))throw new Error("invalid_region_id");
    const out=base+id+".json",o=await env.BENCHMARK_R2.get(out);
    if(o){
      const v=JSON.parse(await new Response(o.body).text());
      if(v.input_key===inputKey&&v.region_id===id&&v.compared>0){
        finished.push(id);continue;
      }
    }
    const err=base+"error-"+id+".json",e=await env.BENCHMARK_R2.get(err);
    if(e){
      const d=JSON.parse(await new Response(e.body).text());
      errors.push({region_id:id,error:d.error||"unclassified_error"});
    }
    pending.push({id,out,err});
  }
  let queue_state="not_required";
  if(pending.length){
    if(!env.REGION_QUEUE)throw new Error("REGION_QUEUE binding missing");
    // Existing invalid jobs are safe to retry. Failed prior shards stay
    // isolated; never depend on queue backlog count for completion.
    for(let i=0;i<pending.length;i+=50){
      await env.REGION_QUEUE.sendBatch(pending.slice(i,i+50).map(p=>({
        body:{kind:"fullconv_region_v1",input_key:inputKey,
          region_id:p.id,output_key:p.err}
      })));
    }
    queue_state="submitted";
  }else{
    const aggregate=await env.BENCHMARK_R2.head(base+"result.json");
    if(!aggregate){
      await bzFullConvAggregateV1(env,{input_key:inputKey});
      queue_state="aggregated";
    }
  }
  const info={schema_version:2,workflow:"fullcatalog_region_first_v2",
    input_key:inputKey,sha256:sha,localization_action,
    region_count:l.regions.length,wide_span_diagnostic_count:wideSpanCount,
    supplemental_action,supplemental_error,wide_card_acceptances:0,
    queued_count:pending.length,
    completed_count:finished.length,known_failure_count:errors.length,
    prior_errors:errors,queue_state,
    region_prefix:base,result_key:base+"result.json",
    probability_calibrated:false,geometry_acceptance_unchanged:true,
    report_generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"workflow-latest.json",JSON.stringify(info),{
    httpMetadata:{contentType:"application/json"}});
  return info;
}
async function bzFullcatalogStatusV2(env,inputKey){
  const sha=bzRegionImageShaV1(inputKey),base=bzFullConvBaseV1(inputKey),
    localization=await env.BENCHMARK_R2.get(bzRegionBaseV1(sha)+"regions.json");
  if(!localization)return {status:"localization_pending",regions:[],complete:false};
  const loc=JSON.parse(await new Response(localization.body).text()),regions=[];
  for(const r of loc.regions){
    const id=r.region_id,out=await env.BENCHMARK_R2.get(base+id+".json");
    if(out){
      const a=JSON.parse(await new Response(out.body).text());
      if(a.input_key===inputKey&&a.compared>0){
        regions.push({region_id:id,bbox:r.bbox,status:"ranked",
          candidate_count:a.compared,
          top:a.top.slice(0,6).map((x,i)=>({
            rank:i+1,canonical_visual_asset:x.canonical_visual_asset,
            similarity_score:x.score,verification:"unverified_by_this_stage"
          }))});
        continue;
      }
    }
    const e=await env.BENCHMARK_R2.get(base+"error-"+id+".json");
    let error=null;
    if(e)error=JSON.parse(await new Response(e.body).text()).error||"failed";
    regions.push({region_id:id,bbox:r.bbox,status:error?"failed":"pending",
      ...(error?{error}:{})});
  }
  const complete=regions.length>0&&regions.every(r=>r.status==="ranked"),
    ready=await env.BENCHMARK_R2.get(base+"result.json");
  const result=ready?JSON.parse(await new Response(ready.body).text()):null;
  const wideCandidates=[];
  const suppBase=bzFallbackBaseV1(inputKey),
    supplemental=await env.BENCHMARK_R2.get(suppBase+"regions.json");
  if(supplemental){
    const list=JSON.parse(await new Response(supplemental.body).text());
    for(const proposal of (list.regions||[]).filter(r=>r.source==="wide_cadence_frame_span")){
      const obj=await env.BENCHMARK_R2.get(suppBase+proposal.region_id+".json");
      const rank=obj?JSON.parse(await new Response(obj.body).text()):null;
      wideCandidates.push({
        region_id:proposal.region_id,bbox:proposal.bbox,
        source:"wide_cadence_frame_span",status:rank?"ranked_unverified":"pending",
        accepted_as_playable_card:false,
        top:rank?.top?.slice(0,6).map((x,i)=>({
          rank:i+1,canonical_visual_asset:x.canonical_visual_asset,
          similarity_score:x.score,verification:"unverified_by_this_stage"
        }))||[]
      });
    }
  }
  return {status:complete?"ranked":regions.some(r=>r.status==="failed")?"partial_failure":"processing",
    input_key:inputKey,region_count:regions.length,
    ranked_count:regions.filter(x=>x.status==="ranked").length,
    failed_count:regions.filter(x=>x.status==="failed").length,
    complete,aggregate_ready:!!result,regions,
    supplemental_wide_region_count:wideCandidates.length,
    supplemental_wide_regions:wideCandidates,supplemental_accepted_count:0,
    note:"Similarity scores and top guesses are not calibrated probabilities or independently verified identities.",
    result_key:base+"result.json"};
}


async function bzFullcatalogStatusSnapshotV2(env,body){
  const inputKey=String(body.input_key||""),
    sha=bzRegionImageShaV1(inputKey),
    out=String(body.output_key||
      bzFullConvBaseV1(inputKey)+"status-snapshot.json");
  if(!out.startsWith("debug/")||!out.endsWith(".json"))
    throw new Error("invalid output path");
  const status=await bzFullcatalogStatusV2(env,inputKey);
  const doc={schema_version:2,workflow:"fullcatalog_region_first_v2",
    sha256:sha,generated_at:new Date().toISOString(),...status};
  await env.BENCHMARK_R2.put(out,JSON.stringify(doc),{
    httpMetadata:{contentType:"application/json"}});
  return {key:out,region_count:doc.region_count,
    ranked_count:doc.ranked_count,aggregate_ready:doc.aggregate_ready};
}
