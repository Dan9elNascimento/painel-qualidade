/* Painel Qualidade — extensão: lê o Cubiscan e o EOS Returns From Buyer em segundo plano (só leitura). */
const CUB_URL = 'https://script.google.com/a/shopee.com/macros/s/AKfycbzfv3G8biAdsTp5DMWptXOwDgrMFwCCbAb50LQ72Hogbvj0A1wXpQB1uzYbN5M1gTEk/exec?page=cubscan';
const EOS_URL = 'https://script.google.com/a/macros/shopee.com/s/AKfycbz5FswTU34sEJjI4ZRozlVOP5nBcJsoo6UpUlmZBPEEqiXb9TfrdQQSZswAYnRT1iwm/exec';
const WMS_URL = 'https://wms.ssc.shopee.com.br/';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Roda dentro de cada quadro da página do Cubiscan: usa a mesma função do botão "Backlog" do site.
async function cubiscanNoQuadro(whs) {
  if (!(window.google && google.script && google.script.run)) return { info: 'app do Cubiscan carregando' };
  const chama = (nb) => new Promise((ok, erro) => google.script.run.withSuccessHandler(ok)
    .withFailureHandler((e) => erro(new Error(String((e && e.message) || e)))).getCubbingItemsClient({ nb: nb, whs: whs }));
  if (!window.__criadoOk) { try { await chama('created'); } catch (e) {} window.__criadoOk = 1; }
  const b = await chama('backlog'), d = typeof b === 'string' ? JSON.parse(b) : b;
  if (d && d.rows && d.rows.length) return { ok: true, dados: { rows: d.rows, lastUpdate: d.lastUpdate || '' } };
  return { info: 'Cubiscan respondeu sem linhas' };
}

// Roda dentro de cada quadro do EOS: lê a lista "LH recebida" com o saldo.
function eosNoQuadro() {
  const ops = [...document.querySelectorAll('option')].map((o) => o.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /saldo\s*:/i.test(t));
  if (!ops.length) {
    const b = [...document.querySelectorAll('button,a,li,div,span')].find((e) => /registro de tratativas/i.test(e.textContent || '') && e.children.length < 3);
    if (b) b.click();
    return document.querySelector('select') ? { info: 'lista de LH carregando' } : null;
  }
  const lhs = ops.map((t) => { const m = t.match(/^(\S+).*?saldo\s*:\s*(-?[\d.,]+)/i); return m ? { lh: m[1], saldo: Number(m[2].replace(/\./g, '').replace(',', '.')), texto: t } : null; }).filter(Boolean);
  return { ok: true, dados: { lhs: lhs } };
}

async function rodarEmSite(url, func, args, segundos) {
  const janela = await chrome.windows.create({ url: url, focused: false, state: 'minimized', type: 'popup' });
  const tabId = janela.tabs[0].id;
  let manter = false;
  try {
    const inicio = Date.now(); let logins = 0, ultimo = 'página carregando', mostrou = false;
    while (Date.now() - inicio < segundos * 1000) {
      await esperar(1500);
      let aba; try { aba = await chrome.tabs.get(tabId); } catch (e) { throw new Error('A janela do site foi fechada.'); }
      if (/^https:\/\/accounts\.google\./.test(aba.url || aba.pendingUrl || '')) {
        if (++logins >= 5) {
          manter = true;
          await chrome.windows.update(janela.id, { state: 'normal', focused: true });
          throw new Error('Faça login na sua conta Google da Shopee na janela que abriu e tente de novo.');
        }
        continue;
      }
      logins = 0;
      // Se o Chrome segurar a janela minimizada, mostra ela pequena (sem tirar o foco)
      if (!mostrou && Date.now() - inicio > 20000) { mostrou = true; try { await chrome.windows.update(janela.id, { state: 'normal', width: 420, height: 300, left: 0, top: 0, focused: false }); } catch (e) {} }
      let res;
      try { res = await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, world: 'MAIN', func: func, args: args }); }
      catch (e) { ultimo = e.message; continue; }
      for (const f of res) { const r = f.result; if (r && r.ok) return r.dados; if (r && r.info) ultimo = r.info; }
    }
    throw new Error('O site não respondeu a tempo (' + ultimo + ').');
  } finally {
    if (!manter) { try { await chrome.windows.remove(janela.id); } catch (e) {} }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  (async () => {
    try {
      let dados;
      if (msg.acao === 'ping') dados = { versao: chrome.runtime.getManifest().version };
      else if (msg.acao === 'cubiscan') dados = await rodarEmSite(CUB_URL, cubiscanNoQuadro, [msg.whs || 'BRFPE1'], 120);
      else if (msg.acao === 'eosBacklog') dados = await rodarEmSite(EOS_URL, eosNoQuadro, [], 90);
      else throw new Error('Ação desconhecida: ' + msg.acao);
      responder({ ok: true, dados: dados });
    } catch (e) { responder({ ok: false, erro: String((e && e.message) || e) }); }
  })();
  return true;
});

// Clique no ícone: no WMS mostra/esconde o painel; fora dele abre o WMS.
chrome.action.onClicked.addListener(async (aba) => {
  if (aba && /^https:\/\/wms\.ssc\.shopee\.com\.br\//.test(aba.url || '')) {
    try { await chrome.scripting.executeScript({ target: { tabId: aba.id }, world: 'MAIN', func: () => window.__painelQualidade && window.__painelQualidade.alternar() }); } catch (e) {}
  } else chrome.tabs.create({ url: WMS_URL });
});
