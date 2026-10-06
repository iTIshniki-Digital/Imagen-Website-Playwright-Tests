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
      parts.push(labels.length ? labels.join(', ') : 'браузер не выбран');
      parts.push(specs.length ? specs.length + ' ' + pluralFiles(specs.length) : 'весь набор');
      if (grepInput.value.trim()) parts.push('фильтр «' + grepInput.value.trim() + '»');
      if (retriesInput && retriesInput.checked) parts.push('с повтором');
      summaryEl.textContent = 'Будет запущено: ' + parts.join(' · ');
    }

    function pluralFiles(n) {
      var mod10 = n % 10;
      var mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'файл';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'файла';
      return 'файлов';
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

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var browsers = checkedValues('browsers');
      if (browsers.length === 0) {
        setStatus('error', 'Выберите хотя бы один браузер.');
        return;
      }

      var cookies = cookiesInput.value.trim();
      if (cookies !== '' && (cookies.indexOf('=') === -1 || /[\r\n]/.test(cookies))) {
        setStatus('error', 'Cookies записаны неверно. Нужна строка вида name1=value1; name2=value2.');
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
      setStatus('loading', 'Отправляю запуск в GitHub…');

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
            setStatus('ok', payload.data && payload.data.message ? payload.data.message : 'Запуск отправлен.');
          } else {
            var message = payload.data && payload.data.message ? payload.data.message : 'Не получилось запустить прогон.';
            setStatus('error', message);
          }
        })
        .catch(function () {
          setStatus('error', 'Не удалось отправить запрос. Проверьте интернет и попробуйте ещё раз.');
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
