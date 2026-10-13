(function () {
  'use strict';

  // Вся проверка данных на сервере (imagen-qa-test-runner.php). Здесь — только
  // удобство: понятная сводка до запуска и мгновенные подсказки.

  function initRunner(root) {
    var form = root.querySelector('.iqr-form');
    if (!form) return;

    var statusEl = root.querySelector('.iqr-status');
    var summaryEl = root.querySelector('.iqr-summary');
    var submitBtn = root.querySelector('.iqr-submit');
    var scopeAll = form.querySelector('input[name="scope_all"]');
    var scopes = Array.prototype.slice.call(form.querySelectorAll('input[name="scope"]'));
    var specsInput = form.querySelector('input[name="spec_files"]');
    var grepInput = form.querySelector('input[name="grep"]');
    var retriesInput = form.querySelector('input[name="retries"]');
    var cookiesInput = form.querySelector('textarea[name="cookies"]');

    function checkedValues(name) {
      return Array.prototype.slice
        .call(form.querySelectorAll('input[name="' + name + '"]:checked'))
        .map(function (cb) { return cb.value; });
    }

    function anyScopeChecked() {
      return scopes.some(function (cb) { return cb.checked; });
    }

    function setStatus(kind, text) {
      statusEl.className = 'iqr-status' + (kind ? ' iqr-status--' + kind : '');
      statusEl.textContent = text;
    }

    // Какие файлы уйдут в запуск: свой список важнее галочек, галочки важнее «весь набор».
    function selectedSpecs() {
      var custom = specsInput.value.trim();
      if (custom !== '') return custom.split(/\s+/);
      if (scopeAll.checked) return [];
      var files = [];
      scopes.forEach(function (cb) {
        if (cb.checked) files = files.concat(cb.value.split(' '));
      });
      return files.filter(function (f, i) { return files.indexOf(f) === i; });
    }

    function updateSummary() {
      var browsers = checkedValues('browsers');
      var labels = browsers.map(function (b) {
        var input = form.querySelector('input[name="browsers"][value="' + b + '"]');
        return input ? input.parentNode.textContent.trim() : b;
      });
      var specs = selectedSpecs();
      var parts = [];
      parts.push(labels.length ? labels.join(', ') : 'no browser selected');
      parts.push(specs.length ? specs.length + ' ' + pluralFiles(specs.length) : 'full suite');
      if (grepInput.value.trim()) parts.push('filter "' + grepInput.value.trim() + '"');
      if (retriesInput && retriesInput.checked) parts.push('with retry');
      summaryEl.textContent = 'Will run: ' + parts.join(' · ');
    }

    function pluralFiles(n) {
      return n === 1 ? 'file' : 'files';
    }

    // «Весь набор» и категории взаимоисключающие: пустой выбор означает весь набор.
    scopeAll.addEventListener('change', function () {
      if (scopeAll.checked) {
        scopes.forEach(function (cb) { cb.checked = false; });
      } else if (!anyScopeChecked()) {
        scopeAll.checked = true;
      }
      updateSummary();
    });

    scopes.forEach(function (cb) {
      cb.addEventListener('change', function () {
        scopeAll.checked = !anyScopeChecked();
        updateSummary();
      });
    });

    form.addEventListener('change', updateSummary);
    form.addEventListener('input', updateSummary);

    // Префилл из query-строки — так на эту форму может сослаться QA-дашборд
    // (claude.ai Artifact). Сам дашборд не может дернуть GitHub напрямую
    // (песочница артефакта не пускает fetch/XHR ни на один внешний хост,
    // только навигацию), поэтому вместо прямого запуска он открывает эту
    // страницу новой вкладкой с уже выбранными настройками — отправка
    // всё равно идёт тем же, уже рабочим путём: вход в WordPress + nonce.
    // Поддерживаемые параметры: ?browsers=chromium,firefox&specs=tests/a.spec.ts%20tests/b.spec.ts&grep=...&cookies=...&retries=true
    (function applyPrefillFromQuery() {
      var params;
      try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
      if (!params.has('browsers') && !params.has('specs') && !params.has('grep') && !params.has('cookies') && !params.has('retries')) return;

      if (params.has('browsers')) {
        var wanted = params.get('browsers').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        form.querySelectorAll('input[name="browsers"]').forEach(function (cb) {
          cb.checked = wanted.indexOf(cb.value) !== -1;
        });
      }
      if (params.has('specs')) {
        specsInput.value = params.get('specs');
      }
      if (params.has('grep')) {
        grepInput.value = params.get('grep');
      }
      if (params.has('cookies')) {
        cookiesInput.value = params.get('cookies');
      }
      if (retriesInput && params.has('retries')) {
        retriesInput.checked = params.get('retries') === 'true';
      }
      scopeAll.checked = !anyScopeChecked() && specsInput.value.trim() === '';
    })();

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var browsers = checkedValues('browsers');
      if (browsers.length === 0) {
        setStatus('error', 'Select at least one browser.');
        return;
      }

      var cookies = cookiesInput.value.trim();
      if (cookies !== '' && (cookies.indexOf('=') === -1 || /[\r\n]/.test(cookies))) {
        setStatus('error', 'Cookies are invalid. Use a string like name1=value1; name2=value2.');
        return;
      }

      var data = new FormData();
      data.append('action', 'imagen_qa_run_test');
      data.append('nonce', imagenQaRunner.nonce);
      data.append('browsers', browsers.join(','));
      data.append('spec_files', selectedSpecs().join(' '));
      data.append('grep', grepInput.value.trim());
      data.append('cookies', cookies);
      data.append('retries', retriesInput && retriesInput.checked ? 'true' : 'false');

      submitBtn.disabled = true;
      setStatus('loading', 'Sending the run to GitHub…');

      fetch(imagenQaRunner.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        body: data,
      })
        .then(function (response) {
          return response.json().then(function (json) {
            return { ok: response.ok, json: json };
          });
        })
        .then(function (result) {
          var payload = result.json || {};
          if (payload.success) {
            setStatus('ok', payload.data && payload.data.message ? payload.data.message : 'Run sent.');
          } else {
            var message = payload.data && payload.data.message ? payload.data.message : 'The run could not be started.';
            setStatus('error', message);
          }
        })
        .catch(function () {
          setStatus('error', 'Request failed. Check your connection and try again.');
        })
        .then(function () {
          submitBtn.disabled = false;
        });
    });

    updateSummary();
  }

  function boot() {
    document.querySelectorAll('.imagen-qa-runner').forEach(initRunner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
