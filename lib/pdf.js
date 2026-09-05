// Extracts plain text from a PDF file using pdf.js (loaded globally via next/script in
// app/layout.jsx). Used by both Onboard (schedule/syllabus upload) and Academics' syllabus sync.
export async function PDF(file){
  if(!window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const buf=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let t="";for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const c=await p.getTextContent();t+="\n"+c.items.map(x=>x.str).join(" ");}
  return t.trim();
}
