require('http').createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{require('fs').writeFileSync(process.argv[2],b);res.end('ok')})}).listen(3999);
