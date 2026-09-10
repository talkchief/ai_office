import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function extractDocument({name,data}){
  if(typeof name!=='string'||typeof data!=='string'||data.length>7*1024*1024)throw new Error('Upload a document under 5 MB.');
  const extension=path.extname(name).toLowerCase(),buffer=Buffer.from(data,'base64');
  if(!['.txt','.md','.csv','.pdf','.docx'].includes(extension))throw new Error('Supported documents: PDF, DOCX, Markdown, text and CSV.');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'space-document-'));let content;
  try{
    const file=path.join(dir,'document'+extension);await fs.writeFile(file,buffer,{mode:0o600});
    if(extension==='.pdf')({stdout:content}=await exec('pdftotext',['-layout',file,'-'],{timeout:20000,maxBuffer:1024*1024}));
    else if(extension==='.docx')({stdout:content}=await exec('python3',['-c',`import sys,zipfile,xml.etree.ElementTree as E\nwith zipfile.ZipFile(sys.argv[1]) as z:\n info=z.getinfo('word/document.xml')\n if info.file_size>2000000: raise ValueError('Document too large')\n root=E.fromstring(z.read(info))\n print('\\n'.join(''.join(p.itertext()) for p in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')))`,file],{timeout:20000,maxBuffer:1024*1024}));
    else content=buffer.toString('utf8');
    if(!content?.trim())throw new Error('No readable text found. Scanned PDFs need OCR or a text version.');
    if(content.length>150000)throw new Error('Document exceeds 150000 characters. Split or shorten it.');
    return {name:path.basename(name).slice(0,180),content:content.trim(),characters:content.trim().length};
  }catch(error){if(error.code==='ENOENT')throw new Error('The document reader is not installed on this server. Upload text or Markdown.');throw new Error(error.message.includes('characters')||error.message.includes('readable text')?error.message:'Could not read this document. Upload an unencrypted PDF, DOCX, or text file.');}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
