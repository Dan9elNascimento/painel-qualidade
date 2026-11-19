/* Painel Qualidade — painel de automações do WMS (abre em tela cheia dentro do WMS)
   Tudo roda no navegador de quem clicou, com o login dessa pessoa. Nenhum dado sai do PC. */
(function () {
  'use strict';
  var VERSAO = '1.4.0';
  var ID = 'painel-qualidade-raiz';
  var ZONAS_PADRAO = ['AV', 'D', 'DEM', 'EXZO', 'MI', 'MO', 'OS', 'RO', 'TS', 'RTS'];

  var antigo = document.getElementById(ID);
  if (antigo) { if (window.__painelQualidade) window.__painelQualidade.alternar(); else antigo.style.display = antigo.style.display === 'none' ? '' : 'none'; return; }

  /* ===================== UTILIDADES ===================== */
  var enc = new TextEncoder();
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmt(n) { return Number(n).toLocaleString('pt-BR'); }
  function escH(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function carimbo() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + 'h' + p(d.getMinutes()); }
  function baixarBlob(blob, nome) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000); }

  /* ===================== CONFIG (por pessoa, neste navegador) ===================== */
  var CHAVE = 'painelQualidade_cfg';
  var cfg = { zonas: ZONAS_PADRAO.slice(), dup: true, cubMin: 150, cubMax: 230 };
  try { var salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null'); if (salvo) for (var k in salvo) cfg[k] = salvo[k]; } catch (e) {}
  function salvarCfg() { try { localStorage.setItem(CHAVE, JSON.stringify(cfg)); } catch (e) {} }

  /* ===================== ZIP (ler e escrever) ===================== */
  function inflar(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function lerZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), fim = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    if (fim < 0) return Promise.reject(new Error('Arquivo .zip inválido'));
    var qtd = dv.getUint16(fim + 10, true), pos = dv.getUint32(fim + 16, true), itens = [];
    for (var n = 0; n < qtd; n++) {
      var metodo = dv.getUint16(pos + 10, true), tamC = dv.getUint32(pos + 20, true);
      var lNome = dv.getUint16(pos + 28, true), lExtra = dv.getUint16(pos + 30, true), lCom = dv.getUint16(pos + 32, true), off = dv.getUint32(pos + 42, true);
      var nome = new TextDecoder().decode(u8.subarray(pos + 46, pos + 46 + lNome));
      var ini = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      itens.push({ nome: nome, metodo: metodo, dados: u8.subarray(ini, ini + tamC) });
      pos += 46 + lNome + lExtra + lCom;
    }
    return Promise.all(itens.filter(function (x) { return !/\/$/.test(x.nome); }).map(function (x) {
      return (x.metodo === 8 ? inflar(x.dados) : Promise.resolve(x.dados)).then(function (d) { return { nome: x.nome, dados: d }; });
    }));
  }

  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crcAtualiza(c, b) { for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return c; }
  async function prepararEntrada(nome, blob) {
    var leitor = blob.stream().getReader(), c = 0xFFFFFFFF, r;
    while (!(r = await leitor.read()).done) c = crcAtualiza(c, r.value);
    var comp = new Uint8Array(await new Response(blob.stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return { nome: enc.encode(nome), crc: (c ^ 0xFFFFFFFF) >>> 0, tam: blob.size, comp: comp };
  }
  function montarZip(entradas, tipo) {
    var partes = [], central = [], off = 0;
    entradas.forEach(function (e) {
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 8, true);
      h.setUint16(12, 0x21, true); h.setUint32(14, e.crc, true); h.setUint32(18, e.comp.length, true); h.setUint32(22, e.tam, true); h.setUint16(26, e.nome.length, true);
      partes.push(h.buffer, e.nome, e.comp);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true);
      c.setUint16(14, 0x21, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.comp.length, true); c.setUint32(24, e.tam, true); c.setUint16(28, e.nome.length, true); c.setUint32(42, off, true);
      central.push(c.buffer, e.nome);
      off += 30 + e.nome.length + e.comp.length;
    });
    var tc = central.reduce(function (s, p) { return s + (p.byteLength !== undefined ? p.byteLength : p.length); }, 0);
    var f = new DataView(new ArrayBuffer(22));
    f.setUint32(0, 0x06054b50, true); f.setUint16(8, entradas.length, true); f.setUint16(10, entradas.length, true); f.setUint32(12, tc, true); f.setUint32(16, off, true);
    return new Blob(partes.concat(central, [f.buffer]), { type: tipo });
  }

  /* ===================== LEITURA CSV / XLSX ===================== */
  function lerCSV(txt) {
    txt = txt.replace(/^﻿/, '');
    var l0 = txt.slice(0, txt.indexOf('\n') > -1 ? txt.indexOf('\n') : txt.length), sep = ',', max = -1;
    [',', ';', '\t', '|'].forEach(function (s) { var n = l0.split(s).length; if (n > max) { max = n; sep = s; } });
    var linhas = [], i = 0, L = txt.length;
    while (i < L) {
      var fimL = txt.indexOf('\n', i); if (fimL < 0) fimL = L;
      var linha = txt.slice(i, fimL);
      if (linha.indexOf('"') < 0) { i = fimL + 1; linha = linha.replace(/\r$/, ''); if (linha) linhas.push(linha.split(sep)); continue; }
      var campos = [], campo = '', aspas = false, j = i;      // linha com aspas: parser completo
      for (; j < L; j++) {
        var ch = txt[j];
        if (aspas) { if (ch === '"') { if (txt[j + 1] === '"') { campo += '"'; j++; } else aspas = false; } else campo += ch; }
        else if (ch === '"' && campo === '') aspas = true;
        else if (ch === sep) { campos.push(campo); campo = ''; }
        else if (ch === '\n') break;
        else if (ch !== '\r') campo += ch;
      }
      campos.push(campo); linhas.push(campos); i = j + 1;
    }
    var cab = (linhas.shift() || []).map(function (h) { return h.trim(); });
    return { cab: cab, linhas: linhas };
  }
  async function lerXLSX(u8) {
    var arqs = await lerZip(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)), mapa = {};
    arqs.forEach(function (a) { mapa[a.nome] = a.dados; });
    var dec = new TextDecoder(), P = new DOMParser(), comp = [];
    if (mapa['xl/sharedStrings.xml']) [].forEach.call(P.parseFromString(dec.decode(mapa['xl/sharedStrings.xml']), 'text/xml').getElementsByTagName('si'), function (si) {
      comp.push([].map.call(si.getElementsByTagName('t'), function (t) { return t.textContent; }).join(''));
    });
    var aba = mapa['xl/worksheets/sheet1.xml'] || mapa[Object.keys(mapa).filter(function (k) { return /^xl\/worksheets\/sheet/.test(k); })[0]];
    var linhas = [];
    [].forEach.call(P.parseFromString(dec.decode(aba), 'text/xml').getElementsByTagName('row'), function (row) {
      var l = [];
      [].forEach.call(row.getElementsByTagName('c'), function (c) {
        var ref = c.getAttribute('r') || '', col = 0;
        for (var k = 0; k < ref.length && /[A-Z]/.test(ref[k]); k++) col = col * 26 + ref.charCodeAt(k) - 64;
        col = col ? col - 1 : l.length; while (l.length < col) l.push('');
        var t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        if (t === 's') l.push(comp[+v.textContent] || '');
        else if (t === 'inlineStr') l.push([].map.call(c.getElementsByTagName('t'), function (x) { return x.textContent; }).join(''));
        else l.push(v ? v.textContent.replace(/^(-?\d+)\.0$/, '$1') : '');
      });
      if (l.some(function (x) { return String(x).trim(); })) linhas.push(l);
    });
    var cab = (linhas.shift() || []).map(function (h) { return String(h).trim(); });
    return { cab: cab, linhas: linhas };
  }
  async function lerArquivo(nome, u8) {
    var n = nome.toLowerCase();
    if (/\.csv$/.test(n)) { var d = lerCSV(new TextDecoder('utf-8').decode(u8)); d.nome = nome.split('/').pop(); return [d]; }
    if (/\.xlsx$/.test(n)) { var x = await lerXLSX(u8); x.nome = nome.split('/').pop(); return [x]; }
    if (/\.zip$/.test(n)) {
      var itens = await lerZip(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)), saida = [];
      itens.sort(function (a, b) { return a.nome < b.nome ? -1 : 1; });
      for (var i = 0; i < itens.length; i++) if (/\.(csv|xlsx|zip)$/i.test(itens[i].nome) && !/(^|\/)[~.]/.test(itens[i].nome)) saida = saida.concat(await lerArquivo(itens[i].nome, itens[i].dados));
      return saida;
    }
    throw new Error('Formato não suportado: ' + nome);
  }

  /* ===================== TRATAMENTO ON-HAND ===================== */
  function unificar(arqs, remDup) {
    var cab = [], idx = {};
    arqs.forEach(function (a) { a.cab.forEach(function (h) { if (!(h in idx)) { idx[h] = cab.length; cab.push(h); } }); });
    var linhas = [], vistos = remDup ? new Set() : null, dup = 0;
    arqs.forEach(function (a) {
      var mapa = a.cab.map(function (h) { return idx[h]; }), mesma = mapa.every(function (v, i) { return v === i; }) && a.cab.length === cab.length;
      a.linhas.forEach(function (l) {
        var nova;
        if (mesma) nova = l; else { nova = new Array(cab.length).fill(''); for (var j = 0; j < mapa.length; j++) nova[mapa[j]] = l[j] !== undefined ? l[j] : ''; }
        if (vistos) { var k = nova.join('\u0001'); if (vistos.has(k)) { dup++; return; } vistos.add(k); }
        linhas.push(nova);
      });
    });
    return { cab: cab, linhas: linhas, dup: dup };
  }
  function acharColuna(cab) {
    var pad = [/^zone/i, /zone/i, /zona/i, /^location$/i, /location/i, /local/i];
    for (var p = 0; p < pad.length; p++) for (var i = 0; i < cab.length; i++) if (pad[p].test(cab[i])) return i;
    return -1;
  }
  function zonaDe(v) {
    v = String(v || '').trim().toUpperCase();
    var partes = v.split(/[-_ /.]/);
    if (partes.length > 1 || /^[A-Z]+$/.test(v)) return partes[0];
    var m = v.match(/^[A-Z]+/); return m ? m[0] : v;
  }
  function filtrarZonas(dados, zonas) {
    var regras = new Set(zonas.map(function (z) { return z.trim().toUpperCase(); }).filter(Boolean));
    var col = acharColuna(dados.cab), porZona = {}, manter = [];
    if (col < 0 || !regras.size) return { linhas: dados.linhas, porZona: porZona, coluna: col < 0 ? '(não achei a coluna de zona)' : dados.cab[col] };
    var usaLocal = !/zone|zona/i.test(dados.cab[col]);
    dados.linhas.forEach(function (l) {
      var v = l[col], z = usaLocal ? zonaDe(v) : String(v || '').trim().toUpperCase();
      if (regras.has(z)) porZona[z] = (porZona[z] || 0) + 1; else manter.push(l);
    });
    return { linhas: manter, porZona: porZona, coluna: dados.cab[col] };
  }

  /* ===================== GERAR XLSX ===================== */
  function escX(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); }
  function letra(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  var NUM = /^-?(0|[1-9]\d{0,11})(\.\d+)?$/;
  var CORES_LOTE = ['C6EFCE', 'BDD7EE', 'FFEB9C', 'F8CBAD', 'D9C3E9', 'B4E5E1']; // estilos 2..7
  function abaXML(cab, linhas, op) {
    op = op || {};
    var larg = cab.map(function (h) { return Math.max(8, Math.min(45, String(h).length + 2)); });
    linhas.slice(0, 300).forEach(function (l) { l.forEach(function (v, j) { if (j < larg.length) larg[j] = Math.max(larg[j], Math.min(45, String(v).length + 2)); }); });
    var L = cab.map(function (_, j) { return letra(j); });
    var partes = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      larg.map(function (w, j) { return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>'];
    partes.push('<row r="1">' + cab.map(function (h, j) { return '<c r="' + L[j] + '1" t="inlineStr" s="1"><is><t>' + escX(h) + '</t></is></c>'; }).join('') + '</row>');
    var buf = [];
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i], r = i + 2, s = '<row r="' + r + '">', st = op.estilo ? op.estilo(i) : 0, sa = st ? ' s="' + st + '"' : '';
      for (var j = 0; j < (st ? cab.length : l.length); j++) {
        if (l[j] && typeof l[j] === 'object' && l[j].f) { var sf = op.estiloCel ? (op.estiloCel(i, j) || sa) : sa; if (typeof sf === 'number') sf = ' s="' + sf + '"'; s += '<c r="' + L[j] + r + '"' + sf + ' t="str"><f>' + escX(l[j].f) + '</f><v>' + escX(l[j].v || '') + '</v></c>'; continue; }
        var v = l[j] == null ? '' : String(l[j]).trim();
        if (v === '') { if (st) s += '<c r="' + L[j] + r + '"' + sa + '/>'; continue; }
        var sj = op.estiloCel ? (op.estiloCel(i, j) || sa) : sa; if (typeof sj === 'number') sj = ' s="' + sj + '"';
        s += NUM.test(v) ? '<c r="' + L[j] + r + '"' + sj + '><v>' + v + '</v></c>' : '<c r="' + L[j] + r + '"' + sj + ' t="inlineStr"><is><t xml:space="preserve">' + escX(v) + '</t></is></c>';
      }
      buf.push(s + '</row>');
      if (buf.length === 5000) { partes.push(buf.join('')); buf = []; }
    }
    partes.push(buf.join(''));
    partes.push('</sheetData>' + (op.semFiltro ? '' : '<autoFilter ref="A1:' + L[cab.length - 1] + (linhas.length + 1) + '"/>') +
      (op.cf || '') + (op.links && op.links.length ? '<hyperlinks>' + op.links.map(function (k) { return '<hyperlink ref="' + k.ref + '" location="' + escX(k.alvo).replace(/"/g, '&quot;') + '" display="' + escX(k.texto || '') + '"/>'; }).join('') + '</hyperlinks>' : '') + '</worksheet>');
    return new Blob(partes);
  }
  async function gerarXLSX(abas) {
    var tipos = abas.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('');
    var piv = abas.map(function (a, i) { return a.pivot ? i : -1; }).filter(function (i) { return i >= 0; });
    piv.forEach(function (i, k) { var n = k + 1;
      tipos += '<Override PartName="/xl/pivotTables/pivotTable' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>' +
        '<Override PartName="/xl/pivotCache/pivotCacheDefinition' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>' +
        '<Override PartName="/xl/pivotCache/pivotCacheRecords' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>'; });
    var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/', CAB_REL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    var fixos = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + tipos + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + abas.map(function (a, i) { return '<sheet name="' + escX(a.nome).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' + (piv.length ? '<pivotCaches>' + piv.map(function (_, k) { return '<pivotCache cacheId="' + (k + 1) + '" r:id="rIdP' + (k + 1) + '"/>'; }).join('') + '</pivotCaches>' : '') + '</workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + abas.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (abas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + piv.map(function (_, k) { return '<Relationship Id="rIdP' + (k + 1) + '" Type="' + R + 'pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition' + (k + 1) + '.xml"/>'; }).join('') + '</Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF1155CC"/><name val="Calibri"/></font></fonts>' +
        '<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEE4D2D"/></patternFill></fill>' +
        CORES_LOTE.map(function (c) { return '<fill><patternFill patternType="solid"><fgColor rgb="FF' + c + '"/></patternFill></fill>'; }).join('') +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>' +
        '<cellXfs count="12"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/>' +
        CORES_LOTE.map(function (_, i) { return '<xf xfId="0" fillId="' + (3 + i) + '" applyFill="1"/>'; }).join('') +
        '<xf xfId="0" fontId="2" applyFont="1"/><xf xfId="0" fontId="2" fillId="9" applyFont="1" applyFill="1"/><xf xfId="0" fontId="3" applyFont="1"/><xf xfId="0" fontId="2" fillId="2" applyFont="1" applyFill="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="' + CORES_LOTE.length + '">' + CORES_LOTE.map(function (c) { return '<dxf><fill><patternFill patternType="solid"><fgColor rgb="FF' + c + '"/><bgColor rgb="FF' + c + '"/></patternFill></fill></dxf>'; }).join('') + '</dxfs></styleSheet>']
    ];
    var entradas = [];
    for (var i = 0; i < fixos.length; i++) entradas.push(await prepararEntrada(fixos[i][0], new Blob([fixos[i][1]])));
    for (var a = 0; a < abas.length; a++) entradas.push(await prepararEntrada('xl/worksheets/sheet' + (a + 1) + '.xml', abaXML(abas[a].cab, abas[a].linhas, abas[a].op)));
    for (var k = 0; k < piv.length; k++) {
      var n = k + 1, pv = abas[piv[k]].pivot;
      entradas.push(await prepararEntrada('xl/worksheets/_rels/sheet' + (piv[k] + 1) + '.xml.rels', new Blob([CAB_REL + '<Relationship Id="rId1" Type="' + R + 'pivotTable" Target="../pivotTables/pivotTable' + n + '.xml"/></Relationships>'])));
      entradas.push(await prepararEntrada('xl/pivotTables/pivotTable' + n + '.xml', new Blob([pv.tabela.replace('cacheId="1"', 'cacheId="' + n + '"')])));
      entradas.push(await prepararEntrada('xl/pivotTables/_rels/pivotTable' + n + '.xml.rels', new Blob([CAB_REL + '<Relationship Id="rId1" Type="' + R + 'pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition' + n + '.xml"/></Relationships>'])));
      entradas.push(await prepararEntrada('xl/pivotCache/pivotCacheDefinition' + n + '.xml', new Blob([pv.definicao])));
      entradas.push(await prepararEntrada('xl/pivotCache/_rels/pivotCacheDefinition' + n + '.xml.rels', new Blob([CAB_REL + '<Relationship Id="rId1" Type="' + R + 'pivotCacheRecords" Target="pivotCacheRecords' + n + '.xml"/></Relationships>'])));
      entradas.push(await prepararEntrada('xl/pivotCache/pivotCacheRecords' + n + '.xml', new Blob(pv.registros)));
    }
    return montarZip(entradas, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /* ===================== API DO WMS (com o login de quem está usando) ===================== */
  var RC = '/api/v2/apps/basic/reportcenter/';
  function csrf() { var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || document.cookie.match(/(?:^|;\s*)[^=;]*csrf[^=;]*=([^;]+)/i); return m ? decodeURIComponent(m[1]) : ''; }
  async function wms(metodo, caminho, corpo) {
    var h = { 'accept': 'application/json, text/plain, */*', 'x-cctv-tenant-id': 'WMS', 'x-csrftoken': csrf() };
    if (corpo) h['content-type'] = 'application/json;charset=UTF-8';
    var r = await fetch(caminho, { method: metodo, credentials: 'include', headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    var j; try { j = await r.json(); } catch (e) { throw new Error('Sessão do WMS expirou. Atualize a página (F5), faça login e abra o painel de novo.'); }
    if (j.retcode !== 0) throw new Error('WMS: ' + (j.message || j.retcode));
    return j.data || {};
  }
  async function exportarRC(corpo, tipo, aviso) {
    var antes = new Set(((await wms('GET', RC + 'search_export_task?is_myself=1&pageno=1&count=20')).list || []).map(function (t) { return t.task_id; }));
    aviso('Pedindo a exportação ao WMS…', 5);
    await wms('POST', RC + 'create_export_task', corpo);
    var ini = Date.now();
    while (true) {
      await esperar(3000);
      var seg = Math.round((Date.now() - ini) / 1000);
      if (seg > 900) throw new Error('O WMS demorou mais de 15 min. Veja no Report Center.');
      var t = ((await wms('GET', RC + 'search_export_task?is_myself=1&pageno=1&count=20')).list || []).filter(function (x) { return x.task_type === tipo && !antes.has(x.task_id); })[0];
      if (!t) { aviso('Aguardando o WMS criar a tarefa… (' + seg + 's)', 8); continue; }
      if (t.task_status === 2 && t.download_link) {
        aviso('Baixando ' + t.export_file_name + '…', 55);
        var r = await fetch(t.download_link, { credentials: 'include' });
        if (!r.ok) throw new Error('Falha ao baixar o arquivo (' + r.status + ')');
        return { nome: t.export_file_name || 'export.zip', dados: new Uint8Array(await r.arrayBuffer()) };
      }
      if (t.task_status > 2) throw new Error('A exportação falhou no WMS (status ' + t.task_status + ')');
      var pct = t.processed_percentage || 0;
      aviso('Gerando no WMS: ' + pct + '% (' + seg + 's)', 10 + pct * 0.4);
    }
  }
  var ONHAND = { export_module: 3, task_type: 86, extra_data: JSON.stringify({ timeRange: 1, module: 3, taskType: 86, include_batch: 'N', export_angle: 1 }) };

  async function processarOnHand(arqsBrutos, aviso) {
    var arqs = [];
    for (var i = 0; i < arqsBrutos.length; i++) {
      aviso('Abrindo ' + arqsBrutos[i].nome + '…', 62);
      arqs = arqs.concat(await lerArquivo(arqsBrutos[i].nome, arqsBrutos[i].dados));
    }
    if (!arqs.length) throw new Error('Não achei planilhas dentro do arquivo.');
    var lidas = arqs.reduce(function (s, a) { return s + a.linhas.length; }, 0);
    aviso('Juntando ' + arqs.length + ' planilhas (' + fmt(lidas) + ' linhas)…', 70);
    await esperar(30);
    var u = unificar(arqs, cfg.dup);
    aviso('Removendo zonas…', 76);
    var f = filtrarZonas(u, cfg.zonas);
    aviso('Gerando a planilha (' + fmt(f.linhas.length) + ' linhas)…', 82);
    await esperar(30);
    var resumo = [['Gerado em', new Date().toLocaleString('pt-BR')], ['Gerado por', 'Painel Qualidade v' + VERSAO],
      ['Arquivos juntados', arqs.length], ['Linhas lidas', lidas], ['Duplicadas removidas', u.dup],
      ['Removidas por zona', Object.keys(f.porZona).reduce(function (s, k) { return s + f.porZona[k]; }, 0)],
      ['Linhas na planilha', f.linhas.length], ['Coluna usada no filtro', f.coluna], ['', ''], ['Zona removida', 'Linhas']]
      .concat(cfg.zonas.map(function (z) { z = z.trim().toUpperCase(); return [z, f.porZona[z] || 0]; }))
      .concat([['', ''], ['Arquivos usados', '']], arqs.map(function (a) { return [a.nome, a.linhas.length]; }));
    var blob = await gerarXLSX([{ nome: 'On-Hand', cab: u.cab, linhas: f.linhas }, { nome: 'Resumo', cab: ['Item', 'Valor'], linhas: resumo.map(function (r) { return r.map(String); }) }]);
    return { blob: blob, nome: 'OnHand_unificado_' + carimbo() + '.xlsx', lidas: lidas, dup: u.dup, porZona: f.porZona, final: f.linhas.length, arquivos: arqs.length, coluna: f.coluna };
  }


  /* ===================== PONTE COM O APP (Painel Qualidade.exe) ===================== */
  var temApp = typeof window.painelPonte === 'function';
  var pendentes = {};
  window.__painelResposta = function (id, ok, json) { var p = pendentes[id]; if (!p) return; delete pendentes[id]; var d = JSON.parse(json); ok ? p.ok(d) : p.erro(new Error(d.erro || 'erro no app')); };
  function ponte(acao, dados) {
    return new Promise(function (ok, erro) {
      var id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
      pendentes[id] = { ok: ok, erro: erro };
      var pedido = dados || {}; pedido.id = id; pedido.acao = acao;
      window.painelPonte(JSON.stringify(pedido));
      setTimeout(function () { if (pendentes[id]) { delete pendentes[id]; erro(new Error('O app não respondeu a tempo.')); } }, 180000);
    });
  }

  /* ===================== CUBISCAN: backlog -> lotes de ruas ===================== */
  var CUB_URL = 'https://script.google.com/a/shopee.com/macros/s/AKfycbzfv3G8biAdsTp5DMWptXOwDgrMFwCCbAb50LQ72Hogbvj0A1wXpQB1uzYbN5M1gTEk/exec?page=cubscan';
  var CUB_CAB = ['Task ID', 'SKU', 'Caixa (ASN)', 'WH responsavel', 'WH fisico', 'Estoque', 'Posicao 1', 'Posicao 2', 'Operador', 'Turno', 'Tipo', 'Status', 'Criado em', 'Aging (dias)', 'Sem dimensao'];
  var CUB_MAPA = [1, 2, 3, 0, 10, 14, 15, 16, 11, 13, 5, 4, 17, 7, 8]; // posição de cada coluna na resposta do Cubiscan
  function naPaginaCubiscan() { return !!window.__CUB_FORCE__ || location.hostname === 'script.google.com' && /AKfycbzfv3G8biAdsTp5DMWptXOwDgrMFwCCbAb50LQ72Hogbvj0A1wXpQB1uzYbN5M1gTEk/.test(location.pathname); }
  function tokensCandidatos() {
    var html = document.documentElement.innerHTML, achados = [], m, res = [
      /token["']?\s*[:=,]\s*["']([A-Za-z0-9_\-:]{20,90})["']/g,
      /["'](AM[A-Za-z0-9_\-]{8,}:\d{10,})["']/g,
      /["'](A[A-Za-z0-9_\-]{30,50})["']/g];
    res.forEach(function (re) { while ((m = re.exec(html))) if (achados.indexOf(m[1]) < 0) achados.push(m[1]); });
    return achados.slice(0, 40);
  }
  async function buscarBacklogCubiscan(whs, aviso) {
    var base = location.pathname.replace(/\/(exec|dev)$/, '/callback');
    var corpo = 'request=' + encodeURIComponent(JSON.stringify(['getCubbingItemsClient', JSON.stringify([{ nb: 'backlog', whs: whs }]), null, [0], null, null, 1, 0]));
    var cands = tokensCandidatos();
    if (window.__cubToken) cands.unshift(window.__cubToken);
    aviso('Puxando o backlog do Cubiscan…', 15);
    for (var i = 0; i < cands.length; i++) {
      try {
        var r = await fetch(base + '?nocache_id=' + (Date.now() % 100000) + '&token=' + encodeURIComponent(cands[i]), {
          method: 'POST', credentials: 'include', body: corpo,
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1' }
        });
        if (!r.ok) continue;
        var t = await r.text(); t = t.slice(t.indexOf('\n') + 1);
        var j = JSON.parse(t), bruto = j && j[0] && j[0][1] && j[0][1][1];
        if (typeof bruto !== 'string') continue;
        var d = JSON.parse(bruto);
        if (!d || !d.rows) continue;
        window.__cubToken = cands[i];
        return { linhas: d.rows.map(function (row) { return CUB_MAPA.map(function (k) { var v = row[k]; return v == null ? '' : String(v); }); }), atualizado: d.lastUpdate || '' };
      } catch (e) { }
    }
    throw new Error('Não consegui puxar do Cubiscan nesta página. Atualize a página (F5), espere carregar e tente de novo. Se continuar, use "Baixar CSV" e arraste o arquivo aqui.');
  }
  function areaDe(rua) {   // BRFPE1-A2-04 -> A2 | BRFPE1-HS29-01 -> HS | BRFPE1-HV-03 -> HV
    var seg = String(rua).split('-')[1] || '', m = seg.match(/^([A-Z]{2,})\d+$/);
    return m ? m[1] : seg;
  }
  function ruaDe(loc) { var p = String(loc || '').trim().toUpperCase().split('-'); return p.length >= 3 ? p.slice(0, 3).join('-') : String(loc || '').trim().toUpperCase(); }
  function ordemNatural(a, b) {
    var x = a.split(/(\d+)/), y = b.split(/(\d+)/);
    for (var i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      var nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
      if (nx && ny) return +x[i] - +y[i];
      return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  }
  function montarLotes(ruas, min, max) {
    // ruas: [{rua, itens:[...]}] já em ordem. Junta ruas vizinhas até ficar entre min e max SKUs.
    var pedacos = [];
    ruas.forEach(function (r) {
      if (r.itens.length <= max) return pedacos.push(r);
      var n = Math.ceil(r.itens.length / max), tam = Math.ceil(r.itens.length / n);   // rua grande demais: divide
      for (var k = 0; k < n; k++) pedacos.push({ rua: r.rua, parte: (k + 1) + '/' + n, itens: r.itens.slice(k * tam, (k + 1) * tam) });
    });
    // Divide as ruas (em ordem) em k grupos vizinhos o mais equilibrados possível.
    // Começa com o menor k que cabe no máximo e aumenta até todos os lotes ficarem <= max.
    var tam = pedacos.map(function (p) { return p.itens.length; }), n = tam.length;
    var soma = tam.reduce(function (a, b) { return a + b; }, 0), pre = [0];
    tam.forEach(function (t, i) { pre.push(pre[i] + t); });
    function particionar(k) {   // programação dinâmica: minimiza o maior lote
      var INF = 1e15, dp = [], corte = [];
      for (var g = 0; g <= k; g++) { dp.push(new Array(n + 1).fill(INF)); corte.push(new Array(n + 1).fill(0)); }
      dp[0][0] = 0;
      for (g = 1; g <= k; g++) for (var i = 1; i <= n; i++) for (var j = g - 1; j < i; j++) {
        var v = Math.max(dp[g - 1][j], pre[i] - pre[j]);
        if (v < dp[g][i]) { dp[g][i] = v; corte[g][i] = j; }
      }
      var grupos = [], fim = n;
      for (g = k; g >= 1; g--) { var ini = corte[g][fim]; grupos.unshift(pedacos.slice(ini, fim)); fim = ini; }
      return { maior: dp[k][n], grupos: grupos };
    }
    var lotes = [];
    if (n) {
      var k = Math.max(1, Math.ceil(soma / max)), res = particionar(Math.min(k, n));
      while (res.maior > max && k < n) { k++; res = particionar(k); }
      lotes = res.grupos.filter(function (g) { return g.length; }).map(function (g) { return { pedacos: g }; });
    }
    function total(l) { return l.pedacos.reduce(function (s, p) { return s + p.itens.length; }, 0); }
    lotes.forEach(function (l, i) { l.n = i + 1; l.total = total(l); l.ok = l.total >= min && l.total <= max; });
    return lotes;
  }
  async function processarCubiscan(cab, linhas, aviso) {
    var iSku = cab.findIndex(function (h) { return /^sku/i.test(h); }), iPos = cab.findIndex(function (h) { return /posi[cç][aã]o\s*1|^location$/i.test(h); });
    var iTask = cab.findIndex(function (h) { return /task/i.test(h); }), iCx = cab.findIndex(function (h) { return /caixa|asn/i.test(h); }), iPos2 = cab.findIndex(function (h) { return /posi[cç][aã]o\s*2/i.test(h); });
    if (iSku < 0 || iPos < 0) throw new Error('Não achei as colunas SKU e Posição 1 no arquivo do Cubiscan.');
    var min = +cfg.cubMin || 150, max = +cfg.cubMax || 230;
    aviso('Montando a tabela de ruas…', 60);
    var porRua = {}, semPos = [];
    linhas.forEach(function (l) {
      var loc = String(l[iPos] || '').trim();
      var item = { sku: l[iSku], loc: loc, rua: ruaDe(loc), task: iTask >= 0 ? l[iTask] : '', cx: iCx >= 0 ? l[iCx] : '', pos2: iPos2 >= 0 ? l[iPos2] : '' };
      if (!loc) return semPos.push(item);
      (porRua[item.rua] = porRua[item.rua] || []).push(item);
    });
    var ruas = Object.keys(porRua).sort(ordemNatural).map(function (r) { return { rua: r, itens: porRua[r].sort(function (a, b) { return ordemNatural(a.loc, b.loc); }) }; });
    aviso('Juntando ruas em lotes de ' + min + ' a ' + max + ' SKUs…', 70);
    var porArea = {}, ordemAreas = [];
    ruas.forEach(function (r) { var a = areaDe(r.rua); if (!porArea[a]) { porArea[a] = []; ordemAreas.push(a); } porArea[a].push(r); });
    var lotes = [];
    ordemAreas.forEach(function (a) { montarLotes(porArea[a], min, max).forEach(function (l) { l.area = a; lotes.push(l); }); });
    lotes.forEach(function (l, i) { l.n = i + 1; });
    var loteDaRua = {};
    lotes.forEach(function (l) { l.pedacos.forEach(function (p) { (loteDaRua[p.rua] = loteDaRua[p.rua] || []).push(l.n); }); });
    // procv: SKU / location / rua / lote (todas as linhas, inclusive sem posição)
    var procv = linhas.map(function (l) {
      var loc = String(l[iPos] || '').trim(), rua = loc ? ruaDe(loc) : '', ns = loteDaRua[rua] || [];
      return [l[iSku], loc, rua, ns.length ? 'Lote ' + ns[0] : ''];
    });
    // Tabela dinâmica de verdade: linhas = rua, valores = CONT.VALORES de SKU (2 cliques abre o detalhe)
    var unicas = Object.keys(procv.reduce(function (o, r) { o[r[2]] = 1; return o; }, {})).sort(function (a, b) { return a === b ? 0 : a < b ? -1 : 1; });
    var idx = {}; unicas.forEach(function (u, k) { idx[u] = k; });
    var cont = unicas.map(function () { return 0; }); procv.forEach(function (r) { cont[idx[r[2]]]++; });
    var N = procv.length, K = unicas.length;
    var definicao = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="' + N + '">' +
      '<cacheSource type="worksheet"><worksheetSource ref="A1:D' + (N + 1) + '" sheet="procv"/></cacheSource><cacheFields count="4">' +
      '<cacheField name="SKU" numFmtId="0"><sharedItems/></cacheField><cacheField name="location" numFmtId="0"><sharedItems containsBlank="1"/></cacheField>' +
      '<cacheField name="rua" numFmtId="0"><sharedItems containsBlank="1" count="' + K + '">' + unicas.map(function (u) { return u ? '<s v="' + escX(u).replace(/"/g, '&quot;') + '"/>' : '<m/>'; }).join('') + '</sharedItems></cacheField>' +
      '<cacheField name="lote" numFmtId="0"><sharedItems containsBlank="1"/></cacheField></cacheFields></pivotCacheDefinition>';
    var q = function (v) { return v ? '<s v="' + escX(v).replace(/"/g, '&quot;') + '"/>' : '<m/>'; };
    var registros = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" count="' + N + '">'];
    procv.forEach(function (r) { registros.push('<r>' + q(r[0]) + q(r[1]) + '<x v="' + idx[r[2]] + '"/>' + q(r[3]) + '</r>'); });
    registros.push('</pivotCacheRecords>');
    var tabela = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="TabelaDinamica1" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Valores" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" rowHeaderCaption="rua">' +
      '<location ref="A1:B' + (K + 2) + '" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="4"><pivotField dataField="1" showAll="0"/><pivotField showAll="0"/>' +
      '<pivotField axis="axisRow" showAll="0"><items count="' + (K + 1) + '">' + unicas.map(function (_, k) { return '<item x="' + k + '"/>'; }).join('') + '<item t="default"/></items></pivotField><pivotField showAll="0"/></pivotFields>' +
      '<rowFields count="1"><field x="2"/></rowFields><rowItems count="' + (K + 1) + '">' + unicas.map(function (_, k) { return k ? '<i><x v="' + k + '"/></i>' : '<i><x/></i>'; }).join('') + '<i t="grand"><x/></i></rowItems>' +
      '<colItems count="1"><i/></colItems><dataFields count="1"><dataField name="COUNTA of SKU" fld="0" subtotal="count" baseField="0" baseItem="0"/></dataFields>' +
      '<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>';
    var linPiv = unicas.map(function (u, k) { var ns = loteDaRua[u] || []; return [u, String(cont[k]), { f: 'IFERROR(VLOOKUP(A' + (k + 2) + ',procv!$C:$D,2,FALSE),"")', v: ns.length ? 'Lote ' + ns[0] : '' }]; });
    linPiv.push(['Grand Total', String(N), '']);
    var cf = '<conditionalFormatting sqref="A2:C' + (K + 1) + '">' + CORES_LOTE.map(function (_, c) {
      return '<cfRule type="expression" dxfId="' + c + '" priority="' + (c + 1) + '"><formula>AND($C2&lt;&gt;"",MOD(VALUE(SUBSTITUTE($C2,"Lote ",""))-1,' + CORES_LOTE.length + ')=' + c + ')</formula></cfRule>';
    }).join('') + '</conditionalFormatting>';
    var abaPivot = { nome: 'Tabela dinâmica', cab: ['rua', 'COUNTA of SKU', 'Lote'], linhas: linPiv, pivot: { definicao: definicao, registros: registros, tabela: tabela },
      op: { semFiltro: true, cf: cf, estilo: function (k) { return k === K ? 9 : 0; } } };
    var resumoLotes = { nome: 'Lotes', cab: ['Lote', 'Área', 'SKUs', 'Ruas', 'Dentro da faixa?'], linhas: lotes.map(function (l) {
      return ['Lote ' + l.n, l.area, String(l.total), l.pedacos.map(function (p) { return p.rua + (p.parte ? ' (parte ' + p.parte + ')' : ''); }).join(', '), l.ok ? 'Sim' : (l.total < min ? 'Abaixo de ' + min : 'Acima de ' + max)];
    }), op: { semFiltro: true, estilo: function (k) { return 2 + k % CORES_LOTE.length; } } };
    aviso('Gerando a planilha…', 85);
    var blob = await gerarXLSX([abaPivot, resumoLotes,
      { nome: 'procv', cab: ['SKU', 'location', 'rua', 'lote'], linhas: procv },
      { nome: 'Unificado', cab: cab, linhas: linhas }]);
    var hoje = new Date(), dd = String(hoje.getDate()).padStart(2, '0'), mm = String(hoje.getMonth() + 1).padStart(2, '0');
    return { blob: blob, nome: 'Gestão Cubagem PE ' + dd + '-' + mm + ' BACKLOG.xlsx', total: linhas.length, comPos: linhas.length - semPos.length, semPos: semPos.length, lotes: lotes, ruas: ruas.length };
  }

  /* ===================== INTERFACE ===================== */
  var host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
  document.body.appendChild(host);
  var raiz = host.attachShadow({ mode: 'open' });
  raiz.innerHTML = '<style>' +
    ':host{all:initial}*{box-sizing:border-box;margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif}' +
    '.app{position:fixed;inset:0;display:flex;flex-direction:column;background:#f4f5f7;color:#1f2328;font-size:14px;overflow:hidden}' +'.app.janela{inset:auto;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.35);border:1px solid #2d333b}.app.oculto{display:none}' +'.barra-t{height:38px;flex:0 0 38px;background:#15181c;color:#e6e8eb;display:flex;align-items:center;gap:8px;padding:0 6px 0 14px;user-select:none;cursor:default}.app.janela .barra-t{cursor:move}' +'.barra-t b{font-size:13px;flex:1;font-weight:600}.barra-t b small{color:#8b929b;font-weight:400;margin-left:6px}' +'.wb{width:34px;height:28px;border:0;border-radius:7px;background:none;color:#cfd3da;cursor:pointer;font-size:15px;display:grid;place-items:center}.wb:hover{background:#2d333b;color:#fff}.wb.x:hover{background:#e5484d}' +'.corpo{flex:1;display:flex;min-height:0}' +'.alca{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;display:none;background:linear-gradient(135deg,transparent 50%,#9aa1aa 50%,#9aa1aa 58%,transparent 58%,transparent 70%,#9aa1aa 70%,#9aa1aa 78%,transparent 78%)}.app.janela .alca{display:block}' +'.pilula{position:fixed;right:18px;bottom:18px;display:none;align-items:center;gap:10px;background:#1f2328;color:#fff;border:0;border-left:5px solid #EE4D2D;border-radius:12px;padding:11px 16px;font:600 13px Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.35);max-width:360px}.pilula.on{display:flex}.pilula:hover{background:#2d333b}.pilula small{font-weight:400;color:#cfd3da}' +
    'aside{width:230px;background:#1f2328;color:#cfd3da;display:flex;flex-direction:column;padding:18px 12px}' +
    '.logo{color:#fff;font-weight:700;font-size:16px;padding:2px 8px 20px;display:flex;gap:10px;align-items:center}.logo span{background:#EE4D2D;border-radius:9px;width:34px;height:34px;display:grid;place-items:center;font-size:18px}.logo small{display:block;font-weight:400;color:#8b929b;font-size:11px}' +
    '.sec{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#7d8590;padding:12px 10px 6px}' +
    '.mi{display:flex;gap:10px;align-items:center;width:100%;padding:10px 12px;border-radius:9px;border:0;background:none;color:inherit;cursor:pointer;font-size:14px;text-align:left}.mi:hover{background:#2d333b}.mi.on{background:#EE4D2D;color:#fff;font-weight:600}.mi[disabled]{opacity:.4;cursor:default;background:none}' +
    '.rod{margin-top:auto;font-size:11px;color:#7d8590;padding:10px}.app.janela aside{width:200px}.voltar{margin-top:8px;background:#2d333b;color:#fff;border:0;border-radius:9px;padding:10px;cursor:pointer;font-weight:600;width:100%}.voltar:hover{background:#3a414a}' +
    'main{flex:1;overflow:auto;padding:28px 34px}h1{font-size:23px;margin-bottom:3px}.sub{color:#6b7280;margin-bottom:22px}' +
    '.view{display:none}.view.on{display:block}' +
    '.hero{background:linear-gradient(120deg,#EE4D2D,#ff7a45);color:#fff;border-radius:16px;padding:24px 26px;display:flex;gap:24px;align-items:center;box-shadow:0 10px 30px rgba(238,77,45,.25)}' +
    '.hero .txt{flex:1}.hero h2{font-size:19px;margin-bottom:6px}.hero p{opacity:.92;line-height:1.5;font-size:13.5px}' +
    '.go{background:#fff;color:#EE4D2D;border:0;border-radius:12px;padding:16px 26px;font-size:16px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.12)}.go:disabled{opacity:.7;cursor:default}' +
    '.prog{margin-top:16px;display:none}.prog.on{display:block}.barra{height:8px;background:rgba(255,255,255,.3);border-radius:8px;overflow:hidden}.barra i{display:block;height:100%;width:0;background:#fff;transition:width .4s}.prog .st{font-size:13px;margin-top:7px;opacity:.95}' +
    '.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.k{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px}.k b{font-size:24px;display:block}.k span{font-size:12px;color:#6b7280}.k.d b{color:#EE4D2D}' +
    '.grid{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;margin-top:18px}' +
    '.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px}.card h3{font-size:14px;margin-bottom:12px}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:#fdecea;color:#EE4D2D;border-radius:20px;padding:4px 11px;font-size:12px;font-weight:700}' +
    '.zona-res{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:4px}.zr{background:#fafafa;border-radius:8px;padding:7px;text-align:center;font-size:12px}.zr b{display:block;font-size:15px}' +
    '.drop{border:2px dashed #e5e7eb;border-radius:12px;padding:18px;text-align:center;color:#6b7280;cursor:pointer;font-size:13px}.drop.hv{border-color:#EE4D2D;background:#fff6f4;color:#EE4D2D}' +
    'label{display:block;font-weight:600;font-size:12px;margin:12px 0 5px;color:#374151}textarea{width:100%;height:110px;border:1px solid #e5e7eb;border-radius:9px;padding:9px;font:13px Consolas,monospace;resize:vertical}' +
    '.ck{display:flex;gap:8px;align-items:center;font-weight:400;font-size:13px}' +
    '.btn{border:0;border-radius:9px;padding:9px 14px;font-weight:600;cursor:pointer;background:#eef0f3;color:#1f2328;font-size:13px}.btn.l{background:#EE4D2D;color:#fff}' +
    '.log{margin-top:18px;background:#1f2328;color:#d1d5db;border-radius:14px;padding:12px 14px;font:12px Consolas,monospace;height:140px;overflow:auto;white-space:pre-wrap}.ok{color:#4ade80}.er{color:#f87171}' +
    'main{container-type:inline-size}@container (max-width:860px){.kpis{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.hero{flex-direction:column;align-items:stretch}.zona-res{grid-template-columns:repeat(3,1fr)}}' +
    '.ultimo{display:none;margin-top:12px}.ultimo.on{display:flex;gap:10px;align-items:center}' +
    '</style>' +
    '<button class="pilula" id="pilula" title="Abrir o painel">⚙️ Painel Qualidade <small id="pilSt"></small></button>' +'<div class="app" id="app"><div class="barra-t" id="barraT"><b>⚙️ Painel Qualidade<small>v' + VERSAO + '</small></b>' +'<button class="wb" id="bMin" title="Minimizar">—</button><button class="wb" id="bMax" title="Modo janela">❐</button><button class="wb x" id="bFec" title="Fechar o painel">✕</button></div>' +'<div class="corpo"><aside>' +
      '<div class="logo"><span>⚙️</span><div>Painel Qualidade<small>Automações do WMS</small></div></div>' +
      '<div class="sec">Automações</div>' +
      '<button class="mi on" data-v="onhand">📦 On-Hand</button>' +
      '<button class="mi" data-v="cub">📏 Cubiscan</button>' +
      '<button class="mi" disabled title="Em breve">🔜 Próxima automação</button>' +
      '<div class="sec">Sistema</div><button class="mi" data-v="config">🛠️ Configurações</button>' +
      '<div class="rod">v' + VERSAO + (temApp ? ' · app conectado ✓' : '') + ' · roda com o seu login<button class="voltar" id="fechar">— Minimizar</button></div>' +
    '</aside><main>' +
      '<section class="view on" id="v-onhand"><h1>On-Hand Inventory Map</h1><p class="sub">Baixa do WMS, junta as planilhas, remove as zonas da lista e entrega a planilha pronta.</p>' +
        '<div class="hero"><div class="txt"><h2>📥 Baixar On-Hand agora</h2><p>Um clique: o painel pede a exportação ao WMS, espera ficar pronta, junta tudo e baixa a planilha limpa. Pode levar alguns minutos — dá pra continuar usando o PC.</p>' +
          '<div class="prog" id="prog"><div class="barra"><i id="barra"></i></div><div class="st" id="st"></div></div></div>' +
          '<button class="go" id="go">📥 Baixar On-Hand</button></div>' +
        '<div class="ultimo" id="ultimo"><button class="btn l" id="denovo">⬇️ Baixar a planilha de novo</button><span id="ultNome" style="color:#6b7280;font-size:13px"></span></div>' +
        '<div class="kpis"><div class="k"><b id="k1">—</b><span>planilhas juntadas</span></div><div class="k"><b id="k2">—</b><span>linhas lidas</span></div><div class="k"><b id="k3">—</b><span>linhas removidas</span></div><div class="k d"><b id="k4">—</b><span>linhas na planilha</span></div></div>' +
        '<div class="grid"><div class="card"><h3>🧹 Removidas por zona</h3><div class="zona-res" id="zres"></div></div>' +
          '<div class="card"><h3>📂 Já tem o arquivo baixado?</h3><div class="drop" id="drop">Arraste aqui o .zip / .csv / .xlsx do On-Hand<br><small>ou clique para escolher</small></div><input type="file" id="arq" multiple accept=".zip,.csv,.xlsx" hidden></div></div>' +
        '<div class="log" id="log"></div></section>' +
      '<section class="view" id="v-cub"><h1>Cubiscan — lotes por rua</h1><p class="sub">Puxa o backlog do Cubiscan, monta a tabela de ruas e junta as ruas vizinhas em lotes de <b id="cubFaixa"></b> SKUs. Tudo numa planilha só.</p>' +
        '<div class="hero"><div class="txt"><h2>📏 Montar lotes do Cubiscan</h2><p id="cubTxt"></p>' +
          '<div class="prog" id="cprog"><div class="barra"><i id="cbarra"></i></div><div class="st" id="cst"></div></div></div>' +
          '<button class="go" id="cgo">📏 Montar lotes</button></div>' +
        '<div class="ultimo" id="cult"><button class="btn l" id="cdenovo">⬇️ Baixar a planilha de novo</button><span id="cultNome" style="color:#6b7280;font-size:13px"></span></div>' +
        '<div class="kpis"><div class="k"><b id="c1">—</b><span>SKUs no backlog</span></div><div class="k"><b id="c2">—</b><span>com posição</span></div><div class="k"><b id="c3">—</b><span>sem posição</span></div><div class="k d"><b id="c4">—</b><span>lotes montados</span></div></div>' +
        '<div class="grid"><div class="card"><h3>📦 Lotes</h3><div id="clotes" style="font-size:13px;color:#6b7280">Os lotes aparecem aqui.</div></div>' +
          '<div class="card"><h3>📂 Ou use o CSV baixado</h3><div class="drop" id="cdrop">Arraste aqui o CSV do Cubiscan (Backlog → Baixar CSV)<br><small>ou clique para escolher</small></div><input type="file" id="carq" accept=".csv" hidden>' +
          '<label>Faixa de SKUs por lote</label><div style="display:flex;gap:8px;align-items:center"><input id="cmin" type="number" style="width:90px;border:1px solid #e5e7eb;border-radius:8px;padding:7px"> até <input id="cmax" type="number" style="width:90px;border:1px solid #e5e7eb;border-radius:8px;padding:7px"></div></div></div>' +
      '</section>' +
      '<section class="view" id="v-config"><h1>Configurações</h1><p class="sub">Ficam salvas neste navegador.</p><div class="card" style="max-width:560px">' +
        '<h3>On-Hand</h3><label>Zonas para remover (uma por linha)</label><textarea id="zonas"></textarea>' +
        '<label class="ck" style="margin-top:12px"><input type="checkbox" id="dup"> Remover linhas duplicadas</label>' +
        '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn l" id="salvar">Salvar</button><button class="btn" id="padrao">Voltar ao padrão</button><span id="msg" class="ok" style="align-self:center;font-size:13px"></span></div>' +
      '</div></section>' +
    '</main></div><div class="alca" id="alca" title="Arraste para mudar o tamanho"></div></div>';

  var $ = function (id) { return raiz.getElementById(id); };
  function log(t, c) { var l = $('log'), d = document.createElement('div'); if (c) d.className = c; d.textContent = '[' + new Date().toLocaleTimeString('pt-BR') + '] ' + t; l.appendChild(d); l.scrollTop = l.scrollHeight; }
  function aviso(t, pct) { $('prog').classList.add('on'); $('st').textContent = t; if (pct != null) $('barra').style.width = Math.min(100, pct) + '%'; $('pilSt').textContent = '· ' + t; }
  var ultimo = null;

  raiz.querySelectorAll('.mi[data-v]').forEach(function (b) {
    b.onclick = function () {
      raiz.querySelectorAll('.mi').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
      raiz.querySelectorAll('.view').forEach(function (v) { v.classList.remove('on'); }); $('v-' + b.dataset.v).classList.add('on');
    };
  });
  
  /* ---------- Janela: maximizado / janela / minimizado, mover e redimensionar ---------- */
  var app = $('app'), pil = $('pilula');
  var jan = cfg.janela || { x: 60, y: 40, w: Math.min(1100, window.innerWidth - 120), h: Math.min(720, window.innerHeight - 80) };
  var modo = cfg.modo === 'janela' ? 'janela' : 'max', minimizado = false;
  function limitar() {
    var vw = window.innerWidth, vh = window.innerHeight;
    jan.w = Math.max(Math.min(640, vw), Math.min(jan.w, vw)); jan.h = Math.max(Math.min(420, vh), Math.min(jan.h, vh));
    jan.x = Math.max(0, Math.min(jan.x, vw - jan.w)); jan.y = Math.max(0, Math.min(jan.y, vh - jan.h));
  }
  function aplicar() {
    app.classList.toggle('oculto', minimizado); pil.classList.toggle('on', minimizado);
    app.classList.toggle('janela', modo === 'janela');
    if (modo === 'janela') { limitar(); app.style.left = jan.x + 'px'; app.style.top = jan.y + 'px'; app.style.width = jan.w + 'px'; app.style.height = jan.h + 'px'; }
    else { app.style.left = app.style.top = app.style.width = app.style.height = ''; }
    $('bMax').textContent = modo === 'janela' ? '☐' : '❐'; $('bMax').title = modo === 'janela' ? 'Tela cheia' : 'Modo janela';
    if (!minimizado) $('pilSt').textContent = '';
  }
  function guardarJanela() { cfg.janela = jan; cfg.modo = modo; salvarCfg(); }
  function minimizar() { minimizado = true; aplicar(); }
  function restaurar() { minimizado = false; aplicar(); }
  $('bMin').onclick = minimizar; $('fechar').onclick = minimizar; pil.onclick = restaurar;
  $('bMax').onclick = function () { modo = modo === 'janela' ? 'max' : 'janela'; aplicar(); guardarJanela(); };
  $('barraT').addEventListener('dblclick', function (e) { if (e.target.tagName !== 'BUTTON') $('bMax').onclick(); });
  $('bFec').onclick = function () {
    if ($('go').disabled && !confirm('Tem uma automação rodando. Fechar mesmo assim?')) return;
    host.remove(); delete window.__painelQualidade;
  };
  function arrastar(el, aoMover) {
    el.addEventListener('mousedown', function (e) {
      if (modo !== 'janela' || e.button !== 0 || e.target.tagName === 'BUTTON') return;
      e.preventDefault(); var sx = e.clientX, sy = e.clientY, ini = { x: jan.x, y: jan.y, w: jan.w, h: jan.h };
      function mov(ev) { aoMover(ini, ev.clientX - sx, ev.clientY - sy); aplicar(); }
      function sol() { document.removeEventListener('mousemove', mov); document.removeEventListener('mouseup', sol); guardarJanela(); }
      document.addEventListener('mousemove', mov); document.addEventListener('mouseup', sol);
    });
  }
  arrastar($('barraT'), function (i, dx, dy) { jan.x = i.x + dx; jan.y = i.y + dy; });
  arrastar($('alca'), function (i, dx, dy) { jan.w = i.w + dx; jan.h = i.h + dy; });
  window.addEventListener('resize', function () { if (modo === 'janela') aplicar(); });
  window.__painelQualidade = { alternar: function () { minimizado ? restaurar() : minimizar(); } };
  if (window.__painelApp) minimizado = true;
  aplicar();


  function mostrarResultado(r) {
    $('k1').textContent = fmt(r.arquivos); $('k2').textContent = fmt(r.lidas);
    $('k3').textContent = fmt(r.lidas - r.final); $('k4').textContent = fmt(r.final);
    $('zres').innerHTML = cfg.zonas.map(function (z) { z = z.trim().toUpperCase(); return '<div class="zr"><b>' + fmt(r.porZona[z] || 0) + '</b>' + escH(z) + '</div>'; }).join('');
    ultimo = r; $('ultimo').classList.add('on'); $('ultNome').textContent = r.nome;
    log('✅ Planilha pronta: ' + r.nome + ' — ' + fmt(r.final) + ' linhas (filtro pela coluna "' + r.coluna + '")', 'ok');
  }
  async function rodar(obterArquivos) {
    var go = $('go'); go.disabled = true; go.textContent = '⏳ Trabalhando…';
    try {
      var brutos = await obterArquivos();
      var r = await processarOnHand(brutos, aviso);
      aviso('✅ Pronto! A planilha foi baixada.', 100);
      baixarBlob(r.blob, r.nome); mostrarResultado(r);
    } catch (e) { aviso('❌ ' + e.message, null); log('❌ ' + e.message, 'er'); }
    go.disabled = false; go.textContent = '📥 Baixar On-Hand';
  }
  $('go').onclick = function () {
    log('Iniciando o download do On-Hand…');
    rodar(async function () { var a = await exportarRC(ONHAND, 86, aviso); log('📥 Baixado: ' + a.nome + ' (' + fmt(Math.round(a.dados.length / 1024)) + ' KB)'); return [a]; });
  };
  $('denovo').onclick = function () { if (ultimo) baixarBlob(ultimo.blob, ultimo.nome); };

  function usarArquivos(lista) {
    var fs = [].filter.call(lista, function (f) { return /\.(zip|csv|xlsx)$/i.test(f.name); });
    if (!fs.length) return log('⚠️ Escolha arquivos .zip, .csv ou .xlsx', 'er');
    log('Usando ' + fs.length + ' arquivo(s) escolhido(s)…');
    rodar(function () { return Promise.all(fs.map(function (f) { return f.arrayBuffer().then(function (b) { return { nome: f.name, dados: new Uint8Array(b) }; }); })); });
  }
  var drop = $('drop');
  drop.onclick = function () { $('arq').click(); };
  $('arq').onchange = function (e) { usarArquivos(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hv'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hv'); }); });
  drop.addEventListener('drop', function (e) { usarArquivos(e.dataTransfer.files); });


  /* ---------- Tela do Cubiscan ---------- */
  var cubUlt = null, noCub = naPaginaCubiscan();
  $('cmin').value = cfg.cubMin; $('cmax').value = cfg.cubMax;
  function faixaCub() { $('cubFaixa').textContent = cfg.cubMin + ' a ' + cfg.cubMax; }
  faixaCub();
  ['cmin', 'cmax'].forEach(function (id) { $(id).onchange = function () { cfg.cubMin = +$('cmin').value || 150; cfg.cubMax = +$('cmax').value || 230; if (cfg.cubMax < cfg.cubMin) cfg.cubMax = cfg.cubMin; salvarCfg(); faixaCub(); }; });
  $('cubTxt').innerHTML = noCub ? 'Um clique: puxa o backlog do <b>BRFPE1</b> direto do Cubiscan, monta as ruas, junta em lotes e baixa a planilha pronta (com as ruas marcadas por cor).'
    : temApp ? 'Um clique: o app puxa o backlog do <b>BRFPE1</b> do Cubiscan em segundo plano, monta as ruas, junta em lotes e baixa a planilha pronta.'
    : 'O Cubiscan é outro site, então pelo favorito o painel precisa estar aberto <b>na página do Cubiscan</b>. Clique em <b>Abrir Cubiscan</b>, e lá clique no favorito <b>⚙️ Painel Qualidade</b> → <b>Montar lotes</b>. <br><small>Com o app Painel Qualidade, dá pra fazer direto daqui.</small>';
  if (!noCub && !temApp) $('cgo').textContent = '↗️ Abrir Cubiscan';
  function cAviso(t, pct) { $('cprog').classList.add('on'); $('cst').textContent = t; if (pct != null) $('cbarra').style.width = Math.min(100, pct) + '%'; $('pilSt').textContent = '· ' + t; }
  function mostrarLotes(r) {
    $('c1').textContent = fmt(r.total); $('c2').textContent = fmt(r.comPos); $('c3').textContent = fmt(r.semPos); $('c4').textContent = fmt(r.lotes.length);
    $('clotes').innerHTML = r.lotes.map(function (l) {
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f1f2f4"><span style="background:#' + CORES_LOTE[(l.n - 1) % CORES_LOTE.length] + ';border-radius:6px;padding:2px 8px;font-weight:700;color:#1f2328;white-space:nowrap">Lote ' + l.n + '</span>' +
        '<span style="flex:1;color:#374151"><b style="color:#6b7280">' + escH(l.area) + ':</b> ' + escH(l.pedacos.map(function (p) { return p.rua.replace(/^BRFPE1-/, '') + (p.parte ? ' (' + p.parte + ')' : ''); }).join(', ')) + '</span><b style="color:' + (l.ok ? '#16a34a' : '#d97706') + '">' + l.total + '</b></div>';
    }).join('');
    cubUlt = r; $('cult').classList.add('on'); $('cultNome').textContent = r.nome;
    log('✅ Cubiscan: ' + r.lotes.length + ' lotes montados (' + fmt(r.comPos) + ' SKUs com posição, ' + fmt(r.semPos) + ' sem posição) → ' + r.nome, 'ok');
  }
  async function rodarCub(obter) {
    var b = $('cgo'); b.disabled = true; b.textContent = '⏳ Trabalhando…';
    try {
      var d = await obter();
      var r = await processarCubiscan(d.cab, d.linhas, cAviso);
      cAviso('✅ Pronto! A planilha foi baixada.' + (d.atualizado ? ' (dados do Cubiscan de ' + d.atualizado + ')' : ''), 100);
      baixarBlob(r.blob, r.nome); mostrarLotes(r);
    } catch (e) { cAviso('❌ ' + e.message, null); log('❌ ' + e.message, 'er'); }
    b.disabled = false; b.textContent = (noCub || temApp) ? '📏 Montar lotes' : '↗️ Abrir Cubiscan';
  }
  $('cgo').onclick = function () {
    if (!noCub && temApp) {
      return rodarCub(async function () {
        cAviso('Puxando o backlog do Cubiscan (em segundo plano)…', 15);
        var r = await ponte('cubiscan', { whs: 'BRFPE1' });
        return { cab: CUB_CAB, linhas: r.rows.map(function (row) { return CUB_MAPA.map(function (k) { var v = row[k]; return v == null ? '' : String(v); }); }), atualizado: r.lastUpdate };
      });
    }
    if (!noCub) { window.open(CUB_URL, '_blank'); return; }
    rodarCub(async function () { var r = await buscarBacklogCubiscan('BRFPE1', cAviso); return { cab: CUB_CAB, linhas: r.linhas, atualizado: r.atualizado }; });
  };
  $('cdenovo').onclick = function () { if (cubUlt) baixarBlob(cubUlt.blob, cubUlt.nome); };
  function usarCsvCub(f) {
    if (!f || !/\.csv$/i.test(f.name)) return log('⚠️ Escolha o .csv do Cubiscan', 'er');
    rodarCub(async function () { var d = lerCSV(new TextDecoder('utf-8').decode(new Uint8Array(await f.arrayBuffer()))); return { cab: d.cab, linhas: d.linhas }; });
  }
  var cdrop = $('cdrop');
  cdrop.onclick = function () { $('carq').click(); };
  $('carq').onchange = function (e) { usarCsvCub(e.target.files[0]); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(function (ev) { cdrop.addEventListener(ev, function (e) { e.preventDefault(); cdrop.classList.add('hv'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { cdrop.addEventListener(ev, function (e) { e.preventDefault(); cdrop.classList.remove('hv'); }); });
  cdrop.addEventListener('drop', function (e) { usarCsvCub(e.dataTransfer.files[0]); });
  if (noCub) raiz.querySelector('.mi[data-v=cub]').click();

  function preencherCfg() { $('zonas').value = cfg.zonas.join('\n'); $('dup').checked = !!cfg.dup; $('zres').innerHTML = cfg.zonas.map(function (z) { return '<div class="zr"><b>—</b>' + escH(z) + '</div>'; }).join(''); }
  $('salvar').onclick = function () {
    cfg.zonas = $('zonas').value.split('\n').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean); cfg.dup = $('dup').checked; salvarCfg(); preencherCfg();
    $('msg').textContent = 'Salvo!'; setTimeout(function () { $('msg').textContent = ''; }, 2000);
  };
  $('padrao').onclick = function () { cfg.zonas = ZONAS_PADRAO.slice(); cfg.dup = true; salvarCfg(); preencherCfg(); };
  preencherCfg();

  if (location.hostname.indexOf('wms.') !== 0 && !naPaginaCubiscan() && !window.__PAINEL_TESTE__) log('⚠️ Abra o painel com o WMS aberto para baixar direto. Arrastar arquivo funciona em qualquer lugar.', 'er');
  log('Painel v' + VERSAO + ' pronto.');
  if (window.__PAINEL_TESTE__) window.__PAINEL_TESTE__ = { processarOnHand: processarOnHand, lerArquivo: lerArquivo, processarCubiscan: processarCubiscan, montarLotes: montarLotes };
})();
