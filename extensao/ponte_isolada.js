/* Painel Qualidade — repassa os pedidos do painel para a extensão (só as ações conhecidas, todas de leitura). */
(function () {
  if (window.top !== window) return;
  var PERMITIDAS = ['ping', 'cubiscan', 'eosBacklog'];
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__painelQ !== 'pedido') return;
    var p; try { p = JSON.parse(e.data.json); } catch (x) { return; }
    if (PERMITIDAS.indexOf(p.acao) < 0) return;
    function responder(ok, dados) { window.postMessage({ __painelQ: 'resposta', id: p.id, ok: ok, json: JSON.stringify(dados) }, location.origin); }
    try {
      chrome.runtime.sendMessage({ acao: p.acao, whs: p.whs }, function (r) {
        if (chrome.runtime.lastError || !r) return responder(false, { erro: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'A extensão não respondeu. Recarregue a página (F5).' });
        responder(!!r.ok, r.ok ? r.dados : { erro: r.erro });
      });
    } catch (x) { responder(false, { erro: 'A extensão foi atualizada. Recarregue a página (F5).' }); }
  });
})();
