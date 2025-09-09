// PNG batch resizer SPA

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const presets = [
  { name: '32x32.png', w: 32, h: 32, checked: true },
  { name: '128x128.png', w: 128, h: 128, checked: true },
  { name: '128x128@2x.png', w: 256, h: 256, checked: true },
  { name: 'Square30x30Logo.png', w: 30, h: 30, checked: true },
  { name: 'Square44x44Logo.png', w: 44, h: 44, checked: true },
  { name: 'Square71x71Logo.png', w: 71, h: 71, checked: true },
  { name: 'Square89x89Logo.png', w: 89, h: 89, checked: true },
  { name: 'Square107x107Logo.png', w: 107, h: 107, checked: true },
  { name: 'Square142x142Logo.png', w: 142, h: 142, checked: true },
  { name: 'Square150x150Logo.png', w: 150, h: 150, checked: true },
  { name: 'Square284x284Logo.png', w: 284, h: 284, checked: true },
  { name: 'Square310x310Logo.png', w: 310, h: 310, checked: true },
  { name: 'StoreLogo.png', w: 50, h: 50, checked: true },
  { name: 'icon.png', w: 512, h: 512, checked: true },
  // ICO / ICNS will be generated separately if checked in format options
];

let sourceImage = null; // ImageBitmap
let sourceName = '';

function humanSize(bytes){
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(2) + ' MB';
}

function el(tag, props={}, ...children){
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children){
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  }
  return e;
}

function renderPresets(){
  const container = $('#presetContainer');
  container.innerHTML = '';
  presets.forEach((p, idx) => {
    const id = `preset_${idx}`;
    const row = el('label', { className: 'preset' },
      el('input', {
        type: 'checkbox', checked: !!p.checked,
        oninput: (e) => { p.checked = e.target.checked; }
      }),
      el('div', {},
        el('div', { style: 'font-weight:600' }, p.name),
        el('div', { className: 'meta' }, `${p.w} × ${p.h}`)
      ),
      el('span', { style: 'margin-left:auto;color:var(--muted);font-size:12px' }, 'PNG')
    );
    container.appendChild(row);
  });
}

function enableActions(enable){
  $('#generateBtn').disabled = !enable;
  $('#previewBtn').disabled = !enable;
}

async function loadFile(file){
  const buf = await file.arrayBuffer();
  const bitmap = await createImageBitmap(new Blob([buf]));
  sourceImage = bitmap;
  sourceName = file.name;
  $('#fileInfo').textContent = `${file.name} · ${bitmap.width}×${bitmap.height} · ${humanSize(file.size)}`;
  enableActions(true);
}

function getMode(){
  return (document.querySelector('input[name="mode"]:checked')?.value) || 'width';
}

function resizeToCanvas(img, targetW, targetH, mode){
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,targetW,targetH);

  let drawW, drawH;
  const ratio = img.width / img.height;

  if (mode === 'width'){
    drawW = targetW; drawH = Math.round(targetW / ratio);
  } else if (mode === 'height'){
    drawH = targetH; drawW = Math.round(targetH * ratio);
  } else { // contain (fixed canvas)
    const scale = Math.min(targetW / img.width, targetH / img.height);
    drawW = Math.round(img.width * scale);
    drawH = Math.round(img.height * scale);
  }

  // Center on canvas
  const dx = Math.floor((targetW - drawW) / 2);
  const dy = Math.floor((targetH - drawH) / 2);

  // High-quality scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return canvas;
}

