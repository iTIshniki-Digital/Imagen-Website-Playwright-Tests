document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.imagen-qa-runner').forEach(function (wrap) {
    var submitBtn = wrap.querySelector('.imagen-qa-submit');
    var statusEl = wrap.querySelector('.imagen-qa-status');
    var allCheckbox = wrap.querySelector('.imagen-qa-scope-all');
    var scopeCheckboxes = wrap.querySelectorAll('.imagen-qa-scope');

    // "Весь набор" и отдельные категории взаимоисключающие — выбор одной
    // категории автоматически снимает "весь набор", и наоборот.
    allCheckbox.addEventListener('change', function () {
      if (allCheckbox.checked) {
        scopeCheckboxes.forEach(function (cb) { cb.checked = false; });
      }
    });
    scopeCheckboxes.forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) allCheckbox.checked = false;
      });
    });

    submitBtn.addEventListener('click', function () {
      var browsers = Array.prototype.slice
        .call(wrap.querySelectorAll('.imagen-qa-browser:checked'))
        .map(function (cb) { return cb.value; });

      if (browsers.length === 0) {
        statusEl.textContent = 'Выбери хотя бы один браузер.';
        return;
      }

      var specFiles = allCheckbox.checked
        ? ''
        : Array.prototype.slice
            .call(scopeCheckboxes)
            .filter(function (cb) { return cb.checked; })
            .map(function (cb) { return cb.value; })
            .join(' ');

      var cookies = wrap.querySelector('.imagen-qa-cookies').value.trim();

      submitBtn.disabled = true;
      statusEl.textContent = 'Запускаю...';

      var formData = new FormData();
      formData.append('action', 'imagen_qa_run_test');
      formData.append('nonce', imagenQaRunner.nonce);
      formData.append('browsers', browsers.join(','));
      formData.append('spec_files', specFiles);
      formData.append('cookies', cookies);

      fetch(imagenQaRunner.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          statusEl.textContent = data.data && data.data.message ? data.data.message : 'Готово.';
          submitBtn.disabled = false;
        })
        .catch(function () {
          statusEl.textContent = 'Не удалось отправить запрос.';
          submitBtn.disabled = false;
        });
    });
  });
});
