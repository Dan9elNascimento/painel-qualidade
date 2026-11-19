/* Painel Qualidade — painel de automações do WMS (abre em tela cheia dentro do WMS)
   Tudo roda no navegador de quem clicou, com o login dessa pessoa. Nenhum dado sai do PC. */
(function () {
  'use strict';
  var VERSAO = '1.0.0';
  var ID = 'painel-qualidade-raiz';
  var ZONAS_PADRAO = ['AV', 'D', 'DEM', 'EXZO', 'MI', 'MO', 'OS', 'RO', 'TS', 'RTS'];

  var antigo = document.getElementById(ID);
  if (antigo) { antigo.style.display = antigo.style.display === 'none' ? '' : 'none'; return; }

  /* ===================== UTILIDADES ===================== */
  var enc = new TextEncoder();
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmt(n) { return Number(n).toLocaleString('pt-BR'); }
  function escH(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function carimbo() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + 'h' + p(d.getMinutes()); }
  function baixarBlob(blob, nome) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000); }

  /* ===================== CONFIG (por pessoa, neste navegador) ===================== */
  var CHAVE = 'painelQualidade_cfg';
  var cfg = { zonas: ZONAS_PADRAO.slice(), dup: true };
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
  function abaXML(cab, linhas) {
    var larg = cab.map(function (h) { return Math.max(8, Math.min(45, String(h).length + 2)); });
    linhas.slice(0, 300).forEach(function (l) { l.forEach(function (v, j) { if (j < larg.length) larg[j] = Math.max(larg[j], Math.min(45, String(v).length + 2)); }); });
    var L = cab.map(function (_, j) { return letra(j); });
    var partes = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      larg.map(function (w, j) { return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>'];
    partes.push('<row r="1">' + cab.map(function (h, j) { return '<c r="' + L[j] + '1" t="inlineStr" s="1"><is><t>' + escX(h) + '</t></is></c>'; }).join('') + '</row>');
    var buf = [];
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i], r = i + 2, s = '<row r="' + r + '">';
      for (var j = 0; j < l.length; j++) {
        var v = l[j] == null ? '' : String(l[j]).trim();
        if (v === '') continue;
        s += NUM.test(v) ? '<c r="' + L[j] + r + '"><v>' + v + '</v></c>' : '<c r="' + L[j] + r + '" t="inlineStr"><is><t xml:space="preserve">' + escX(v) + '</t></is></c>';
      }
      buf.push(s + '</row>');
      if (buf.length === 5000) { partes.push(buf.join('')); buf = []; }
    }
    partes.push(buf.join(''));
    partes.push('</sheetData><autoFilter ref="A1:' + L[cab.length - 1] + (linhas.length + 1) + '"/></worksheet>');
    return new Blob(partes);
  }
  async function gerarXLSX(abas) {
    var tipos = abas.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('');
    var fixos = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + tipos + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + abas.map(function (a, i) { return '<sheet name="' + escX(a.nome).slice(0, 31) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + abas.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (abas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEE4D2D"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']
    ];
    var entradas = [];
    for (var i = 0; i < fixos.length; i++) entradas.push(await prepararEntrada(fixos[i][0], new Blob([fixos[i][1]])));
    for (var a = 0; a < abas.length; a++) entradas.push(await prepararEntrada('xl/worksheets/sheet' + (a + 1) + '.xml', abaXML(abas[a].cab, abas[a].linhas)));
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

  /* ===================== INTERFACE ===================== */
  var host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  document.body.appendChild(host);
  var raiz = host.attachShadow({ mode: 'open' });
  raiz.innerHTML = '<style>' +
    ':host{all:initial}*{box-sizing:border-box;margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif}' +
    '.app{position:fixed;inset:0;display:flex;background:#f4f5f7;color:#1f2328;font-size:14px}' +
    'aside{width:230px;background:#1f2328;color:#cfd3da;display:flex;flex-direction:column;padding:18px 12px}' +
    '.logo{color:#fff;font-weight:700;font-size:16px;padding:2px 8px 20px;display:flex;gap:10px;align-items:center}.logo span{background:#EE4D2D;border-radius:9px;width:34px;height:34px;display:grid;place-items:center;font-size:18px}.logo small{display:block;font-weight:400;color:#8b929b;font-size:11px}' +
    '.sec{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#7d8590;padding:12px 10px 6px}' +
    '.mi{display:flex;gap:10px;align-items:center;width:100%;padding:10px 12px;border-radius:9px;border:0;background:none;color:inherit;cursor:pointer;font-size:14px;text-align:left}.mi:hover{background:#2d333b}.mi.on{background:#EE4D2D;color:#fff;font-weight:600}.mi[disabled]{opacity:.4;cursor:default;background:none}' +
    '.rod{margin-top:auto;font-size:11px;color:#7d8590;padding:10px}.voltar{margin-top:8px;background:#2d333b;color:#fff;border:0;border-radius:9px;padding:10px;cursor:pointer;font-weight:600;width:100%}.voltar:hover{background:#3a414a}' +
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
    '.ultimo{display:none;margin-top:12px}.ultimo.on{display:flex;gap:10px;align-items:center}' +
    '</style>' +
    '<div class="app"><aside>' +
      '<div class="logo"><span>⚙️</span><div>Painel Qualidade<small>Automações do WMS</small></div></div>' +
      '<div class="sec">Automações</div>' +
      '<button class="mi on" data-v="onhand">📦 On-Hand</button>' +
      '<button class="mi" disabled title="Em breve">🔜 Próxima automação</button>' +
      '<div class="sec">Sistema</div><button class="mi" data-v="config">🛠️ Configurações</button>' +
      '<div class="rod">v' + VERSAO + ' · roda com o seu login<button class="voltar" id="fechar">← Voltar ao WMS</button></div>' +
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
      '<section class="view" id="v-config"><h1>Configurações</h1><p class="sub">Ficam salvas neste navegador.</p><div class="card" style="max-width:560px">' +
        '<h3>On-Hand</h3><label>Zonas para remover (uma por linha)</label><textarea id="zonas"></textarea>' +
        '<label class="ck" style="margin-top:12px"><input type="checkbox" id="dup"> Remover linhas duplicadas</label>' +
        '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn l" id="salvar">Salvar</button><button class="btn" id="padrao">Voltar ao padrão</button><span id="msg" class="ok" style="align-self:center;font-size:13px"></span></div>' +
      '</div></section>' +
    '</main></div>';

  var $ = function (id) { return raiz.getElementById(id); };
  function log(t, c) { var l = $('log'), d = document.createElement('div'); if (c) d.className = c; d.textContent = '[' + new Date().toLocaleTimeString('pt-BR') + '] ' + t; l.appendChild(d); l.scrollTop = l.scrollHeight; }
  function aviso(t, pct) { $('prog').classList.add('on'); $('st').textContent = t; if (pct != null) $('barra').style.width = Math.min(100, pct) + '%'; }
  var ultimo = null;

  raiz.querySelectorAll('.mi[data-v]').forEach(function (b) {
    b.onclick = function () {
      raiz.querySelectorAll('.mi').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
      raiz.querySelectorAll('.view').forEach(function (v) { v.classList.remove('on'); }); $('v-' + b.dataset.v).classList.add('on');
    };
  });
  $('fechar').onclick = function () { host.style.display = 'none'; };

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

  function preencherCfg() { $('zonas').value = cfg.zonas.join('\n'); $('dup').checked = !!cfg.dup; $('zres').innerHTML = cfg.zonas.map(function (z) { return '<div class="zr"><b>—</b>' + escH(z) + '</div>'; }).join(''); }
  $('salvar').onclick = function () {
    cfg.zonas = $('zonas').value.split('\n').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean); cfg.dup = $('dup').checked; salvarCfg(); preencherCfg();
    $('msg').textContent = 'Salvo!'; setTimeout(function () { $('msg').textContent = ''; }, 2000);
  };
  $('padrao').onclick = function () { cfg.zonas = ZONAS_PADRAO.slice(); cfg.dup = true; salvarCfg(); preencherCfg(); };
  preencherCfg();

  if (location.hostname.indexOf('wms.') !== 0 && !window.__PAINEL_TESTE__) log('⚠️ Abra o painel com o WMS aberto para baixar direto. Arrastar arquivo funciona em qualquer lugar.', 'er');
  log('Painel v' + VERSAO + ' pronto.');
  if (window.__PAINEL_TESTE__) window.__PAINEL_TESTE__ = { processarOnHand: processarOnHand, lerArquivo: lerArquivo };
})();
