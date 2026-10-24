
// Region-first screenshot recognition, native resolution, Cloudflare Worker only.
// Proposals are discovered using repeatable vertical art-frame boundaries,
// not hero, merchant, screen, or item hard-coded coordinates.
function bzRegionBaseV1(sha){return "debug/region-hypotheses-v1/"+sha+"/";}
function bzRegionImageShaV1(inputKey){
  const m=/^perception\/inputs\/([a-f0-9]{64})\.png$/.exec(String(inputKey));
  if(!m)throw new Error("region recognizer requires immutable PNG input SHA");
  return m[1];
}
function bzMedianV1(values){
  const a=[...values].sort((x,y)=>x-y);
  return a.length?a[Math.floor(a.length/2)]:0;
}
function bzRegionsFromPixelsV1(im){
  const {width:w,height:h,rgba:data}=im;
  if(w<320||h<320||w*h>24000000)throw new Error("unsupported region localization dimensions");
  const gray=new Uint8Array(w*h),lineSegments=[];
  for(let p=0;p<gray.length;p++){
    const k=p*4;gray[p]=Math.round(0.299*data[k]+0.587*data[k+1]+0.114*data[k+2]);
  }
  const stepX=Math.max(1,Math.round(w/683)),gapY=Math.max(6,Math.round(h*.012));
  const minL=Math.max(75,Math.round(h*.127)),maxL=Math.round(h*.30);
  for(let x=4;x<w-4;x+=stepX){
    let first=-1,prev=-1,n=0;
    const finish=()=>{
      if(first<0)return;
      const len=prev-first;
      if(len>=minL&&len<=maxL&&n/(len+1)>.40)
        lineSegments.push({x,y0:first,y1:prev,len,n});
    };
    for(let y=0;y<h;y++){
      const p=y*w+x;
      if(Math.abs(gray[p-2]-gray[p+2])<40)continue;
      if(prev>=0&&y-prev>gapY){finish();first=y;n=0;}
      if(first<0)first=y;
      prev=y;n++;
    }
    finish();
  }
  const yHalf=Math.max(6,Math.round(h*.0105)),votes=new Float32Array(h);
  for(const seg of lineSegments){
    const v=seg.n/(seg.len+1);
    for(let y=Math.max(0,seg.y0-yHalf);y<=Math.min(h-1,seg.y0+yHalf);y++)votes[y]+=v;
  }
  const minPeakDistance=Math.max(45,Math.round(h*.067));
  const peaks=[];
  for(let y=1;y<h-1;y++)if(votes[y]>=2.5&&votes[y]>=votes[y-1]&&votes[y]>votes[y+1])
    peaks.push({y,v:votes[y]});
  peaks.sort((a,b)=>b.v-a.v||a.y-b.y);
  const chosen=[];
  for(const peak of peaks){
    if(chosen.length>=10)break;
    if(chosen.every(p=>Math.abs(p.y-peak.y)>=minPeakDistance))chosen.push(peak);
  }
  const proposals=[],bands=[];
  for(const peak of chosen.sort((a,b)=>a.y-b.y)){
    const yBand=peak.y,near=Math.max(14,Math.round(h*.024));
    const s0=lineSegments.filter(t=>Math.abs(t.y0-yBand)<=near);
    if(s0.length<5)continue;
    const medianL=bzMedianV1(s0.map(t=>t.len));
    const consistent=s0.filter(t=>Math.abs(t.len-medianL)<=Math.max(24,Math.round(h*.045)))
      .sort((a,b)=>a.x-b.x);
    const groups=[],nearX=Math.max(9,Math.round(w*.0115));
    for(const t of consistent){
      if(!groups.length||t.x-groups[groups.length-1].at(-1).x>nearX)groups.push([t]);
      else groups[groups.length-1].push(t);
    }
    const centers=groups.map(g=>{
      const mass=g.reduce((z,t)=>z+t.n,0);
      return {x:Math.round(g.reduce((z,t)=>z+t.x*t.n,0)/mass),
        mass,count:g.length,y0:bzMedianV1(g.map(t=>t.y0)),
        y1:bzMedianV1(g.map(t=>t.y1))};
    }).sort((a,b)=>a.x-b.x);
    const regions=[];
    for(let k=0;k<centers.length-1;k++){
      const a=centers[k],b=centers[k+1],span=b.x-a.x;
      if(span<Math.max(65,Math.round(w*.049))||span>Math.round(w*.205))continue;
      // The frame boundary contains ornaments; take the artwork interior.
      const inX=Math.max(3,Math.round(w*.0034)),inY=Math.max(3,Math.round(h*.006));
      const box={x:Math.max(0,a.x+inX),y:Math.max(0,yBand+inY),
        width:Math.min(w-a.x-inX,span-2*inX),
        height:Math.min(h-yBand-inY,medianL-Math.round(h*.011))};
      if(box.width<55||box.height<80)continue;
      // Local gray variance distinguishes textured art from empty backdrop.
      let count=0,sum=0,sq=0,edge=0;
      const sx=Math.max(1,Math.floor(box.width/42)),sy=Math.max(1,Math.floor(box.height/48));
      for(let y=box.y+3;y<box.y+box.height-3;y+=sy)
        for(let x=box.x+3;x<box.x+box.width-3;x+=sx){
          const p=y*w+x,g=gray[p];sum+=g;sq+=g*g;edge+=Math.abs(g-gray[p-2]);
          count++;
        }
      const deviation=Math.sqrt(Math.max(0,sq/count-(sum/count)**2)),
        edgeContrast=edge/count;
      if(deviation<24||edgeContrast<2)continue;
      const region={bbox:box,proposal_score:Number((deviation+2*edgeContrast).toFixed(3)),
        border_evidence:{left_x:a.x,right_x:b.x,row_y:yBand,segment_height:medianL},
        texture_stddev:Number(deviation.toFixed(3))};
      regions.push(region);
    }
    // A single rectangle from HUD decoration is not considered an item row.
    if(regions.length<3)continue;
    bands.push({y:yBand,proposal_count:regions.length,edge_votes:Number(peak.v.toFixed(3))});
    proposals.push(...regions);
  }
  proposals.sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x);
  const unique=[];
  for(const p of proposals){
    const b=p.bbox;
    if(unique.some(q=>{
      const c=q.bbox,x=Math.max(0,Math.min(b.x+b.width,c.x+c.width)-Math.max(b.x,c.x)),
        y=Math.max(0,Math.min(b.y+b.height,c.y+c.height)-Math.max(b.y,c.y));
      return x*y/(b.width*b.height+c.width*c.height-x*y)>0.66;
    }))continue;
    unique.push({...p,region_id:"region-"+String(unique.length+1).padStart(2,"0")});
  }
  return {regions:unique.slice(0,36),bands,
    diagnostics:{vertical_segments:lineSegments.length,band_candidates:chosen.length,
      accepted_row_bands:bands.length,method:"native-boundary-repetition-v1"}};
}
async function bzLocalizeRegionsV1(env,body){
  const inputKey=String(body.input_key||""),
    sha=bzRegionImageShaV1(inputKey),base=bzRegionBaseV1(sha),
    obj=await env.BENCHMARK_R2.get(inputKey);
  if(!obj)throw new Error("region screenshot absent");
  const png=await decodePng(await new Response(obj.body).arrayBuffer());
  const result=bzRegionsFromPixelsV1(png);
  const artifact={schema_version:1,detector_version:"boundary-repetition-v1",
    input_key:inputKey,sha256:sha,width:png.width,height:png.height,
    ...result,generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"regions.json",JSON.stringify(artifact),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"screenshot-regions-v1",region_count:String(result.regions.length)}});
  if(body.dispatch!==false&&env.SCREENSHOT_QUEUE){
    await env.SCREENSHOT_QUEUE.sendBatch(Array.from({length:8},(_,si)=>({
      body:{kind:"region_rank_shard_v1",input_key:inputKey,shard_index:si}
    })));
  }
  return {region_count:result.regions.length,regions_key:base+"regions.json",bands:result.bands};
}
async function bzRankRegionsShardV1(env,body){
  const inputKey=String(body.input_key||""),sha=bzRegionImageShaV1(inputKey),
    base=bzRegionBaseV1(sha),si=Math.floor(Number(body.shard_index));
  if(!Number.isInteger(si)||si<0||si>7)throw new Error("invalid shard");
  const proposal=await env.BENCHMARK_R2.get(base+"regions.json");
  if(!proposal)throw new Error("region proposals missing");
  const obj=JSON.parse(await new Response(proposal.body).text());
  if(obj.input_key!==inputKey||!Array.isArray(obj.regions))throw new Error("region source mismatch");
  const bank=await lgLoadBank(env,"debug/whole-screen-local-feature-bank-v3/shards/shard-"+
    String(si).padStart(2,"0")+".json"),
    idx=await glLoadPackedIndexV2(env,si,3),tr=await glV3Screenshot(env,inputKey,1);
  const rows=[];
  for(const reg of obj.regions){
    const box=reg.bbox,pad=6,
      local=tr.features.filter(p=>p.x>=box.x+pad&&p.y>=box.y+pad&&
        p.x<box.x+box.width-pad&&p.y<box.y+box.height-pad);
    const votes=local.length>=4?glRareVotePacked(local,bank.refs,idx,Math.min(12,bank.refs.length),48):[];
    rows.push({region_id:reg.region_id,feature_count:local.length,
      shortlist:votes.map(v=>({canonical_visual_asset:bank.refs[v.i].asset_path,
        raw_score:Number(v.score.toFixed(5)),votes:Number(v.votes.toFixed(4)),
        hits:v.hits,reference_features:bank.refs[v.i].features.length,shard_index:si}))});
  }
  const output={schema_version:1,ranker_version:"region-brief128-v3-rarity-v1",
    input_key:inputKey,region_source_key:base+"regions.json",shard_index:si,
    reference_count:bank.refs.length,descriptor_scale:1,regions:rows};
  await env.BENCHMARK_R2.put(base+"rank-shard-"+String(si).padStart(2,"0")+".json",
    JSON.stringify(output),{httpMetadata:{contentType:"application/json"}});
  let finished=true;
  for(let k=0;k<8;k++){
    if(!await env.BENCHMARK_R2.head(base+"rank-shard-"+String(k).padStart(2,"0")+".json")){
      finished=false;break;
    }
  }
  if(finished)await bzAggregateRegionsV1(env,{input_key:inputKey});
  return {shard_index:si,region_count:rows.length,complete:finished};
}
function bzRegionIoUV1(b,c){
  if(!b||!c)return 0;
  const x=Math.max(0,Math.min(b.x+b.width,c.x+c.width)-Math.max(b.x,c.x)),
    y=Math.max(0,Math.min(b.y+b.height,c.y+c.height)-Math.max(b.y,c.y));
  return x*y/(b.width*b.height+c.width*c.height-x*y)||0;
}
async function bzAggregateRegionsV1(env,body){
  const inputKey=String(body.input_key||""),sha=bzRegionImageShaV1(inputKey),
    base=bzRegionBaseV1(sha),obj=await env.BENCHMARK_R2.get(base+"regions.json");
  if(!obj)throw new Error("regions missing for aggregation");
  const loc=JSON.parse(await new Response(obj.body).text());
  const rs=[];
  for(let si=0;si<8;si++){
    const key=base+"rank-shard-"+String(si).padStart(2,"0")+".json",
      o=await env.BENCHMARK_R2.get(key);
    if(!o)throw new Error("ranking shard absent "+si);
    const x=JSON.parse(await new Response(o.body).text());
    if(x.shard_index!==si||x.input_key!==inputKey)throw new Error("mixed ranking shards");
    rs.push(x);
  }
  const old=await env.BENCHMARK_R2.get(
    "debug/experimental-screenshot-v1/"+sha+"/aggregated.json");
  const accepted=old?JSON.parse(await new Response(old.body).text()).detections||[]:[];
  const rows=loc.regions.map(reg=>{
    const region=reg.region_id,b=reg.bbox;
    const all=rs.flatMap(sh=>sh.regions.find(x=>x.region_id===region)?.shortlist||[]);
    const unique=new Map();
    for(const c of all){
      const key=c.canonical_visual_asset,old=unique.get(key);
      if(!old||old.raw_score<c.raw_score)unique.set(key,c);
    }
    const ordered=[...unique.values()].sort((a,b)=>b.raw_score-a.raw_score||
      a.canonical_visual_asset.localeCompare(b.canonical_visual_asset));
    const pin=accepted.map(a=>({...a,iou:bzRegionIoUV1(b,a.bbox)}))
      .sort((a,b)=>b.iou-a.iou)[0];
    const verified=pin?.iou>=.50?{
      canonical_visual_asset:pin.canonical_visual_asset,
      proof:pin.proof,overlap_iou:Number(pin.iou.toFixed(4))
    }:null;
    if(verified){
      const at=ordered.findIndex(c=>c.canonical_visual_asset===verified.canonical_visual_asset);
      if(at>0)ordered.unshift(ordered.splice(at,1)[0]);
      else if(at<0)ordered.unshift({
        canonical_visual_asset:verified.canonical_visual_asset,raw_score:null,
        votes:null,hits:null,shard_index:pin.proof?.shard_index});
    }
    const top=ordered.slice(0,6),finite=top.filter(c=>Number.isFinite(c.raw_score));
    const max=finite.length?Math.max(...finite.map(c=>c.raw_score)):0;
    const temp=Math.max(.6,max*.17);
    const exp=top.map(c=>Number.isFinite(c.raw_score)?
      Math.exp((c.raw_score-max)/temp):0),norm=exp.reduce((a,b)=>a+b,0);
    return {region_id:region,bbox:b,proposal_score:reg.proposal_score,
      target_feature_count:rs[0].regions.find(x=>x.region_id===region)?.feature_count||0,
      status:verified?"verified_visual_reference":"unverified_hypotheses",
      verified,top_candidates:top.map((c,i)=>({
        rank:i+1,canonical_visual_asset:c.canonical_visual_asset,
        raw_score:c.raw_score,relative_support_pct:norm?
          Number((100*exp[i]/norm).toFixed(2)):null,
        votes:c.votes,hits:c.hits,shard_index:c.shard_index,
        verification:verified?.canonical_visual_asset===c.canonical_visual_asset?
          "accepted_geometry":"unverified"
      }))};
  });
  const result={schema_version:1,version:"region-first-candidate-sets-v1",
    input_key:inputKey,sha256:sha,width:loc.width,height:loc.height,
    region_count:rows.length,regions:rows,
    catalogue_reference_count:rs.reduce((a,s)=>a+s.reference_count,0),
    verified_region_count:rows.filter(r=>r.verified).length,
    metrics:{localizer:loc.diagnostics,region_count:rows.length,
      shard_count:rs.length,ranked_region_shard_pairs:rs.reduce((n,s)=>n+s.regions.length,0)},
    score_semantics:{
      raw_score:"rare BRIEF128 feature votes, normalized for reference feature count",
      relative_support_pct:"softmax-normalized weight within top candidates ONLY, not a calibrated probability",
      unknown_class:"not estimated; missing candidates and artwork absence remain possible",
      probability_calibrated:false,
      verification:"accepted geometric verification only, never inferred from candidate scores"
    },generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"result.json",JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"region-first-candidate-sets-v1",
      proposal_count:String(rows.length),verified_count:String(result.verified_region_count)}});
  return {result_key:base+"result.json",region_count:rows.length,
    verified_region_count:result.verified_region_count};
}
