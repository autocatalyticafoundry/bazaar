
// Experimental non-neural convolution + anisotropic PDE comparison of crop-aware artwork.
// Region boxes are programmatic and candidates come only from the existing learned shortlist.
// Neither benchmark ground-truth labels nor scene-specific coordinates are consulted.
function bzAffineBaseV1(key){
  return "debug/region-affine-convolution-v1/"+bzRegionImageShaV1(key)+"/";
}
function bzAffineClampV1(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function bzAffineSampleV1(data,w,h,x,y){
  x=bzAffineClampV1(x,0,w-1);y=bzAffineClampV1(y,0,h-1);
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const u=x-x0,v=y-y0,a=(y0*w+x0)*4,b=(y0*w+x1)*4,
    c=(y1*w+x0)*4,d=(y1*w+x1)*4,arr=[];
  for(let j=0;j<3;j++)arr.push(
    ((data[a+j]*(1-u)+data[b+j]*u)*(1-v)+
    (data[c+j]*(1-u)+data[d+j]*u)*v)/255);
  return arr;
}
function bzAffineGridV1(im,box,W=32,H=48,mode="target",shift=0){
  const {width:w,height:h,rgba:data}=im,out=new Float32Array(W*H*3);
  const padx=mode==="target"?Math.max(3,box.width*.024):0;
  const pady=mode==="target"?Math.max(3,box.height*.027):0;
  const aspect=box.width/box.height;
  // Reference cover means center-cropping surplus landscape width to portrait art.
  // This tests crop, not deform, against independent x/y scale (stretch).
  let ox=0,oy=0,cw=w,ch=h;
  if(mode==="cover"){
    if(w/h>aspect){cw=h*aspect;ox=(w-cw)*(.5+shift);}
    else{ch=w/aspect;oy=(h-ch)*(.5+shift);}
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const u=(x+.5)/W,v=(y+.5)/H;
    const xx=mode==="target"?box.x+padx+u*(box.width-2*padx):ox+u*cw,
      yy=mode==="target"?box.y+pady+v*(box.height-2*pady):oy+v*ch;
    const col=bzAffineSampleV1(data,w,h,xx,yy);
    const i=3*(y*W+x);out[i]=col[0];out[i+1]=col[1];out[i+2]=col[2];
  }
  return out;
}
function bzAffineGrayV1(rgb){
  const out=new Float32Array(rgb.length/3);
  for(let i=0;i<out.length;i++)out[i]=rgb[3*i]*.299+rgb[3*i+1]*.587+rgb[3*i+2]*.114;
  return out;
}
function bzAffineGaussianV1(gray,W,H){
  // Separable 3x3 Gaussian convolution, kernel [1,2,1]/4.
  const tmp=new Float32Array(gray.length),out=new Float32Array(gray.length);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const a=gray[y*W+Math.max(0,x-1)],b=gray[y*W+x],
      c=gray[y*W+Math.min(W-1,x+1)];
    tmp[y*W+x]=(a+2*b+c)*.25;
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const a=tmp[Math.max(0,y-1)*W+x],b=tmp[y*W+x],
      c=tmp[Math.min(H-1,y+1)*W+x];
    out[y*W+x]=(a+2*b+c)*.25;
  }
  return out;
}
function bzAffineDiffusionV1(gray,W,H,n=4,kappa=.09){
  // Explicit nonlinear anisotropic heat equation (Perona-Malik style).
  // dt=.16 <= .25 stability bound for a 4-neighbor grid.
  let u=new Float32Array(gray);
  for(let z=0;z<n;z++){
    const out=new Float32Array(u.length);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,mid=u[i];
      let flow=0;
      const offsets=[y>0?i-W:i,y<H-1?i+W:i,x>0?i-1:i,x<W-1?i+1:i];
      for(let j=0;j<4;j++){
        const d=u[offsets[j]]-mid;
        flow+=d/(1+(d/kappa)*(d/kappa));
      }
      out[i]=bzAffineClampV1(mid+.16*flow,0,1);
    }
    u=out;
  }
  return u;
}
function bzAffineCorrV1(a,b){
  if(a.length!==b.length||a.length===0)throw new Error("size mismatch");
  let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}
  ma/=a.length;mb/=b.length;
  let aa=0,bb=0,ab=0;
  for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;aa+=x*x;bb+=y*y;ab+=x*y;}
  return aa*bb>1e-9?ab/Math.sqrt(aa*bb):0;
}
function bzAffineHogV1(gray,W,H){
  const cellsX=4,cellsY=6,bins=8,hist=new Float32Array(cellsX*cellsY*bins);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
    const p=y*W+x,dx=gray[p+1]-gray[p-1],dy=gray[p+W]-gray[p-W],
      mag=Math.hypot(dx,dy);
    if(mag<.001)continue;
    const ang=(Math.atan2(dy,dx)+Math.PI)%(Math.PI),bin=Math.min(bins-1,Math.floor(bins*ang/Math.PI)),
      cx=Math.min(cellsX-1,Math.floor(x*cellsX/W)),
      cy=Math.min(cellsY-1,Math.floor(y*cellsY/H));
    hist[(cy*cellsX+cx)*bins+bin]+=mag;
  }
  // Local L2 normalize to prevent brightness/contrast bias.
  for(let c=0;c<cellsX*cellsY;c++){
    let norm=.0001;for(let j=0;j<bins;j++)norm+=hist[c*bins+j]**2;
    norm=Math.sqrt(norm);for(let j=0;j<bins;j++)hist[c*bins+j]/=norm;
  }
  return hist;
}
function bzAffineHogCosineV1(a,b){
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]**2;nb+=b[i]**2;}
  return dot/Math.sqrt((na+.000001)*(nb+.000001));
}
function bzAffineChromaV1(rgb){
  const a=new Float32Array(rgb.length);
  for(let i=0;i<rgb.length;i+=3){
    const mean=(rgb[i]+rgb[i+1]+rgb[i+2])/3;
    a[i]=rgb[i]-mean;a[i+1]=rgb[i+1]-mean;a[i+2]=rgb[i+2]-mean;
  }
  return a;
}
function bzAffineSummaryV1(grid,W,H){
  const gray=bzAffineGrayV1(grid),blur=bzAffineGaussianV1(gray,W,H),
    diffusion=bzAffineDiffusionV1(blur,W,H);
  return {gray:blur,pde:diffusion,hog:bzAffineHogV1(blur,W,H),
    pdeHog:bzAffineHogV1(diffusion,W,H),chroma:bzAffineChromaV1(grid)};
}
function bzAffineCompareV1(x,y){
  const ga=(bzAffineCorrV1(x.gray,y.gray)+1)*.5,
    chroma=(bzAffineCorrV1(x.chroma,y.chroma)+1)*.5,
    h=bzAffineHogCosineV1(x.hog,y.hog),
    ph=bzAffineHogCosineV1(x.pdeHog,y.pdeHog),
    pd=(bzAffineCorrV1(x.pde,y.pde)+1)*.5;
  // Convolution/PDE jointly, no geometry override or absolute confidence.
  const score=.28*ga+.22*chroma+.24*h+.13*ph+.13*pd;
  return {score,ga,chroma,hog:h,pde_hog:ph,pde_correlation:pd};
}
async function bzAffinePrepareV1(env,body){
  const inputKey=String(body.input_key||""),
    base=bzAffineBaseV1(inputKey),
    a=await env.BENCHMARK_R2.get(bzRegionBaseV1(bzRegionImageShaV1(inputKey))+"result.json");
  if(!a)throw new Error("per-object shortlist result missing");
  const original=JSON.parse(await new Response(a.body).text());
  if(original.input_key!==inputKey)throw new Error("mixed screenshot shortlist source");
  const refs=new Map();
  for(let si=0;si<8;si++){
    const key="debug/whole-screen-local-feature-bank-v3/shards/shard-"+String(si).padStart(2,"0")+".json",
      obj=await env.BENCHMARK_R2.get(key);
    if(!obj)throw new Error("canonical shard missing "+si);
    const bank=JSON.parse(await new Response(obj.body).text());
    for(const row of bank.rows)refs.set(row.asset_path,row.source_sha256);
  }
  const regions=[];
  for(const r of original.regions){
    const by=new Map(),sha=bzRegionImageShaV1(inputKey);
    for(let si=0;si<8;si++){
      const key=bzRegionBaseV1(sha)+"rank-shard-"+String(si).padStart(2,"0")+".json",
        obj=await env.BENCHMARK_R2.get(key);
      if(!obj)throw new Error("source shortlist shard missing "+si);
      const shard=JSON.parse(await new Response(obj.body).text()),
        shortlist=shard.regions.find(x=>x.region_id===r.region_id)?.shortlist||[];
      for(const c of shortlist)if(!by.has(c.canonical_visual_asset)||
        by.get(c.canonical_visual_asset).raw_score<c.raw_score)
          by.set(c.canonical_visual_asset,c);
    }
    const ordered=[...by.values()].sort((a,b)=>b.raw_score-a.raw_score);
    const chosen=ordered.slice(0,24);
    // Fair representation from each database segment, not just global highest scores.
    for(let si=0;si<8;si++){
      if(chosen.some(c=>c.shard_index===si))continue;
      const best=ordered.find(c=>c.shard_index===si);
      if(best)chosen.push(best);
    }
    const selected=chosen.slice(0,32).map(c=>({
      canonical_visual_asset:c.canonical_visual_asset,
      source_sha256:refs.get(c.canonical_visual_asset)||null,
      feature_score:c.raw_score,shard_index:c.shard_index
    }));
    regions.push({region_id:r.region_id,bbox:r.bbox,candidates:selected});
  }
  const manifest={schema_version:1,version:"convolution-affine-candidate-manifest-v1",
    input_key:inputKey,catalogue_reference_count:refs.size,
    region_count:regions.length,regions,created_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"manifest.json",JSON.stringify(manifest),{
    httpMetadata:{contentType:"application/json"}});
  if(body.dispatch!==false){
    if(!env.REGION_QUEUE)throw new Error("dedicated REGION_QUEUE missing");
    await env.REGION_QUEUE.sendBatch(regions.map(reg=>({
      body:{kind:"affine_rerank_region_v1",input_key:inputKey,region_id:reg.region_id,
        output_key:base+"error-"+reg.region_id+".json"}
    })));
  }
  return {region_count:regions.length,manifest_key:base+"manifest.json"};
}
async function bzAffineRerankRegionV1(env,body){
  const inputKey=String(body.input_key||""),base=bzAffineBaseV1(inputKey),
    regionId=String(body.region_id||"");
  const manifestObj=await env.BENCHMARK_R2.get(base+"manifest.json");
  if(!manifestObj)throw new Error("missing comparison manifest");
  const manifest=JSON.parse(await new Response(manifestObj.body).text()),
    region=manifest.regions.find(r=>r.region_id===regionId);
  if(!region||manifest.input_key!==inputKey)throw new Error("invalid region id");
  const image=await env.BENCHMARK_R2.get(inputKey);
  if(!image)throw new Error("screenshot not available");
  const target=await decodePng(await new Response(image.body).arrayBuffer()),
    W=32,H=48,
    targetFeature=bzAffineSummaryV1(bzAffineGridV1(target,region.bbox,W,H),W,H),
    sorted=[],errors=[];
  for(const c of region.candidates){
    if(!/^[a-f0-9]{64}$/.test(c.source_sha256||"")){
      errors.push({name:c.canonical_visual_asset,error:"missing_reference_sha"});continue;
    }
    const ref=await env.BENCHMARK_R2.get("catalogue/item-visual-normalized-v1/"+
      c.source_sha256+".png");
    if(!ref){errors.push({name:c.canonical_visual_asset,error:"missing_normalized_art"});continue;}
    try{
      const png=await decodePng(await new Response(ref.body).arrayBuffer());
      let best=null;
      for(const mode of ["cover","stretch"]){
        for(const shift of mode==="cover"?[-.16,0,.16]:[0]){
          const grid=bzAffineGridV1(png,region.bbox,W,H,mode,shift),
            comp=bzAffineCompareV1(targetFeature,bzAffineSummaryV1(grid,W,H));
          if(!best||comp.score>best.score)best={...comp,mode,shift};
        }
      }
      sorted.push({canonical_visual_asset:c.canonical_visual_asset,feature_score:c.feature_score,
        comparison_score:Number(best.score.toFixed(6)),warp_mode:best.mode,
        cover_shift:best.shift,components:{
          gaussian_correlation:Number(best.ga.toFixed(5)),
          chroma_correlation:Number(best.chroma.toFixed(5)),
          gaussian_hog:Number(best.hog.toFixed(5)),
          pde_hog:Number(best.pde_hog.toFixed(5)),
          pde_correlation:Number(best.pde_correlation.toFixed(5))
        }});
    }catch(e){errors.push({name:c.canonical_visual_asset,error:e instanceof Error?e.message:String(e)});}
  }
  sorted.sort((a,b)=>b.comparison_score-a.comparison_score||
    b.feature_score-a.feature_score);
  const result={schema_version:1,version:"convolution-affine-region-v1",input_key:inputKey,
    region_id:regionId,bbox:region.bbox,total_candidate_count:region.candidates.length,
    successfully_compared:sorted.length,errors,candidates:sorted,
    scoring_semantics:"raw image comparison of 32x48 filtered grids; not probabilities",
    verified_geometry_not_modified:true};
  await env.BENCHMARK_R2.put(base+regionId+".json",JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"}});
  let ready=true;
  for(const r of manifest.regions)if(!await env.BENCHMARK_R2.head(base+r.region_id+".json")){
    ready=false;break;
  }
  if(ready)await bzAffineAggregateV1(env,{input_key:inputKey});
  return {region_id:regionId,compared:sorted.length,top:sorted.slice(0,3)};
}
async function bzAffineAggregateV1(env,body){
  const inputKey=String(body.input_key||""),base=bzAffineBaseV1(inputKey),
    m=await env.BENCHMARK_R2.get(base+"manifest.json");
  if(!m)throw new Error("missing manifest");
  const manifest=JSON.parse(await new Response(m.body).text()),
    originalObj=await env.BENCHMARK_R2.get(bzRegionBaseV1(bzRegionImageShaV1(inputKey))+"result.json"),
    original=JSON.parse(await new Response(originalObj.body).text()),regions=[];
  for(const r of manifest.regions){
    const x=await env.BENCHMARK_R2.get(base+r.region_id+".json");
    if(!x)throw new Error("missing region "+r.region_id);
    const v=JSON.parse(await new Response(x.body).text()),
      old=original.regions.find(q=>q.region_id===r.region_id);
    const verified=old?.verified||null;
    regions.push({region_id:r.region_id,bbox:r.bbox,verified,
      old_top1:old?.top_candidates?.[0]?.canonical_visual_asset||null,
      new_top1:v.candidates[0]?.canonical_visual_asset||null,
      top_candidates:v.candidates.slice(0,6),compared:v.successfully_compared,
      errors:v.errors});
  }
  const artifact={schema_version:1,version:"convolution-affine-candidate-sets-v1",
    input_key:inputKey,width:original.width,height:original.height,
    region_count:regions.length,regions,
    metrics:{candidates_compared:regions.reduce((s,r)=>s+r.compared,0),
      failed_reference_decodes:regions.reduce((s,r)=>s+r.errors.length,0),
      old_verified_hits:original.verified_region_count},
    evaluation_requirement:"Compare against independent human truth: do not infer correctness for unknown card IDs.",
    scoring_semantics:"Gaussian color/edge plus anisotropic-diffusion HOG under center-crop and nonuniform stretch. Scores are not probabilities.",
    generated_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(base+"result.json",JSON.stringify(artifact),{
    httpMetadata:{contentType:"application/json"}});
  return {result_key:base+"result.json",region_count:regions.length};
}
