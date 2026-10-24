
// Independent, post-inference evaluation. Human gold labels are read ONLY after
// candidate scores already exist in R2, and cannot influence retrieval or ranking.
async function bzEvaluateGoldV1(env,body){
  const inputKey=String(body.input_key||""),sha=bzRegionImageShaV1(inputKey);
  const resultKey=String(body.result_key||bzFullConvBaseV1(inputKey)+"result.json"),
    goldKey=String(body.gold_key||bzFullConvBaseV1(inputKey)+"gold-confirmed.json"),
    outputKey=String(body.output_key||bzFullConvBaseV1(inputKey)+"evaluation.json");
  for(const key of [resultKey,goldKey,outputKey])
    if(!key.startsWith("debug/")||!key.endsWith(".json"))
      throw new Error("invalid_evaluation_artifact_path");
  if(!resultKey.includes(sha)||!goldKey.includes(sha)||!outputKey.includes(sha))
    throw new Error("evaluation_requires_same_screenshot_sha");
  const [g,r]=await Promise.all([env.BENCHMARK_R2.get(goldKey),env.BENCHMARK_R2.get(resultKey)]);
  if(!g||!r)throw new Error("gold_or_scored_result_missing");
  const gold=JSON.parse(await new Response(g.body).text()),
    result=JSON.parse(await new Response(r.body).text());
  if(gold.screenshot_sha256!==sha||result.input_key!==inputKey)
    throw new Error("evaluation_source_mismatch");
  if(!Array.isArray(gold.regions)||!Array.isArray(result.regions))
    throw new Error("unstructured_evaluation_input");
  const labels=gold.regions.filter(r=>r.identity_human_verified===true);
  if(!labels.length)throw new Error("no_human_verified_labels");
  const rows=[];
  for(const label of labels){
    const v=result.regions.find(x=>x.region_id===label.region_id);
    if(!v){rows.push({region_id:label.region_id,missed:true,true_asset:label.canonical_visual_asset});continue;}
    const scored=v.ranked_top||[],
      matchRank=scored.findIndex(x=>x.canonical_visual_asset===label.canonical_visual_asset);
    rows.push({
      region_id:label.region_id,true_asset:label.canonical_visual_asset,
      top_asset:scored[0]?.canonical_visual_asset||null,
      top1:matchRank===0,top3:matchRank>=0&&matchRank<3,
      rank:matchRank<0?null:matchRank+1,missed:false,
      bbox:v.bbox,score:scored[0]?.score||null,
      top_margin:scored.length>1?Number((scored[0].score-scored[1].score).toFixed(6)):null
    });
  }
  const f=rows.filter(x=>x.top1).length,top3=rows.filter(x=>x.top3).length,
    proposalMissed=rows.filter(x=>x.missed).length;
  const report={schema_version:1,kind:"post_inference_gold_evaluation_v1",
    screenshot_sha256:sha,input_key:inputKey,
    source_gold_key:goldKey,source_ranking_key:resultKey,
    evaluated_human_labels:labels.length,ranked_proposal_count:result.regions.length,
    correct_top1:f,correct_top3:top3,
    top1_pct:Number((100*f/labels.length).toFixed(2)),
    top3_pct:Number((100*top3/labels.length).toFixed(2)),
    missing_labelled_regions:proposalMissed,
    has_calibrated_probabilities:false,
    no_gold_label_during_inference:true,
    rows,computed_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(outputKey,JSON.stringify(report),{
    httpMetadata:{contentType:"application/json"}});
  return {output_key:outputKey,top1:report.correct_top1,
    top3:report.correct_top3,total:labels.length};
}
