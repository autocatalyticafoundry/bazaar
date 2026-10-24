
// Experimental-only screenshot ingestion. Browser/client uploads BYTES ONLY;
// all recognition and visual feature extraction remain server-side.
// This endpoint is disabled unless env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN exists.
const BAZAAR_MAX_SCREENSHOT_BYTES=10*1024*1024;
async function bzScreenshotUploadV1(request,env){
  if(!env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN) return new Response(JSON.stringify({
    ok:false,error:"upload_not_configured"
  }),{status:503,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const authorization=request.headers.get("authorization")||"";
  const expected="Bearer "+env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN;
  // Avoid direct early character-by-character leaks.
  const encoder=new TextEncoder(),actual=encoder.encode(authorization),target=encoder.encode(expected);
  let diff=actual.length^target.length;
  for(let i=0;i<Math.max(actual.length,target.length);i++)
    diff|=(actual[i]||0)^(target[i]||0);
  if(diff!==0)return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{
    status:401,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const media=(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  if(media!=="image/png")return new Response(JSON.stringify({ok:false,error:"png_required"}),{
    status:415,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const n=Number(request.headers.get("content-length")||0);
  if(n>BAZAAR_MAX_SCREENSHOT_BYTES)return new Response(JSON.stringify({ok:false,error:"image_too_large"}),{
    status:413,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const ab=await request.arrayBuffer();
  if(ab.byteLength<33||ab.byteLength>BAZAAR_MAX_SCREENSHOT_BYTES)
    return new Response(JSON.stringify({ok:false,error:"invalid_image_size"}),{
      status:413,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const bytes=new Uint8Array(ab);
  const sig=[137,80,78,71,13,10,26,10];
  if(sig.some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.slice(12,16))!=="IHDR")
    return new Response(JSON.stringify({ok:false,error:"invalid_png"}),{
      status:415,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const view=new DataView(ab);
  const width=view.getUint32(16),height=view.getUint32(20);
  if(width<64||height<64||width>8192||height>8192||
     width*height>24000000) return new Response(JSON.stringify({
       ok:false,error:"invalid_dimensions"
     }),{status:422,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",ab)),
    x=>x.toString(16).padStart(2,"0")).join("");
  const key="perception/inputs/"+sha+".png";
  const prior=await env.BENCHMARK_R2.head(key);
  if(!prior)await env.BENCHMARK_R2.put(key,ab,{
    httpMetadata:{contentType:"image/png"},customMetadata:{
      artifact:"experimental-native-screenshot",sha256:sha,
      width:String(width),height:String(height),bytes:String(ab.byteLength)
    }});
  const response={schema_version:1,ok:true,input_key:key,sha256:sha,
    width,height,bytes:ab.byteLength,previously_present:!!prior,
    recognition_status:"not_submitted",runtime:"Cloudflare server-side"};
  return new Response(JSON.stringify(response),{
    status:201,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