async function canvasToPngBlob(canvas){
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// --- ZIP (store) minimal writer ---
class ZipWriter {
  constructor(){
    this.files = [];
    this.offset = 0;
    this.chunks = [];
  }
  static crc32(buf){
    // CRC32 table
    if (!ZipWriter._table){
      ZipWriter._table = new Uint32Array(256);
      for (let i=0;i<256;i++){
        let c = i;
        for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
        ZipWriter._table[i] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i=0;i<buf.length;i++) crc = ZipWriter._table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  _pushBytes(bytes){ this.chunks.push(bytes); this.offset += bytes.length; }
  _strBytes(str){ return new TextEncoder().encode(str); }
  _dateDos(d = new Date()){
    const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((Math.floor(d.getSeconds()/2)) & 0x1F);
    const date = (((d.getFullYear()-1980) & 0x7F) << 9) | (((d.getMonth()+1) & 0xF) << 5) | ((d.getDate()) & 0x1F);
    return { time, date };
  }
  async addFile(name, blob){
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = ZipWriter.crc32(data);
    const { time, date } = this._dateDos();
    const nameBytes = this._strBytes(name);
    // local file header
    const lf = new DataView(new ArrayBuffer(30));
    let p = 0;
    lf.setUint32(p, 0x04034b50, true); p+=4; // signature
    lf.setUint16(p, 20, true); p+=2; // version needed
    lf.setUint16(p, 0, true); p+=2; // flags
    lf.setUint16(p, 0, true); p+=2; // method 0 store
    lf.setUint16(p, time, true); p+=2; // time
    lf.setUint16(p, date, true); p+=2; // date
    lf.setUint32(p, crc, true); p+=4; // crc
    lf.setUint32(p, data.length, true); p+=4; // comp size
    lf.setUint32(p, data.length, true); p+=4; // uncomp size
    lf.setUint16(p, nameBytes.length, true); p+=2; // name len
    lf.setUint16(p, 0, true); p+=2; // extra len

    const localHeaderOffset = this.offset;
    this._pushBytes(new Uint8Array(lf.buffer));
    this._pushBytes(nameBytes);
    this._pushBytes(data);

    this.files.push({ name, crc, size: data.length, csize: data.length, time, date, offset: localHeaderOffset });
  }
  async finalize(){
    const centralChunks = [];
    let centralSize = 0;
    const cdPush = (bytes) => { centralChunks.push(bytes); centralSize += bytes.length; };
    for (const f of this.files){
      const nameBytes = this._strBytes(f.name);
      const cd = new DataView(new ArrayBuffer(46));
      let p=0;
      cd.setUint32(p, 0x02014b50, true); p+=4; // signature
      cd.setUint16(p, 20, true); p+=2; // version made by
      cd.setUint16(p, 20, true); p+=2; // version needed
      cd.setUint16(p, 0, true); p+=2;  // flags
      cd.setUint16(p, 0, true); p+=2;  // method store
      cd.setUint16(p, f.time, true); p+=2; // time
      cd.setUint16(p, f.date, true); p+=2; // date
      cd.setUint32(p, f.crc, true); p+=4;
      cd.setUint32(p, f.csize, true); p+=4;
      cd.setUint32(p, f.size, true); p+=4;
      cd.setUint16(p, nameBytes.length, true); p+=2;
      cd.setUint16(p, 0, true); p+=2; // extra len
      cd.setUint16(p, 0, true); p+=2; // comment len
      cd.setUint16(p, 0, true); p+=2; // disk start
      cd.setUint16(p, 0, true); p+=2; // int attr
      cd.setUint32(p, 0, true); p+=4; // ext attr
      cd.setUint32(p, f.offset, true); p+=4; // local header offset
      cdPush(new Uint8Array(cd.buffer));
      cdPush(nameBytes);
    }
    // EOCD
    const eocd = new DataView(new ArrayBuffer(22));
    let p=0;
    eocd.setUint32(p, 0x06054b50, true); p+=4;
    eocd.setUint16(p, 0, true); p+=2; // disk
    eocd.setUint16(p, 0, true); p+=2; // disk start
    eocd.setUint16(p, this.files.length, true); p+=2; // entries on disk
    eocd.setUint16(p, this.files.length, true); p+=2; // total entries
    eocd.setUint32(p, centralSize, true); p+=4; // central dir size
    eocd.setUint32(p, this.offset, true); p+=4; // central dir offset
    eocd.setUint16(p, 0, true); p+=2; // comment len

    const all = [
      ...this.chunks,
      ...centralChunks,
      new Uint8Array(eocd.buffer),
    ];
    const blob = new Blob(all, { type: 'application/zip' });
    return blob;
  }
}

// --- ICO writer (PNG entries) ---
async function makeICO(bitmaps){
  // bitmaps: array of {w,h,blob}
  const entries = [];
  let offset = 6 + 16 * bitmaps.length; // header + dir entries
  const parts = [];
  for (const b of bitmaps){
    const data = new Uint8Array(await b.blob.arrayBuffer());
    const size = data.length;
    entries.push({ w: b.w, h: b.h, size, offset });
    parts.push(data);
    offset += size;
  }
  const header = new DataView(new ArrayBuffer(6));
  header.setUint16(0, 0, true); // reserved
  header.setUint16(2, 1, true); // type 1 = icon
  header.setUint16(4, bitmaps.length, true); // count

  const dir = new Uint8Array(16 * bitmaps.length);
  for (let i=0;i<entries.length;i++){
    const e = entries[i];
    const view = new DataView(dir.buffer, i*16, 16);
    view.setUint8(0, e.w === 256 ? 0 : e.w);
    view.setUint8(1, e.h === 256 ? 0 : e.h);
    view.setUint8(2, 0); // colors
    view.setUint8(3, 0); // reserved
    view.setUint16(4, 1, true); // planes
    view.setUint16(6, 32, true); // bit count
    view.setUint32(8, e.size, true); // size
    view.setUint32(12, e.offset, true); // offset
  }
  const blob = new Blob([new Uint8Array(header.buffer), dir, ...parts], { type: 'image/x-icon' });
  return blob;
}

// --- ICNS writer (PNG chunks) ---
async function makeICNS(pngs){
  // pngs: array of { size: 16|32|64|128|256|512|1024, blob }
  const typeFor = (s) => ({
    16:'icp4', 32:'icp5', 64:'icp6', 128:'ic07', 256:'ic08', 512:'ic09', 1024:'ic10'
  })[s];
  const chunks = [];
  let total = 8; // header size
  for (const p of pngs){
    const type = typeFor(p.size);
    if (!type) continue;
    const data = new Uint8Array(await p.blob.arrayBuffer());
    const header = new Uint8Array(8);
    header.set(new TextEncoder().encode(type), 0);
    // length is 8 + data length (big-endian)
    const len = 8 + data.length;
    const dv = new DataView(header.buffer);
    dv.setUint32(4, len, false);
    chunks.push(header, data);
    total += len;
  }
  const magic = new Uint8Array(8);
  magic.set(new TextEncoder().encode('icns'), 0);
  new DataView(magic.buffer).setUint32(4, total, false);
  return new Blob([magic, ...chunks], { type: 'image/icns' });
}

async function renderSelected(canPreview=false){
  if (!sourceImage) return [];
  const mode = getMode();
  const selected = presets.filter(p => p.checked);
  const results = [];
  for (const p of selected){
    const canvas = resizeToCanvas(sourceImage, p.w, p.h, mode);
    const blob = await canvasToPngBlob(canvas);
    results.push({ name: p.name, w: p.w, h: p.h, blob });
  }
  if (canPreview){
    const preview = $('#preview');
    const list = $('#previewList');
    list.innerHTML = '';
    for (const r of results){
      const url = URL.createObjectURL(r.blob);
      const item = el('div', { className:'preview-item' },
        el('div', {}, `${r.name} · ${r.w}×${r.h}`),
        el('div', { className:'imgwrap' }, el('img', { src: url, alt: r.name })),
        el('div', {}, el('a', { href:url, download:r.name }, '下载'))
      );
      list.appendChild(item);
    }
    preview.hidden = false;
  }
  return results;
}

async function generateAll(){
  $('#status').textContent = '正在生成…';
  const pngEnabled = $('#exportPng').checked;
  const icoEnabled = $('#exportIco').checked;
  const icnsEnabled = $('#exportIcns').checked;

  const zip = new ZipWriter();

  // PNGs
  const pngs = await renderSelected(false);
  if (pngEnabled){
    for (const p of pngs){
      await zip.addFile(p.name, p.blob);
    }
  }

  // ICO: generate common sizes
  if (icoEnabled){
    const icoSizes = [16,24,32,48,64,128,256];
    const pngEntries = [];
    for (const s of icoSizes){
      const canvas = resizeToCanvas(sourceImage, s, s, 'contain');
      const blob = await canvasToPngBlob(canvas);
      pngEntries.push({ w:s, h:s, blob });
    }
    const icoBlob = await makeICO(pngEntries);
    await zip.addFile('icon.ico', icoBlob);
  }

  // ICNS: Apple sizes
  if (icnsEnabled){
    const icnsSizes = [16,32,64,128,256,512,1024];
    const pngEntries = [];
    for (const s of icnsSizes){
      // only generate up to source max to avoid upscaling too much
      const maxDim = Math.max(sourceImage.width, sourceImage.height);
      if (s > maxDim * 2) continue; // basic guard; still allow some upscale
      const canvas = resizeToCanvas(sourceImage, s, s, 'contain');
      const blob = await canvasToPngBlob(canvas);
      pngEntries.push({ size:s, blob });
    }
    const icnsBlob = await makeICNS(pngEntries);
    await zip.addFile('icon.icns', icnsBlob);
  }

  // Single icon.png (duplicate of 512x512) if not already included
  const hasIconPng = presets.some(p=>p.checked && p.name==='icon.png');
  if (!hasIconPng && pngEnabled){
    const canvas = resizeToCanvas(sourceImage, 512, 512, 'contain');
    const blob = await canvasToPngBlob(canvas);
    await zip.addFile('icon.png', blob);
  }

  const out = await zip.finalize();
  $('#status').textContent = `生成完成：${humanSize(out.size)}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out);
  const base = sourceName.replace(/\.[^.]+$/, '') || 'icons';
  a.download = `${base}_assets.zip`;
  a.click();
}

function bindUI(){
  renderPresets();

  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  });

  $('#previewBtn').addEventListener('click', async () => {
    await renderSelected(true);
  });

  $('#generateBtn').addEventListener('click', async () => {
    try { await generateAll(); }
    catch (err){ console.error(err); alert('生成失败：' + err.message); }
  });

  $('#addCustom').addEventListener('click', () => {
    const name = $('#customName').value.trim();
    const w = parseInt($('#customW').value, 10);
    const h = parseInt($('#customH').value, 10);
    if (!name || !w || !h) return;
    presets.push({ name, w, h, checked: true });
    renderPresets();
    $('#customName').value = '';
    $('#customW').value = '';
    $('#customH').value = '';
  });
}

document.addEventListener('DOMContentLoaded', bindUI);

