// 사용: node render.js <이미지 폴더(_src/data.js 있는 곳)> [img1]
const {puppeteer,CHROME}=require('../chrome');
const path=require('path');const fs=require('fs');const os=require('os');
const dir=path.resolve(process.argv[2]);const only=process.argv[3];
const src=path.join(dir,'_src');
for(const f of ['base.css','comic.js','head.js','img1.html','img2.html','img3.html','img4.html'])fs.copyFileSync(path.join(__dirname,f),path.join(src,f));
const D=new Function('window',fs.readFileSync(path.join(src,'data.js'),'utf8')+';return window.D')({});
const files=D.files.map((o,i)=>['img'+(i+1)+'.html',o]);
(async()=>{
 const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--font-render-hinting=none','--disable-gpu'],userDataDir:path.join(os.tmpdir(),'bokbok-pupp-render')});
 const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 for(const [s,out] of files){
   if(only&&!s.includes(only))continue;
   await p.setViewport({width:860,height:200,deviceScaleFactor:2});
   await p.goto(require('url').pathToFileURL(path.join(src,s)).href,{waitUntil:'networkidle0'});
   await p.evaluate(()=>document.fonts.ready);await new Promise(r=>setTimeout(r,500));
   const h=await p.evaluate(()=>Math.ceil(document.body.getBoundingClientRect().height));
   await p.setViewport({width:860,height:h,deviceScaleFactor:2});
   await p.screenshot({path:path.join(dir,out)});console.log(out,'860x'+h);
 }
 if(errs.length)console.log('JS ERR',errs);
 await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
